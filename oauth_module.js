// =============================================================
// YAH! OAuth Module — paste over the Metricool credentials section
// in metricool_module.js. This replaces the integration panel with
// per-platform connect buttons (Instagram, TikTok) and adapts the
// pull workflow to use the new Edge Functions.
//
// What changed from the Metricool version:
//   - loadIntegration() returns ALL provider rows for the client (array)
//   - integration panel renders Connect/Disconnect per platform
//   - pullFromMetricool() → pullFromInstagram() / pullFromTikTok()
//   - Both pulls coexist; "Pull All" runs both in parallel
//   - CSV import path retained as fallback
// =============================================================

// ---------- 1. Integration loaders ----------

async function loadIntegrations() {
  if (!activeClient) return [];
  return await sbGet(
    'client_integrations?client_id=eq.' + activeClient.id +
    '&active=eq.true&select=*'
  );
}

function getIntegration(integrations, provider) {
  return integrations.find(i => i.provider === provider) || null;
}

// ---------- 2. OAuth initiation ----------

// Generate a state token, persist it, and redirect to the auth URL.
async function startOAuth(provider) {
  if (!activeClient) return toast('Open a client first', 'error');

  const prefix = provider === 'instagram' ? 'ig_' : 'tt_';
  const stateToken = prefix + Date.now() + '_' + Math.random().toString(36).slice(2, 10);

  // Store state for CSRF + flow context
  await sbPost('oauth_state', [{
    state_token: stateToken,
    client_id: activeClient.id,
    provider: provider,
  }]);

  // ⚠️ EDIT THESE two values to match your Meta + TikTok dev app settings.
  const IG_CLIENT_ID = window.YAH_CONFIG?.IG_CLIENT_ID || 'REPLACE_WITH_INSTAGRAM_APP_ID';
  const TT_CLIENT_KEY = window.YAH_CONFIG?.TT_CLIENT_KEY || 'REPLACE_WITH_TIKTOK_CLIENT_KEY';
  const REDIRECT_URI = window.YAH_CONFIG?.OAUTH_REDIRECT_URI ||
                       'https://ebeprstudios.github.io/YAH/oauth_callback.html';

  let authUrl = '';
  if (provider === 'instagram') {
    const scope = 'instagram_business_basic,instagram_business_manage_insights';
    authUrl = 'https://www.instagram.com/oauth/authorize' +
              '?client_id=' + encodeURIComponent(IG_CLIENT_ID) +
              '&redirect_uri=' + encodeURIComponent(REDIRECT_URI) +
              '&response_type=code' +
              '&scope=' + encodeURIComponent(scope) +
              '&state=' + encodeURIComponent(stateToken);
  } else if (provider === 'tiktok') {
    const scope = 'user.info.basic,video.list';
    authUrl = 'https://www.tiktok.com/v2/auth/authorize/' +
              '?client_key=' + encodeURIComponent(TT_CLIENT_KEY) +
              '&scope=' + encodeURIComponent(scope) +
              '&response_type=code' +
              '&redirect_uri=' + encodeURIComponent(REDIRECT_URI) +
              '&state=' + encodeURIComponent(stateToken);
  }

  // Open in popup; fall back to redirect if popup blocked.
  const popup = window.open(authUrl, 'yah_oauth', 'width=600,height=720');
  if (!popup) window.location.href = authUrl;
  else pollForConnection(provider, popup);
}

// Poll Supabase to detect when the OAuth callback has stored credentials.
async function pollForConnection(provider, popup) {
  const start = Date.now();
  const timeout = 5 * 60 * 1000; // 5 minutes
  toast('Waiting for ' + provider + ' authorization…', 'info');

  while (Date.now() - start < timeout) {
    if (popup && popup.closed) break;
    await new Promise(r => setTimeout(r, 2000));
    const integ = await loadIntegration(provider);
    if (integ?.access_token) {
      toast(provider.charAt(0).toUpperCase() + provider.slice(1) + ' connected', 'success');
      try { popup?.close(); } catch (e) {}
      loadPerformanceTab();
      return;
    }
  }
  loadPerformanceTab();
}

async function loadIntegration(provider) {
  if (!activeClient) return null;
  const rows = await sbGet(
    'client_integrations?client_id=eq.' + activeClient.id +
    '&provider=eq.' + provider + '&select=*&limit=1'
  );
  return rows[0] || null;
}

async function disconnectPlatform(provider) {
  if (!activeClient) return;
  if (!confirm('Disconnect ' + provider + '? You can reconnect anytime.')) return;
  await sbPatch(
    'client_integrations?client_id=eq.' + activeClient.id +
    '&provider=eq.' + provider,
    { active: false, access_token: null, refresh_token: null }
  );
  toast(provider + ' disconnected', 'success');
  loadPerformanceTab();
}

// ---------- 3. Pulls ----------

async function pullFromInstagram(days = 90) {
  return runPull('instagram', 'pull-instagram', { client_id: activeClient.id, days });
}

async function pullFromTikTok(days = 90) {
  return runPull('tiktok', 'pull-tiktok', { client_id: activeClient.id, days });
}

async function pullAll() {
  if (!activeClient) return toast('Open a client first', 'error');
  const integrations = await loadIntegrations();
  const tasks = [];
  if (integrations.find(i => i.provider === 'instagram')) tasks.push(pullFromInstagram());
  if (integrations.find(i => i.provider === 'tiktok')) tasks.push(pullFromTikTok());
  if (!tasks.length) return toast('No platforms connected', 'error');
  toast('Pulling from ' + tasks.length + ' platform(s)…', 'info');
  await Promise.allSettled(tasks);
  await recomputeScores(activeClient.id);
  loadPerformanceTab();
}

async function runPull(provider, fnName, body) {
  const btn = document.getElementById('pull-' + provider + '-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Pulling…'; }
  try {
    const r = await fetch(SB_URL + '/functions/v1/' + fnName, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + SB_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await r.json();
    if (!data.ok) throw new Error(data.error || 'Pull failed');
    await recomputeScores(activeClient.id);
    toast('Pulled ' + data.count + ' ' + provider + ' posts', 'success');
    return data;
  } catch (e) {
    toast(provider + ' pull failed: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = labelFor(provider); }
  }
}

function labelFor(provider) {
  return provider === 'instagram' ? 'Pull Instagram' : 'Pull TikTok';
}

// ---------- 4. Performance tab — replaces previous loadPerformanceTab ----------

async function loadPerformanceTab() {
  const root = document.getElementById('ctab-performance');
  if (!root || !activeClient) return;

  root.innerHTML = '<div class="empty">Loading performance data…</div>';

  const [integrations, posts, scoresRows] = await Promise.all([
    loadIntegrations(),
    sbGet('social_posts?client_id=eq.' + activeClient.id +
          '&order=published_at.desc&limit=500&select=*'),
    sbGet('performance_scores?client_id=eq.' + activeClient.id + '&select=*')
  ]);

  const ig = getIntegration(integrations, 'instagram');
  const tt = getIntegration(integrations, 'tiktok');

  const scoreByPost = {};
  scoresRows.forEach(s => { scoreByPost[s.post_id] = s; });

  const decorated = posts.map(p => ({ ...p, _score: scoreByPost[p.id] || null }))
                         .sort((a, b) => (b._score?.composite_score || 0) - (a._score?.composite_score || 0));
  const top = decorated.slice(0, 12);

  const total = posts.length;
  const totalReach = posts.reduce((s, p) => s + (p.reach || 0), 0);
  const totalEng = posts.reduce((s, p) => s + (p.likes || 0) + (p.comments || 0) + (p.saves || 0) + (p.shares || 0), 0);
  const avgScore = scoresRows.length
    ? Math.round(scoresRows.reduce((s, r) => s + Number(r.composite_score || 0), 0) / scoresRows.length)
    : 0;

  const igCount = posts.filter(p => p.network === 'instagram').length;
  const ttCount = posts.filter(p => p.network === 'tiktok').length;

  root.innerHTML = `
    <div class="perf-header">
      <div>
        <h2>90-Day Strategy</h2>
        <p class="muted">Direct from ${esc(activeClient.brand_name || activeClient.name)}'s connected accounts.</p>
      </div>
      <div class="perf-actions">
        ${(ig || tt) ? `<button class="btn btn-primary" onclick="pullAll()">Pull All</button>` : ''}
        <label class="btn btn-ghost" style="cursor:pointer;margin:0">
          Import CSV
          <input type="file" accept=".csv" style="display:none"
                 onchange="if(this.files[0])handleCsvUpload(this.files[0])">
        </label>
      </div>
    </div>

    <div class="connector-grid">
      ${renderConnectorCard('instagram', 'Instagram', ig, igCount)}
      ${renderConnectorCard('tiktok',    'TikTok',    tt, ttCount)}
    </div>

    ${total === 0 ? `
      <div class="empty">
        <p>No performance data yet.</p>
        <p class="muted">${(ig || tt) ? 'Click "Pull All" to fetch the last 90 days.' : 'Connect a platform above to get started.'}</p>
      </div>
    ` : `
      <div class="perf-stats">
        <div class="stat-card"><div class="stat-num">${total}</div><div class="stat-lbl">Posts</div></div>
        <div class="stat-card"><div class="stat-num">${totalReach.toLocaleString()}</div><div class="stat-lbl">Total Reach</div></div>
        <div class="stat-card"><div class="stat-num">${totalEng.toLocaleString()}</div><div class="stat-lbl">Total Engagement</div></div>
        <div class="stat-card"><div class="stat-num">${avgScore}</div><div class="stat-lbl">Avg Score</div></div>
      </div>

      <div class="perf-section-head">
        <h3>Proven Performers — Top 12</h3>
        <button class="btn btn-primary" onclick="generateStrategyBrief()">Generate Strategy Brief</button>
      </div>

      <div class="performer-grid">
        ${top.map(p => renderPerformerCard(p)).join('')}
      </div>

      <div id="brief-output"></div>

      <h3 style="margin-top:32px">Repost Queue</h3>
      <div id="repost-queue"></div>
    `}
  `;

  loadRepostQueue();
}

function renderConnectorCard(provider, label, integ, postCount) {
  const isConnected = !!integ?.access_token;
  const expiresIn = integ?.token_expires_at
    ? Math.floor((new Date(integ.token_expires_at).getTime() - Date.now()) / 86400000)
    : null;
  const lastPulled = integ?.last_pulled_at
    ? new Date(integ.last_pulled_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : '—';

  const tokenWarn = expiresIn !== null && expiresIn < 7
    ? `<span class="token-warn">Token expires in ${expiresIn}d</span>`
    : '';

  return `
    <div class="connector-card connector-${provider} ${isConnected ? 'connected' : ''}">
      <div class="cc-head">
        <div class="cc-icon ${provider}-icon"></div>
        <div>
          <div class="cc-label">${label}</div>
          <div class="cc-status">
            ${isConnected
              ? `<strong>@${esc(integ.platform_username || '—')}</strong> · ${postCount} posts · last pulled ${lastPulled}`
              : 'Not connected'}
            ${tokenWarn}
          </div>
        </div>
      </div>
      <div class="cc-actions">
        ${isConnected
          ? `<button id="pull-${provider}-btn" class="btn btn-violet" onclick="pullFrom${provider === 'instagram' ? 'Instagram' : 'TikTok'}()">${labelFor(provider)}</button>
             <button class="btn btn-ghost" onclick="disconnectPlatform('${provider}')">Disconnect</button>`
          : `<button class="btn btn-primary" onclick="startOAuth('${provider}')">Connect ${label}</button>`}
      </div>
    </div>
  `;
}

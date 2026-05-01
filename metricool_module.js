// =============================================================
// YAH! Metricool Module — paste at bottom of <script> in index.html
// Adds: 90-day strategy tab, score engine, CSV import, API pull,
// repost scheduler, Claude-generated strategy brief
// =============================================================

// ---------- 1. Score engine ----------

/**
 * Composite performance score (0–100). Heavier weight on saves & shares
 * because they signal real value over vanity metrics.
 *   reach percentile  : 30%
 *   save rate         : 30%
 *   share rate        : 20%
 *   engagement rate   : 20%
 */
function scorePosts(posts) {
  if (!posts.length) return [];

  const reaches = posts.map(p => Math.max(0, p.reach || 0)).sort((a, b) => a - b);
  const pct = (val) => {
    if (!reaches.length) return 0;
    const idx = reaches.findIndex(r => r >= val);
    if (idx === -1) return 100;
    return Math.round((idx / reaches.length) * 100);
  };

  return posts.map(p => {
    const reach = Math.max(1, p.reach || 0); // avoid divide-by-zero
    const saves = p.saves || 0;
    const shares = p.shares || 0;
    const eng = (p.likes || 0) + (p.comments || 0) + saves + shares;

    const reach_pct = pct(p.reach || 0);
    const save_rate = saves / reach;
    const share_rate = shares / reach;
    const eng_rate = eng / reach;

    // Normalize rates against reasonable ceilings, then weight.
    const composite =
      (reach_pct * 0.30) +
      (Math.min(save_rate / 0.04, 1) * 100 * 0.30) +   // 4% save rate = perfect
      (Math.min(share_rate / 0.03, 1) * 100 * 0.20) +  // 3% share rate = perfect
      (Math.min(eng_rate / 0.10, 1) * 100 * 0.20);     // 10% eng rate = perfect

    return {
      post_id: p.id,
      client_id: p.client_id,
      composite_score: Math.round(composite * 100) / 100,
      reach_percentile: reach_pct,
      save_rate: Math.round(save_rate * 10000) / 10000,
      share_rate: Math.round(share_rate * 10000) / 10000,
      engagement_rate: Math.round(eng_rate * 10000) / 10000,
      tier: composite >= 70 ? 'top' : composite >= 40 ? 'mid' : 'low',
      computed_at: new Date().toISOString()
    };
  });
}

async function recomputeScores(clientId) {
  const posts = await sbGet('metricool_posts?client_id=eq.' + clientId + '&select=*');
  if (!posts.length) return 0;
  const scores = scorePosts(posts);
  // Wipe + reinsert (simpler than upsert with composite UNIQUE)
  await sbDelete('performance_scores?client_id=eq.' + clientId);
  if (scores.length) await sbPost('performance_scores', scores);
  return scores.length;
}

// ---------- 2. CSV import (Starter plan path) ----------

/**
 * Metricool CSV export columns vary by version. We accept a flexible header
 * map — find columns by fuzzy name match.
 */
function parseMetricoolCSV(text) {
  const lines = text.replace(/\r/g, '').split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];

  const splitCSV = (line) => {
    const out = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; continue; }
      if (c === '"') { inQ = !inQ; continue; }
      if (c === ',' && !inQ) { out.push(cur); cur = ''; continue; }
      cur += c;
    }
    out.push(cur);
    return out;
  };

  const headers = splitCSV(lines[0]).map(h => h.trim().toLowerCase());

  const findCol = (...names) => {
    for (const n of names) {
      const idx = headers.findIndex(h => h.includes(n));
      if (idx !== -1) return idx;
    }
    return -1;
  };

  const cols = {
    id: findCol('post id', 'media id', 'id'),
    type: findCol('type', 'format'),
    caption: findCol('caption', 'text', 'description'),
    permalink: findCol('permalink', 'url', 'link'),
    thumbnail: findCol('thumbnail', 'image'),
    date: findCol('date', 'published', 'timestamp'),
    reach: findCol('reach'),
    impressions: findCol('impressions'),
    views: findCol('views', 'plays', 'video views'),
    likes: findCol('likes'),
    comments: findCol('comments'),
    saves: findCol('saved', 'saves'),
    shares: findCol('shares'),
    network: findCol('network', 'platform'),
  };

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCSV(lines[i]);
    if (cells.length < 2) continue;
    const get = (k) => cols[k] >= 0 ? (cells[cols[k]] || '').trim() : '';
    const num = (k) => parseInt(get(k).replace(/[^\d-]/g, ''), 10) || 0;
    const id = get('id') || ('csv_' + i + '_' + Date.now());
    rows.push({
      external_id: id,
      network: (get('network') || 'instagram').toLowerCase(),
      post_type: (get('type') || 'image').toLowerCase(),
      caption: get('caption'),
      permalink: get('permalink'),
      thumbnail_url: get('thumbnail'),
      published_at: get('date') ? new Date(get('date')).toISOString() : null,
      reach: num('reach'),
      impressions: num('impressions'),
      views: num('views'),
      likes: num('likes'),
      comments: num('comments'),
      saves: num('saves'),
      shares: num('shares'),
      source: 'csv',
    });
  }
  return rows;
}

async function handleCsvUpload(file) {
  if (!activeClient) return toast('Open a client first', 'error');
  const text = await file.text();
  const rows = parseMetricoolCSV(text);
  if (!rows.length) return toast('No rows parsed from CSV', 'error');
  const withClient = rows.map(r => ({ ...r, client_id: activeClient.id }));
  await sbPost('metricool_posts', withClient);
  await recomputeScores(activeClient.id);
  toast('Imported ' + rows.length + ' posts', 'success');
  loadPerformanceTab();
}

// ---------- 3. API pull (Advanced plan path) ----------

async function pullFromMetricool(days = 90) {
  if (!activeClient) return toast('Open a client first', 'error');
  const btn = document.getElementById('mc-pull-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Pulling…'; }

  try {
    const r = await fetch(SB_URL + '/functions/v1/pull-metricool', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + SB_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: activeClient.id, days })
    });
    const data = await r.json();
    if (!data.ok) throw new Error(data.error || 'Pull failed');
    await recomputeScores(activeClient.id);
    toast('Pulled ' + data.count + ' posts from Metricool', 'success');
    if (data.errors) console.warn('Metricool partial errors:', data.errors);
    loadPerformanceTab();
  } catch (e) {
    toast('Pull failed: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Pull from Metricool'; }
  }
}

// ---------- 4. Integration credentials ----------

async function loadIntegration() {
  if (!activeClient) return null;
  const rows = await sbGet(
    'client_integrations?client_id=eq.' + activeClient.id +
    '&provider=eq.metricool&select=*&limit=1'
  );
  return rows[0] || null;
}

async function saveIntegration() {
  if (!activeClient) return;
  const payload = {
    client_id: activeClient.id,
    provider: 'metricool',
    api_key: document.getElementById('mc-key').value.trim(),
    account_blog_id: document.getElementById('mc-blog').value.trim(),
    user_id: document.getElementById('mc-user').value.trim(),
    plan_tier: document.getElementById('mc-tier').value,
    active: true,
  };
  const existing = await loadIntegration();
  if (existing) {
    await sbPatch('client_integrations?id=eq.' + existing.id, payload);
  } else {
    await sbPost('client_integrations', payload);
  }
  toast('Metricool credentials saved', 'success');
  loadPerformanceTab();
}

// ---------- 5. Performance tab loader ----------

async function loadPerformanceTab() {
  const root = document.getElementById('ctab-performance');
  if (!root || !activeClient) return;

  root.innerHTML = '<div class="empty">Loading performance data…</div>';

  const [integ, posts, scoresRows] = await Promise.all([
    loadIntegration(),
    sbGet('metricool_posts?client_id=eq.' + activeClient.id +
          '&order=published_at.desc&limit=500&select=*'),
    sbGet('performance_scores?client_id=eq.' + activeClient.id + '&select=*')
  ]);

  // Index scores by post_id
  const scoreByPost = {};
  scoresRows.forEach(s => { scoreByPost[s.post_id] = s; });

  // Decorate posts with scores
  const decorated = posts.map(p => ({ ...p, _score: scoreByPost[p.id] || null }))
                         .sort((a, b) => (b._score?.composite_score || 0) - (a._score?.composite_score || 0));

  const top = decorated.slice(0, 12);
  const isAdvanced = integ?.plan_tier === 'advanced';

  // Aggregate stats
  const total = posts.length;
  const totalReach = posts.reduce((s, p) => s + (p.reach || 0), 0);
  const totalEng = posts.reduce((s, p) => s + (p.likes || 0) + (p.comments || 0) + (p.saves || 0) + (p.shares || 0), 0);
  const avgScore = scoresRows.length
    ? Math.round(scoresRows.reduce((s, r) => s + Number(r.composite_score || 0), 0) / scoresRows.length)
    : 0;

  root.innerHTML = `
    <div class="perf-header">
      <div>
        <h2>90-Day Strategy</h2>
        <p class="muted">Performance-driven content strategy for ${esc(activeClient.brand_name || activeClient.name)}.</p>
      </div>
      <div class="perf-actions">
        ${integ ? `
          ${isAdvanced ? `<button id="mc-pull-btn" class="btn btn-violet" onclick="pullFromMetricool(90)">Pull from Metricool</button>` : ''}
          <label class="btn btn-ghost" style="cursor:pointer;margin:0">
            Import CSV
            <input type="file" accept=".csv" style="display:none"
                   onchange="if(this.files[0])handleCsvUpload(this.files[0])">
          </label>
        ` : ''}
        <button class="btn btn-ghost" onclick="toggleIntegrationPanel()">
          ${integ ? 'Edit Credentials' : 'Connect Metricool'}
        </button>
      </div>
    </div>

    <div id="mc-integration-panel" class="integration-panel" style="display:none">
      <h3>Metricool Credentials</h3>
      <p class="muted">Find these in Metricool → Settings → API. Plan tier affects which paths work.</p>
      <div class="integration-grid">
        <label>
          <span>API Key (User Token)</span>
          <input id="mc-key" type="password" value="${esc(integ?.api_key || '')}" placeholder="X-Mc-Auth value">
        </label>
        <label>
          <span>Blog ID</span>
          <input id="mc-blog" value="${esc(integ?.account_blog_id || '')}" placeholder="123456">
        </label>
        <label>
          <span>User ID</span>
          <input id="mc-user" value="${esc(integ?.user_id || '')}" placeholder="789012">
        </label>
        <label>
          <span>Plan Tier</span>
          <select id="mc-tier">
            <option value="starter" ${integ?.plan_tier !== 'advanced' ? 'selected' : ''}>Starter (CSV only)</option>
            <option value="advanced" ${integ?.plan_tier === 'advanced' ? 'selected' : ''}>Advanced (API + CSV)</option>
          </select>
        </label>
      </div>
      <button class="btn btn-primary" onclick="saveIntegration()">Save Credentials</button>
    </div>

    ${total === 0 ? `
      <div class="empty">
        <p>No performance data yet.</p>
        <p class="muted">${integ ? 'Pull from Metricool or import a CSV to get started.' : 'Connect Metricool credentials first.'}</p>
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

function renderPerformerCard(p) {
  const score = p._score?.composite_score || 0;
  const tier = p._score?.tier || 'low';
  const tierColor = tier === 'top' ? 'var(--lime-dk)' : tier === 'mid' ? 'var(--amber)' : 'var(--muted)';
  const date = p.published_at ? new Date(p.published_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—';
  const caption = (p.caption || '').slice(0, 110);
  return `
    <div class="performer-card">
      <div class="pc-head">
        <span class="pc-score" style="background:${tierColor}">${Math.round(score)}</span>
        <span class="pc-type">${esc(p.post_type || 'post')}</span>
        <span class="pc-date">${esc(date)}</span>
      </div>
      <div class="pc-caption">${esc(caption)}${caption.length === 110 ? '…' : ''}</div>
      <div class="pc-metrics">
        <span title="Reach">👁 ${(p.reach || 0).toLocaleString()}</span>
        <span title="Saves">🔖 ${(p.saves || 0).toLocaleString()}</span>
        <span title="Shares">↗ ${(p.shares || 0).toLocaleString()}</span>
        <span title="Likes">❤ ${(p.likes || 0).toLocaleString()}</span>
      </div>
      <div class="pc-actions">
        <button class="btn btn-ghost btn-sm" onclick="queueRepost('${p.id}')">Queue Repost</button>
        ${p.permalink ? `<a class="btn btn-ghost btn-sm" href="${esc(p.permalink)}" target="_blank">View</a>` : ''}
      </div>
    </div>
  `;
}

function toggleIntegrationPanel() {
  const el = document.getElementById('mc-integration-panel');
  if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

// ---------- 6. Repost queue ----------

async function queueRepost(postId) {
  if (!activeClient) return;
  const minDate = new Date();
  minDate.setDate(minDate.getDate() + 60); // 60-day cooldown default
  await sbPost('repost_schedule', [{
    client_id: activeClient.id,
    source_post_id: postId,
    scheduled_for: minDate.toISOString().slice(0, 10),
    status: 'queued'
  }]);
  toast('Queued for repost', 'success');
  loadRepostQueue();
}

async function loadRepostQueue() {
  const root = document.getElementById('repost-queue');
  if (!root || !activeClient) return;
  const queued = await sbGet(
    'repost_schedule?client_id=eq.' + activeClient.id +
    '&order=scheduled_for.asc&select=*,metricool_posts(caption,permalink,post_type)'
  );
  if (!queued.length) {
    root.innerHTML = '<p class="muted">No reposts queued. Click "Queue Repost" on a top performer.</p>';
    return;
  }
  root.innerHTML = '<table class="repost-tbl"><thead><tr>' +
    '<th>Scheduled</th><th>Type</th><th>Caption</th><th>Status</th><th></th>' +
    '</tr></thead><tbody>' +
    queued.map(r => {
      const post = r.metricool_posts || {};
      return `<tr>
        <td>${esc(r.scheduled_for || '')}</td>
        <td>${esc(post.post_type || '')}</td>
        <td>${esc((post.caption || '').slice(0, 80))}</td>
        <td><span class="status-pill status-${r.status}">${esc(r.status)}</span></td>
        <td><button class="btn btn-ghost btn-sm" onclick="cancelRepost('${r.id}')">Cancel</button></td>
      </tr>`;
    }).join('') +
    '</tbody></table>';
}

async function cancelRepost(id) {
  await sbPatch('repost_schedule?id=eq.' + id, { status: 'cancelled' });
  loadRepostQueue();
}

// ---------- 7. Claude-generated strategy brief ----------

async function generateStrategyBrief() {
  if (!activeClient) return;
  const out = document.getElementById('brief-output');
  if (!out) return;
  out.innerHTML = '<div class="generating visible">Analyzing 90 days of performance…</div>';

  const apiKey = getApiKey();
  if (!apiKey) {
    out.innerHTML = '<p class="error">Set Anthropic API key in Settings first.</p>';
    return;
  }

  // Pull top 30 by score for context
  const posts = await sbGet('metricool_posts?client_id=eq.' + activeClient.id + '&order=published_at.desc&limit=200&select=*');
  const scores = await sbGet('performance_scores?client_id=eq.' + activeClient.id + '&select=*');
  const scoreMap = {};
  scores.forEach(s => { scoreMap[s.post_id] = s.composite_score; });
  const enriched = posts.map(p => ({
    type: p.post_type,
    pillar: p.pillar || 'unassigned',
    caption: (p.caption || '').slice(0, 200),
    score: scoreMap[p.id] || 0,
    reach: p.reach,
    saves: p.saves,
    shares: p.shares,
  })).sort((a, b) => b.score - a.score).slice(0, 30);

  const pillars = await sbGet('pillars?client_id=eq.' + activeClient.id + '&active=eq.true&select=*');

  const systemPrompt = `You are a content strategist for ${activeClient.brand_name}.

CLIENT VOICE: ${activeClient.brand_voice || ''}
AVOID: ${activeClient.brand_avoid || ''}

PILLARS:
${pillars.map(p => '- ' + p.name + ': ' + p.description).join('\n')}

You are analyzing 90 days of social performance. The data is the top-scored posts (composite 0-100, weighted to favor saves and shares over likes).

Produce a strategy brief with these sections (use Markdown headers):

## What's Working
3-5 bullet points: themes, formats, hooks driving the highest scores.

## What to Repost
3-5 specific posts (reference by caption snippet) that should re-enter the calendar in the next 30 days.

## Fresh Content Directions
4-6 NEW post ideas extending proven themes — title + one-line concept each.

## Pillar Balance
Quick read on which pillars are over- and under-performing.

Be direct and specific. No fluff. No "in conclusion."`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        system: systemPrompt,
        messages: [{
          role: 'user',
          content: 'Top 30 posts (sorted by composite score):\n\n' +
                   JSON.stringify(enriched, null, 2)
        }]
      })
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data?.error?.message || 'API error');
    const text = cleanEmDashes(data.content?.[0]?.text || '');

    // Save brief
    await sbPost('strategy_briefs', [{
      client_id: activeClient.id,
      period_start: new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10),
      period_end: new Date().toISOString().slice(0, 10),
      brief_content: text,
      raw_metrics: { post_count: posts.length, avg_score: scores.length ? scores.reduce((s, x) => s + Number(x.composite_score), 0) / scores.length : 0 }
    }]);

    out.innerHTML = '<div class="brief-card">' + renderMarkdown(text) + '</div>';
    toast('Strategy brief saved', 'success');
  } catch (e) {
    out.innerHTML = '<p class="error">Brief generation failed: ' + esc(e.message) + '</p>';
  }
}

// Tiny Markdown renderer (headers, bold, bullets) — keeps brief readable inline.
function renderMarkdown(md) {
  return esc(md)
    .replace(/^### (.+)$/gm, '<h4>$1</h4>')
    .replace(/^## (.+)$/gm, '<h3>$1</h3>')
    .replace(/^# (.+)$/gm, '<h2>$1</h2>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\s*)+/g, '<ul>$&</ul>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/^([^<].+)$/gm, (m) => /<\/?(h\d|ul|li|p|strong)/.test(m) ? m : '<p>' + m + '</p>');
}

// ---------- 8. Hook into existing tab system ----------
// In switchClientTab(), add:    if (tab === 'performance') loadPerformanceTab();

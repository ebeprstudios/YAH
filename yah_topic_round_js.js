// ============================================================
// YAH — Topic Round logic (drop-in)
// Paste into your existing <script> block, after renderPlan().
//
// One additional wiring step:
//   In your existing openClient() (or whatever loads a client
//   into the right pane), add this line at the bottom:
//
//       loadTopicRoundState();
//
// That ensures the Topics sub-tab shows the correct state for
// whichever client you opened.
// ============================================================

// ----- Topic round state (per active client) -----
const topicState = {
  round: null,            // current topic_rounds row
  topics: [],             // current plan_topics rows
  view: 'topics',         // 'topics' | 'calendar'
  generating: false,
  selections: new Set(),  // ids of topics currently CHECKED for review
  rejectionNotes: {}      // { topicId: 'reason' } — captured before send
};

// ============================================================
// Sub-tab switching
// ============================================================
function switchPlannerSub(which) {
  topicState.view = which;
  document.querySelectorAll('.planner-subtab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.planner-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('subtab-' + which)?.classList.add('active');
  document.getElementById('planner-' + which)?.classList.add('active');
}

// ============================================================
// Director's-notes chips
// ============================================================
function addDirectorChip(btn) {
  const ta = document.getElementById('topic-director-notes');
  if (!ta) return;
  const chip = btn.dataset.chip || btn.textContent.replace(/^\+\s*/, '');
  const cur = (ta.value || '').trim();
  ta.value = cur ? cur + '\n' + chip : chip;
  ta.focus();
  btn.style.opacity = '0.4';
  btn.disabled = true;
}

// ============================================================
// Load round state on client open
// Call this from your openClient() after activeClient is set.
// ============================================================
async function loadTopicRoundState() {
  if (!activeClient) return;

  // Reset state
  topicState.round = null;
  topicState.topics = [];
  topicState.selections = new Set();
  topicState.rejectionNotes = {};

  try {
    // Find latest non-archived round for this client
    const rounds = await sbGet(
      `topic_rounds?client_id=eq.${activeClient.id}` +
      `&order=created_at.desc&limit=1&select=*`
    );

    if (!rounds || rounds.length === 0) {
      renderTopicEmptyState();
      return;
    }

    topicState.round = rounds[0];

    // Fetch topics for this round
    const topics = await sbGet(
      `plan_topics?round_id=eq.${topicState.round.id}` +
      `&order=position.asc&select=*`
    );
    topicState.topics = Array.isArray(topics) ? topics : [];

    // Default selections = every non-rejected topic checked
    topicState.selections = new Set(
      topicState.topics
        .filter(t => t.status !== 'rejected')
        .map(t => t.id)
    );

    renderTopicRoundView();
  } catch (e) {
    console.warn('loadTopicRoundState failed:', e);
    renderTopicEmptyState();
  }

  // Update sub-tab status pills
  updateSubtabStatus();
}

// ============================================================
// Render: empty state
// ============================================================
function renderTopicEmptyState() {
  const empty = document.getElementById('topic-empty-state');
  const round = document.getElementById('topic-round-view');
  const loading = document.getElementById('topic-loading');
  if (empty) empty.style.display = '';
  if (round) round.style.display = 'none';
  if (loading) loading.style.display = 'none';

  // Default month label to current month + year
  const monthInput = document.getElementById('topic-month-label');
  if (monthInput && !monthInput.value) {
    const d = new Date();
    monthInput.value = d.toLocaleString('en-US', { month: 'long', year: 'numeric' });
  }
}

// ============================================================
// Render: round view (header + cards + footer)
// ============================================================
function renderTopicRoundView() {
  const empty = document.getElementById('topic-empty-state');
  const round = document.getElementById('topic-round-view');
  const loading = document.getElementById('topic-loading');
  if (empty) empty.style.display = 'none';
  if (round) round.style.display = '';
  if (loading) loading.style.display = 'none';

  if (!topicState.round) return;
  const r = topicState.round;

  // Header pills + title
  const pill = document.getElementById('topic-round-status-pill');
  if (pill) {
    const lbl = ({
      draft: 'DRAFT',
      sent: 'SENT FOR APPROVAL',
      approved: 'APPROVED',
      changes_requested: 'CHANGES REQUESTED'
    })[r.status] || r.status.toUpperCase();
    pill.textContent = lbl;
    pill.className = 'topic-round-status ' + r.status;
  }
  const monthLbl = document.getElementById('topic-round-month-label');
  if (monthLbl) monthLbl.textContent = r.month_label || '';
  const countLbl = document.getElementById('topic-round-count-label');
  if (countLbl) countLbl.textContent = topicState.topics.length + ' topics';
  const notesDisp = document.getElementById('topic-round-director-notes-display');
  if (notesDisp) {
    notesDisp.textContent = r.director_notes || '';
    notesDisp.style.display = r.director_notes ? '' : 'none';
  }

  // Action buttons by status
  const actions = document.getElementById('topic-round-actions');
  if (actions) {
    if (r.status === 'draft') {
      actions.innerHTML = `
        <button class="btn btn-ghost btn-sm" onclick="regenerateTopicRound()">Regenerate</button>
      `;
    } else if (r.status === 'sent') {
      actions.innerHTML = `
        <button class="btn btn-ghost btn-sm" onclick="copyApprovalLink()">Copy approval link</button>
      `;
    } else if (r.status === 'approved') {
      actions.innerHTML = `
        <button class="btn btn-primary btn-sm" onclick="switchPlannerSub('calendar')">Build calendar →</button>
      `;
    } else {
      actions.innerHTML = '';
    }
  }

  // Topic cards
  renderTopicCards();

  // Footer (only during draft review)
  const footer = document.getElementById('topic-round-footer');
  if (footer) {
    if (r.status === 'draft') {
      footer.style.display = '';
      updateFooterSummary();
    } else {
      footer.style.display = 'none';
    }
  }

  updateSubtabStatus();
}

// ============================================================
// Render: topic cards
// ============================================================
function renderTopicCards() {
  const grid = document.getElementById('topic-grid');
  if (!grid) return;

  if (topicState.topics.length === 0) {
    grid.innerHTML = '<div class="topic-card-section" style="grid-column: 1/-1; text-align:center; padding:40px;">No topics in this round.</div>';
    return;
  }

  const isDraft = topicState.round?.status === 'draft';

  grid.innerHTML = topicState.topics.map((t, i) => {
    const num = i + 1;
    const checked = topicState.selections.has(t.id);
    const isRejected = t.status === 'rejected';
    const fmt = t.suggested_reel_format || '';

    return `
      <div class="topic-card ${isRejected ? 'rejected' : ''}" data-topic-id="${esc(t.id)}">
        <div class="topic-card-row">
          <span class="topic-card-num">#${num}</span>
          ${isDraft ? `
            <input type="checkbox" class="topic-card-checkbox"
              ${checked ? 'checked' : ''}
              onchange="toggleTopicSelection('${esc(t.id)}', this.checked)" />
          ` : ''}
        </div>

        <h3 class="topic-card-title">${esc(t.title || '')}</h3>

        <div class="topic-card-pills">
          ${t.pillar ? `<span class="topic-pill pillar">${esc(t.pillar)}</span>` : ''}
          ${t.suggested_post_type ? `<span class="topic-pill posttype">${esc(t.suggested_post_type)}</span>` : ''}
          ${fmt ? `<span class="topic-pill format ${esc(fmt)}">${esc(formatReelFmt(fmt))}</span>` : ''}
        </div>

        ${t.hook_angle ? `
          <div class="topic-card-section">
            <span class="topic-card-section-label">Hook angle</span>
            ${esc(t.hook_angle)}
          </div>
        ` : ''}

        ${t.why_it_works ? `
          <div class="topic-card-section">
            <span class="topic-card-section-label">Why it works</span>
            ${esc(t.why_it_works)}
          </div>
        ` : ''}

        ${(t.source_type || t.source_ref) ? `
          <div class="topic-card-source">
            ${esc(t.source_type || 'source')}${t.source_ref ? ': ' + esc(t.source_ref) : ''}
          </div>
        ` : ''}
      </div>
    `;
  }).join('');
}

function formatReelFmt(f) {
  return ({ talking_head: 'Talking head', voiceover: 'Voiceover', b_roll_only: 'B-roll only', hybrid: 'Hybrid' })[f] || f;
}

// ============================================================
// Selection handling
// ============================================================
function toggleTopicSelection(topicId, checked) {
  if (checked) topicState.selections.add(topicId);
  else topicState.selections.delete(topicId);

  const card = document.querySelector(`.topic-card[data-topic-id="${topicId}"]`);
  if (card) card.classList.toggle('rejected', !checked);

  updateFooterSummary();
}

function updateFooterSummary() {
  const el = document.getElementById('topic-footer-summary');
  if (!el) return;
  const total = topicState.topics.length;
  const kept = topicState.selections.size;
  const dropped = total - kept;
  el.innerHTML = `Reviewing <strong>${total}</strong> topics · keeping <strong>${kept}</strong>${dropped ? ` · dropping <strong>${dropped}</strong>` : ''}`;
}

function updateSubtabStatus() {
  const tStatus = document.getElementById('subtab-status-topics');
  const cStatus = document.getElementById('subtab-status-calendar');
  const cTab = document.getElementById('subtab-calendar');

  if (!topicState.round) {
    if (tStatus) tStatus.textContent = 'No round yet';
    if (cStatus) cStatus.textContent = 'Locked until topics approved';
    if (cTab) cTab.disabled = true;
    return;
  }

  const r = topicState.round;
  const lbls = {
    draft: 'Draft · review',
    sent: 'Sent · awaiting client',
    approved: 'Approved · ' + topicState.selections.size + ' topics',
    changes_requested: 'Changes requested'
  };
  if (tStatus) tStatus.textContent = lbls[r.status] || r.status;

  if (r.status === 'approved') {
    if (cStatus) cStatus.textContent = 'Ready to build';
    if (cTab) cTab.disabled = false;
  } else {
    if (cStatus) cStatus.textContent = 'Locked until topics approved';
    if (cTab) cTab.disabled = true;
  }
}

// ============================================================
// Generation
// ============================================================
async function generateTopicRound() {
  const apiKey = getApiKey();
  if (!apiKey) {
    toast('Set your Anthropic API key in Settings first', 'error');
    return;
  }
  if (!activeClient) return toast('No client selected', 'error');

  const monthLabel = (document.getElementById('topic-month-label')?.value || '').trim();
  const directorNotes = (document.getElementById('topic-director-notes')?.value || '').trim();
  const targetCount = parseInt(document.getElementById('topic-count')?.value || '32', 10);

  if (!monthLabel) {
    toast('Enter a month label first', 'error');
    document.getElementById('topic-month-label')?.focus();
    return;
  }

  // Hide empty/round, show loading
  document.getElementById('topic-empty-state').style.display = 'none';
  document.getElementById('topic-round-view').style.display = 'none';
  document.getElementById('topic-loading').style.display = '';
  document.getElementById('topic-loading-count').textContent = targetCount;
  topicState.generating = true;

  try {
    // Pull proof + knowledge in parallel — same plumbing as plan generator
    const [topPerformers, knowledgeDocs] = await Promise.all([
      typeof fetchTopPerformers === 'function' ? fetchTopPerformers(activeClient.id, 20) : Promise.resolve([]),
      typeof fetchKnowledgeForPlan === 'function' ? fetchKnowledgeForPlan(activeClient.id) : Promise.resolve([])
    ]);

    const topics = await callClaudeForTopicRound({
      apiKey,
      client: activeClient,
      monthLabel,
      directorNotes,
      targetCount,
      topPerformers,
      knowledgeDocs
    });

    if (!Array.isArray(topics) || topics.length === 0) {
      throw new Error('No topics returned');
    }

    // Persist round + topics
    const roundRow = await sbInsert('topic_rounds', {
      client_id: activeClient.id,
      month_label: monthLabel,
      status: 'draft',
      director_notes: directorNotes || null
    });
    if (!roundRow || !roundRow.id) throw new Error('Failed to create round');

    const topicRows = topics.map((t, i) => ({
      round_id: roundRow.id,
      client_id: activeClient.id,
      title: t.title || '(untitled)',
      hook_angle: t.hook_angle || null,
      pillar: t.pillar || null,
      suggested_post_type: t.suggested_post_type || null,
      suggested_reel_format: t.suggested_reel_format || null,
      why_it_works: t.why_it_works || null,
      source_type: t.source_type || null,
      source_ref: t.source_ref || null,
      status: 'pending',
      position: i + 1
    }));

    const inserted = await sbInsert('plan_topics', topicRows);

    topicState.round = roundRow;
    topicState.topics = Array.isArray(inserted) ? inserted : topicRows.map((r, i) => ({ ...r, id: 'tmp-' + i }));
    topicState.selections = new Set(topicState.topics.map(t => t.id));

    topicState.generating = false;
    renderTopicRoundView();
    toast(`Generated ${topicState.topics.length} topics`, 'success');
  } catch (e) {
    topicState.generating = false;
    document.getElementById('topic-loading').style.display = 'none';
    document.getElementById('topic-empty-state').style.display = '';
    toast('Generation failed: ' + e.message, 'error');
    console.error(e);
  }
}

// ============================================================
// Claude call
// ============================================================
async function callClaudeForTopicRound({ apiKey, client, monthLabel, directorNotes, targetCount, topPerformers, knowledgeDocs }) {
  // Reuse the same system prompt builder so all 9 personas + knowledge come along
  const baseSystem = (typeof buildPlannerSystemPrompt === 'function')
    ? buildPlannerSystemPrompt(client, topPerformers, knowledgeDocs)
    : '';

  const topicSystem = `${baseSystem}

═══════════════════════════════════════════
TOPIC ROUND TASK — DIFFERENT FROM CALENDAR PLAN
═══════════════════════════════════════════

Right now you are NOT building a calendar. You are generating a ROUND OF TOPICS.

A topic round is a brainstorm of ${targetCount} discrete content topics for the month "${monthLabel}". The client (and her team) will review these, approve a subset, and only THEN will those approved topics be sequenced into a calendar.

For each topic, surface:
  • title — the working name of the topic (a teaching, a story, a hook, an angle)
  • hook_angle — the single most compelling angle for this topic, in 1 sentence
  • pillar — exactly one of the client's active pillars
  • suggested_post_type — Reel | Carousel | Static | Quote
  • suggested_reel_format — talking_head | voiceover | b_roll_only | hybrid (only if post_type is Reel; otherwise empty string)
  • why_it_works — 1-2 sentences explaining why this topic is right for THIS client RIGHT NOW. Reference the proof corpus, knowledge library, or director's notes when relevant.
  • source_type — knowledge | proof | original | director_note
  • source_ref — the doc title (for knowledge), post number (for proof), or short tag (for director_note). Empty if original.

DIVERSITY REQUIREMENTS:
  • Distribute across ALL active pillars; no single pillar may exceed 40% of the round
  • Mix post types: lean Reel-heavy (~60%) but include carousels (~25%), quotes (~10%), statics (~5%)
  • For Reels: vary reel_format across talking_head, voiceover, b_roll_only, hybrid
  • Roughly 40% of topics should source from KNOWLEDGE (her actual transcripts/teachings)
  • Roughly 30% from PROOF (extending or remixing her recent published wins)
  • Roughly 20% original (net-new angles informed by director's notes)
  • Roughly 10% from DIRECTOR_NOTE if the notes specify anchors

QUALITY BAR:
  • Every title must be specific, not generic. NOT "Faith and business." YES "The bankruptcy moment that taught me Heaven multiplies what you surrender."
  • Honor every voice rule from the brand profile and knowledge library
  • If the client has a Brand Bible, mine it for catchphrases and named teachings
  • NO em-dashes anywhere

OUTPUT FORMAT — return ONLY a JSON array, no preamble or explanation:
[
  {
    "title": "...",
    "hook_angle": "...",
    "pillar": "...",
    "suggested_post_type": "...",
    "suggested_reel_format": "...",
    "why_it_works": "...",
    "source_type": "...",
    "source_ref": "..."
  },
  ... ${targetCount} items total
]
`;

  const userPrompt = `Generate ${targetCount} topic ideas for ${client.name || 'this client'} for ${monthLabel}.

DIRECTOR'S NOTES (treat as anchors):
${directorNotes || '(none — generate a balanced standard month)'}

Return ONLY the JSON array. No commentary.`;

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8000,
      system: topicSystem,
      messages: [{ role: 'user', content: userPrompt }]
    })
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Claude API ${resp.status}: ${errText.slice(0, 200)}`);
  }

  const data = await resp.json();
  let text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');

  // Inherit em-dash cleanup if available
  if (typeof cleanEmDashes === 'function') text = cleanEmDashes(text);

  // Extract JSON array from anywhere in the response
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('Could not parse JSON array from response');
  const arr = JSON.parse(match[0]);
  if (!Array.isArray(arr)) throw new Error('Response was not a JSON array');
  return arr;
}

// ============================================================
// Regenerate (kills draft round, returns to empty state)
// ============================================================
async function regenerateTopicRound() {
  if (!topicState.round || topicState.round.status !== 'draft') return;
  if (!confirm('Discard this draft round and start over?')) return;

  try {
    // Delete topics first (FK), then round
    await fetch(SUPABASE_URL + `/rest/v1/plan_topics?round_id=eq.${topicState.round.id}`, {
      method: 'DELETE',
      headers: sbHeaders()
    });
    await fetch(SUPABASE_URL + `/rest/v1/topic_rounds?id=eq.${topicState.round.id}`, {
      method: 'DELETE',
      headers: sbHeaders()
    });

    topicState.round = null;
    topicState.topics = [];
    topicState.selections = new Set();
    renderTopicEmptyState();
    updateSubtabStatus();
    toast('Draft cleared', 'success');
  } catch (e) {
    toast('Could not clear draft: ' + e.message, 'error');
  }
}

// ============================================================
// Send for approval (next build step wires the email)
// ============================================================
async function sendTopicRoundForApproval() {
  if (!topicState.round) return;

  // Persist any rejections (unchecked topics)
  const rejected = topicState.topics.filter(t => !topicState.selections.has(t.id));
  if (rejected.length > 0) {
    for (const t of rejected) {
      await fetch(SUPABASE_URL + `/rest/v1/plan_topics?id=eq.${t.id}`, {
        method: 'PATCH',
        headers: { ...sbHeaders(), 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
        body: JSON.stringify({ status: 'rejected' })
      });
    }
  }

  toast('Email send wires in next step. Round is staged — ' + topicState.selections.size + ' topics kept.', '');
  // The next build step wires: 1) generate approval token, 2) send email via Resend, 3) mark round as 'sent'
}

function copyApprovalLink() {
  toast('Approval page wires in next step', '');
}

// ============================================================
// Helpers — fall through to existing utilities if present
// ============================================================
function sbHeaders() {
  // Mirror your existing Supabase header builder if you have one
  return {
    'apikey': window.SUPABASE_ANON_KEY || SUPABASE_ANON_KEY,
    'Authorization': 'Bearer ' + (window.SUPABASE_ANON_KEY || SUPABASE_ANON_KEY)
  };
}

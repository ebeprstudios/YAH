# YAH! Metricool Integration — Assembly Guide

This drops a complete **90-Day Strategy** module into YAH:

- Pulls posts + analytics from Metricool (API or CSV)
- Scores every post on a composite 0–100 (weighted toward saves & shares)
- Surfaces top performers
- Queues reposts with a 60-day cooldown
- Generates a Claude strategy brief — what's working, what to repost, fresh content directions, pillar balance

Five files. Apply in this order.

---

## 1. Run the SQL migration

**File:** `supabase/migrations/2026_metricool.sql`
**Where:** Supabase SQL Editor → New Query → paste → Run

Creates 5 tables: `client_integrations`, `metricool_posts`, `performance_scores`, `repost_schedule`, `strategy_briefs`. Enables RLS with permissive anon (matches existing YAH posture — lock down when Auth is added).

---

## 2. Deploy the Edge Function

**File:** `supabase/functions/pull-metricool/index.ts`

```bash
supabase functions deploy pull-metricool
```

Then add Edge Function secrets in Supabase Dashboard → Project Settings → Edge Functions:

```
SB_URL          = https://piowmyefosrdpjisguii.supabase.co
SB_SERVICE_ROLE = <service role key from API settings>
```

The service role key is only used inside the Edge Function — never exposed to the browser.

---

## 3. Add the new tab to `index.html`

**File:** `snippets/metricool_tab.html`

Inside `<section id="screen-client">`, find `.ctab-bar` and add the Performance tab after Knowledge Base, before Reports:

```html
<div class="ctab" onclick="switchClientTab('performance', this)">Performance</div>
```

Then in the body section, after `#ctab-kb` and before `#ctab-reports`, add:

```html
<div class="client-body" id="ctab-performance" style="display:none">
  <div class="empty">Loading performance data…</div>
</div>
```

---

## 4. Paste the styles

**File:** `snippets/metricool_styles.css`

Append the entire contents inside the existing `<style>` block in `index.html`. Uses YAH design tokens — no new variables introduced.

---

## 5. Paste the JavaScript module

**File:** `snippets/metricool_module.js`

Append the entire contents at the bottom of the existing `<script>` block in `index.html`.

Then **in `switchClientTab()`**, add this line so the tab loads its data when clicked:

```javascript
function switchClientTab(tab, el) {
  // existing code...
  if (tab === 'performance') loadPerformanceTab();   // ← add this
  if (tab === 'history')     loadPlanHistory();
  if (tab === 'ideation')    loadIdeationHistory();
  if (tab === 'kb')          loadKbDocs();
  if (tab === 'reports')     loadReports();
}
```

---

## 6. Wire credentials for Tiffany

In the Performance tab → Connect Metricool → enter:

- **API Key** — Metricool → Settings → API → User Token (the value Metricool sends as `X-Mc-Auth`)
- **Blog ID** — visible in Metricool URL when on her brand: `app.metricool.com/main/...?blogId=XXXX`
- **User ID** — Metricool → Settings → API page header
- **Plan Tier** — Starter (CSV only) or Advanced (API + CSV)

Save. The button set adapts automatically — Advanced shows "Pull from Metricool", Starter only shows "Import CSV".

---

## CSV Path (Starter Plan)

Tiffany is most likely on Starter. Workflow:

1. In Metricool: Analytics → Posts → Export CSV
2. In YAH Performance tab: Import CSV → select file
3. Module parses, upserts, recomputes scores, renders top performers
4. Click "Generate Strategy Brief" for the Claude analysis

The CSV parser is column-name-fuzzy — it finds `reach`, `saves`, `likes`, etc. by partial match, so Metricool can rename or reorder columns and it still works.

---

## What's Built

| Capability | Status |
|---|---|
| Schema for posts, scores, reposts, briefs, integrations | ✅ |
| Edge Function: API pull (Instagram by default, multi-network supported) | ✅ |
| CSV import (Starter plan path) | ✅ |
| Composite score engine (saves & shares weighted heaviest) | ✅ |
| Top 12 performer grid with reach/saves/shares/likes | ✅ |
| Repost queue with 60-day cooldown default | ✅ |
| Claude-generated strategy brief (saved to `strategy_briefs`) | ✅ |
| Per-client Metricool credentials UI | ✅ |
| Tab integrated into existing client screen | ✅ |

## What's Not (Next Build)

- **Push reposts back to Metricool** — needs Metricool's scheduling endpoint (Advanced plan only). Currently the queue is local; you'd manually mirror queued posts into Metricool's calendar.
- **Auto-fold proven content into 2-week plan generation** — feeding `strategy_briefs.brief_content` into the existing plan-generation system prompt as additional context.
- **Pillar tagging** — posts arrive without pillar; right now you'd tag `metricool_posts.pillar` manually or with a Claude classifier pass. Worth a follow-up.
- **Multi-network mix** — Edge Function takes `networks: ['instagram', 'facebook', 'tiktok']` already, but UI only triggers Instagram. Easy extension when needed.

## Score Weighting (for tuning later)

```
composite = 0.30 × reach_percentile        (vs this client's other posts)
          + 0.30 × min(save_rate / 0.04, 1) × 100   (4% save rate = perfect)
          + 0.20 × min(share_rate / 0.03, 1) × 100  (3% share rate = perfect)
          + 0.20 × min(eng_rate / 0.10, 1) × 100    (10% eng rate = perfect)
```

Saves and shares are weighted heaviest because they signal real value (people want to find it again, want to share it) — likes are vanity. Reach percentile is intra-client so a small account's "viral" still gets recognized.

To tune: edit `scorePosts()` in `metricool_module.js`.

## Brand Guardrail

Strategy brief generation passes `brand_voice` and `brand_avoid` to Claude — Tiffany's avoid list (manifestation, law of attraction, chakras, astrology, crystals, Eastern mysticism, new age) is enforced automatically.

---

## After Pushing

GitHub Pages auto-deploys. Visit `https://ebeprstudios.github.io/YAH`, log in, open a client, click Performance. If "Connect Metricool" appears — you're live.

If you see CORS errors on the API pull, the Edge Function isn't deployed or the secrets aren't set. Check Supabase Dashboard → Edge Functions → pull-metricool → Logs.

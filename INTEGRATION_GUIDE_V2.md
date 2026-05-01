# YAH! OAuth Integration — Assembly Guide (v2)

This **replaces** the Metricool integration with direct OAuth pulls from Instagram and TikTok. The score engine, repost queue, and strategy brief generator all stay — only the ingestion layer swaps.

> **Read first:** `DEVELOPER_SETUP_GUIDE.md` — you must complete the Meta + TikTok app setup before any of this code will work.

## What's in this build

```
supabase/migrations/2026_05_oauth_social.sql       Schema migration (renames + adds OAuth)
supabase/functions/instagram-oauth-callback/       Code → token exchange (IG)
supabase/functions/tiktok-oauth-callback/          Code → token exchange (TT)
supabase/functions/pull-instagram/                 Pulls media + insights
supabase/functions/pull-tiktok/                    Pulls videos + stats
oauth_callback.html                                Browser-side OAuth redirect handler
snippets/oauth_module.js                           Frontend integration logic
snippets/oauth_styles.css                          Connector card styles
```

## Apply order

### 1. Run the SQL migration

`supabase/migrations/2026_05_oauth_social.sql` — paste into Supabase SQL Editor and run.

This is **idempotent and safe to run regardless of prior state**. It will:
- Rename `metricool_posts` → `social_posts` if the prior migration ran
- Or create `social_posts` from scratch if not
- Add OAuth columns to `client_integrations`
- Add `oauth_state` table for CSRF + flow context
- Backfill any tables that don't exist (performance_scores, repost_schedule, strategy_briefs)

### 2. Deploy the Edge Functions

```bash
supabase functions deploy instagram-oauth-callback
supabase functions deploy tiktok-oauth-callback
supabase functions deploy pull-instagram
supabase functions deploy pull-tiktok
```

If you previously deployed `pull-metricool`, leave it — nothing calls it anymore but it's harmless and still works for the CSV-only flow.

### 3. Configure Edge Function secrets

Per `DEVELOPER_SETUP_GUIDE.md` Part 3. The 8 secrets:

```
SB_URL, SB_SERVICE_ROLE,
IG_CLIENT_ID, IG_CLIENT_SECRET, IG_REDIRECT_URI,
TT_CLIENT_KEY, TT_CLIENT_SECRET, TT_REDIRECT_URI
```

### 4. Add the OAuth callback page

Drop `oauth_callback.html` into the root of the YAH repo, sibling to `index.html`. After deploy, it lives at `https://ebeprstudios.github.io/YAH/oauth_callback.html`.

### 5. Update `index.html`

**(a)** Near the top of the `<script>` block, just below `SB_URL` and `SB_KEY`:

```javascript
window.YAH_CONFIG = {
  IG_CLIENT_ID: 'YOUR_INSTAGRAM_APP_ID',
  TT_CLIENT_KEY: 'YOUR_TIKTOK_CLIENT_KEY',
  OAUTH_REDIRECT_URI: 'https://ebeprstudios.github.io/YAH/oauth_callback.html'
};
```

**(b)** **Replace** the previous Metricool section in `metricool_module.js` (the one inside the `<script>` block of `index.html`) with the contents of `oauth_module.js`. Specifically, you're replacing these functions:

- `loadIntegration` — replaced by `loadIntegrations` (plural, returns array) + per-provider variant
- `saveIntegration` — gone (no manual credential entry)
- `pullFromMetricool` — replaced by `pullFromInstagram` + `pullFromTikTok` + `pullAll`
- `loadPerformanceTab` — new version with connector cards
- `toggleIntegrationPanel` — gone

The score engine (`scorePosts`, `recomputeScores`), CSV import (`parseMetricoolCSV`, `handleCsvUpload`), repost queue (`queueRepost`, `loadRepostQueue`, `cancelRepost`), strategy brief (`generateStrategyBrief`, `renderMarkdown`), and performer card (`renderPerformerCard`) — **all stay**. Don't touch them.

**(c)** Append `oauth_styles.css` to the existing `<style>` block.

**(d)** Update any DB calls in the kept functions: `metricool_posts` → `social_posts`. Specifically `recomputeScores` and `generateStrategyBrief` — both reference the old table name. Find/replace in the file:

```
metricool_posts  →  social_posts
```

That should be 2 hits — one in `recomputeScores`, one in `generateStrategyBrief`.

### 6. Verify CSV import still works

The CSV path stays untouched and continues to import into `social_posts` (renamed). It's still useful as a fallback when:
- A new client is added but app review hasn't cleared
- You want to backfill historical data older than the API exposes

### 7. Push to GitHub

GitHub Pages auto-deploys. Visit YAH, open Tiffany's client, hit Performance tab. You should see two connector cards: Instagram and TikTok, both showing "Not connected" with a Connect button.

## Verification flow

1. ✅ SQL ran without errors
2. ✅ All 4 Edge Functions deployed (visible in Supabase Dashboard → Edge Functions)
3. ✅ All 8 secrets set
4. ✅ `oauth_callback.html` reachable at GitHub Pages URL
5. ✅ Performance tab shows connector cards
6. ✅ Click Connect Instagram → popup → Tiffany authorizes → green checkmark
7. ✅ Click Pull Instagram → posts appear in performer grid with scores
8. ✅ Repeat 6–7 for TikTok
9. ✅ Click Generate Strategy Brief → Claude analysis renders

## What changed from the Metricool build

| | Metricool build (v1) | OAuth build (v2) |
|---|---|---|
| Ingestion | Metricool API or CSV | IG OAuth + TT OAuth + CSV |
| Setup | Per-client API key | One-time OAuth click |
| Subscription | Metricool monthly fee | $0 |
| Multi-client | Metricool per client | Add as testers (dev mode) or app review |
| Token mgmt | None | Auto-refresh built into pulls |
| Coverage | Whatever Metricool tracked | Direct from source platforms |
| TikTok analytics depth | Full (Metricool resells Business API data) | Display API only — no reach/saves on TikTok until Business API approved |

## Known limitations to call out

- **TikTok Display API doesn't expose reach or saves.** Score engine still works, but TT scores will be slightly less precise than IG scores. When you eventually get TikTok Business API approval, swap the pull endpoint and reach/saves data flows in automatically — score engine is data-source-agnostic.
- **Instagram impressions aren't exposed** in the Instagram-with-Instagram-Login flow for newer Reels (Meta moved this metric exclusively to Facebook Login flow). Reach is exposed and that's what the score engine uses, so this is mostly cosmetic.
- **Stories aren't pulled.** The `pull-instagram` function deliberately ignores the Stories permission scope. Adding Stories means more App Review surface area for marginal value. If/when you need it, request `instagram_basic` in addition to current scopes and add a `/me/stories` call to the pull function.

## What's next (future sessions)

Now that direct ingestion works, the high-leverage follow-ups are:

1. **Auto-fold proven content into plan generation** — pass `strategy_briefs.brief_content` into the existing weekly planner system prompt. Plans start incorporating "what's working" automatically.
2. **Pillar tagging on pulled posts** — Claude classifies each new post against the client's pillar list during pull. Lets the strategy brief diagnose pillar performance precisely.
3. **Scheduled pulls** — cron Edge Function that pulls all connected accounts nightly. Requires Vercel migration (GitHub Pages can't cron).
4. **Push reposts back** — Instagram Content Publishing API can schedule posts directly. TikTok Content Posting API too. Both require additional permissions + likely app review.

Got that wired and you've got a real performance loop running on your own infrastructure with no third-party fees.

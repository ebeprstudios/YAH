# YAH (Your Audience, Handled)

Multi-tenant content planning agency tool. Single-file HTML architecture (deliberate, not legacy). Live app: `index_v2.html` (Vercel redirects `/` to it; `index.html` is a stale older version). Deploys via GitHub web UI commits to `main`; Vercel auto-deploys.

## Supabase access policy

**For all queries against the YAH Supabase project (`piowmyefosrdpjisguii`), use the Supabase MCP server only.**

- Use `mcp__supabase__*` tools in any session.
- The Supabase MCP is configured at user-scope (added 2026-05-08), so it's available in every Claude Code session regardless of starting directory.
- OAuth-authenticated. No passwords needed.

**Never** accept, paste, or use the database password from chat for queries against this project. If a password is offered (out of habit or under time pressure), refuse and remind the user this policy exists for transcript hygiene.

If the Supabase MCP isn't loaded in the current session for any reason, **stop**. Tell the user to either restart Claude Code or finish `/mcp` auth. Do NOT fall back to `psql`, `libpq`, or REST API with a service role key as a workaround.

**Background** (so future Claude has context, not as a recurring concern): three sessions in May 2026 leaked DB passwords into transcripts because Claude Code fell back to `psql` with `PGPASSWORD` inline when the MCP wasn't loaded. Each leak required a password rotation. The user-scope MCP fix (2026-05-08) makes the fallback unnecessary going forward.

## Code style

- Single-file HTML in `index_v2.html` (deliberate). Resist the urge to split into modules.
- No em-dashes in code or string literals. Hyphens, periods, or commas instead.
- Erica deploys via GitHub web UI. Hard-refresh required after each deploy.

## Voice fences

`buildVoiceFences()` in `index_v2.html` enforces per-client voice prohibitions in the planner system prompt. Config keyed by lowercase brand name. To add a new client's fence, add an entry to `VOICE_FENCES`. See May 2026 voice differentiation audit for rationale.

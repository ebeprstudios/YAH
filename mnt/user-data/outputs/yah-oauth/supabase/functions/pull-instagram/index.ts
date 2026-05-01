// =============================================================
// YAH! Edge Function — pull-instagram
// Pulls user media + per-post insights, upserts into social_posts.
// Uses stored long-lived token; auto-refreshes if <7 days from expiry.
//
// Deploy:  supabase functions deploy pull-instagram
// Env:     SB_URL, SB_SERVICE_ROLE, IG_CLIENT_SECRET
// =============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SB_URL = Deno.env.get('SB_URL')!;
const SB_SERVICE = Deno.env.get('SB_SERVICE_ROLE')!;
const IG_CLIENT_SECRET = Deno.env.get('IG_CLIENT_SECRET')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });

// Refresh long-lived token if it's getting close to 60-day expiry
async function maybeRefreshToken(sb: any, integ: any): Promise<string> {
  const expiresAt = integ.token_expires_at ? new Date(integ.token_expires_at) : null;
  if (!expiresAt) return integ.access_token;

  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  if (expiresAt.getTime() - Date.now() > sevenDays) return integ.access_token;

  const url = 'https://graph.instagram.com/refresh_access_token' +
              '?grant_type=ig_refresh_token' +
              '&access_token=' + encodeURIComponent(integ.access_token);
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    console.warn('IG token refresh failed', data);
    return integ.access_token;
  }
  const newExpiresAt = new Date(Date.now() + Number(data.expires_in || 60 * 24 * 3600) * 1000).toISOString();
  await sb.from('client_integrations').update({
    access_token: data.access_token,
    token_expires_at: newExpiresAt
  }).eq('id', integ.id);
  return data.access_token;
}

const MEDIA_FIELDS = 'id,caption,media_type,media_url,permalink,thumbnail_url,timestamp,media_product_type,username';
// Reels insights: reach, saved, likes, comments, shares, plays, total_interactions
// Other media: reach, saved, likes, comments, shares, total_interactions
const INSIGHT_METRICS_REEL = 'reach,saved,likes,comments,shares,views,total_interactions';
const INSIGHT_METRICS_FEED = 'reach,saved,likes,comments,shares,total_interactions';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { client_id, days = 90, limit = 50 } = await req.json();
    if (!client_id) throw new Error('client_id required');

    const sb = createClient(SB_URL, SB_SERVICE);

    const { data: integ } = await sb
      .from('client_integrations')
      .select('*')
      .eq('client_id', client_id)
      .eq('provider', 'instagram')
      .eq('active', true)
      .maybeSingle();

    if (!integ?.access_token) throw new Error('Instagram not connected for this client');

    const token = await maybeRefreshToken(sb, integ);

    // Fetch media list
    const mediaUrl = 'https://graph.instagram.com/me/media' +
      '?fields=' + MEDIA_FIELDS +
      '&limit=' + limit +
      '&access_token=' + encodeURIComponent(token);

    const mediaRes = await fetch(mediaUrl);
    const mediaData = await mediaRes.json();
    if (!mediaRes.ok) throw new Error('Media fetch failed: ' + JSON.stringify(mediaData));

    const media = Array.isArray(mediaData.data) ? mediaData.data : [];
    const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
    const recent = media.filter((m: any) => {
      const ts = m.timestamp ? new Date(m.timestamp).getTime() : 0;
      return ts >= cutoff;
    });

    const rows: any[] = [];
    const errors: string[] = [];

    for (const m of recent) {
      try {
        const isReel = m.media_product_type === 'REELS';
        const metrics = isReel ? INSIGHT_METRICS_REEL : INSIGHT_METRICS_FEED;
        const insightUrl = `https://graph.instagram.com/${m.id}/insights?metric=${metrics}&access_token=${encodeURIComponent(token)}`;
        const insRes = await fetch(insightUrl);
        const insData = await insRes.json();

        const insights: Record<string, number> = {};
        if (insRes.ok && Array.isArray(insData.data)) {
          insData.data.forEach((row: any) => {
            const val = row.values?.[0]?.value;
            insights[row.name] = typeof val === 'number' ? val : 0;
          });
        }

        rows.push({
          client_id,
          external_id: String(m.id),
          network: 'instagram',
          post_type: (m.media_product_type === 'REELS' ? 'reel'
                      : m.media_type === 'CAROUSEL_ALBUM' ? 'carousel'
                      : m.media_type === 'VIDEO' ? 'video'
                      : 'image').toLowerCase(),
          caption: m.caption || '',
          permalink: m.permalink || '',
          thumbnail_url: m.thumbnail_url || m.media_url || '',
          published_at: m.timestamp || null,
          reach: insights.reach || 0,
          impressions: 0, // not exposed in IG with IG Login flow for Reels
          views: insights.views || insights.video_views || 0,
          likes: insights.likes || 0,
          comments: insights.comments || 0,
          saves: insights.saved || 0,
          shares: insights.shares || 0,
          source: 'api',
          raw_data: { media: m, insights }
        });
      } catch (e: any) {
        errors.push(`${m.id}: ${e.message}`);
      }
    }

    if (rows.length) {
      const { error: upErr } = await sb
        .from('social_posts')
        .upsert(rows, { onConflict: 'client_id,network,external_id' });
      if (upErr) throw new Error('Upsert failed: ' + upErr.message);
    }

    await sb.from('client_integrations')
      .update({ last_pulled_at: new Date().toISOString() })
      .eq('id', integ.id);

    return json({ ok: true, count: rows.length, scanned: recent.length, errors: errors.length ? errors : undefined });

  } catch (e: any) {
    return json({ ok: false, error: e.message }, 400);
  }
});

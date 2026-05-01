// =============================================================
// YAH! Edge Function — pull-tiktok
// Pulls user's videos via Display API (/v2/video/list/) including stats.
// Auto-refreshes token before pull (TikTok tokens expire in 24h).
//
// Deploy:  supabase functions deploy pull-tiktok
// Env:     SB_URL, SB_SERVICE_ROLE, TT_CLIENT_KEY, TT_CLIENT_SECRET
// =============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SB_URL = Deno.env.get('SB_URL')!;
const SB_SERVICE = Deno.env.get('SB_SERVICE_ROLE')!;
const TT_CLIENT_KEY = Deno.env.get('TT_CLIENT_KEY')!;
const TT_CLIENT_SECRET = Deno.env.get('TT_CLIENT_SECRET')!;

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

// Refresh TikTok token if it's expired or expiring within 1 hour
async function maybeRefreshToken(sb: any, integ: any): Promise<string> {
  const expiresAt = integ.token_expires_at ? new Date(integ.token_expires_at) : null;
  const oneHour = 60 * 60 * 1000;
  if (expiresAt && expiresAt.getTime() - Date.now() > oneHour) return integ.access_token;
  if (!integ.refresh_token) return integ.access_token; // can't refresh, will fail upstream

  const formBody = new URLSearchParams({
    client_key: TT_CLIENT_KEY,
    client_secret: TT_CLIENT_SECRET,
    grant_type: 'refresh_token',
    refresh_token: integ.refresh_token,
  });

  const res = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cache-Control': 'no-cache'
    },
    body: formBody.toString()
  });

  const data = await res.json();
  if (!res.ok || !data.access_token) {
    console.warn('TT token refresh failed', data);
    return integ.access_token;
  }

  const newExpiresAt = new Date(Date.now() + Number(data.expires_in || 86400) * 1000).toISOString();
  await sb.from('client_integrations').update({
    access_token: data.access_token,
    refresh_token: data.refresh_token || integ.refresh_token,
    token_expires_at: newExpiresAt
  }).eq('id', integ.id);

  return data.access_token;
}

const VIDEO_FIELDS = [
  'id', 'title', 'video_description', 'duration', 'cover_image_url',
  'embed_link', 'create_time', 'like_count', 'comment_count',
  'share_count', 'view_count'
].join(',');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { client_id, days = 90, max_count = 50 } = await req.json();
    if (!client_id) throw new Error('client_id required');

    const sb = createClient(SB_URL, SB_SERVICE);

    const { data: integ } = await sb
      .from('client_integrations')
      .select('*')
      .eq('client_id', client_id)
      .eq('provider', 'tiktok')
      .eq('active', true)
      .maybeSingle();

    if (!integ?.access_token) throw new Error('TikTok not connected for this client');

    const token = await maybeRefreshToken(sb, integ);

    // Pull video list — paginate up to ~150 videos
    const videos: any[] = [];
    let cursor = 0;
    let hasMore = true;
    let pages = 0;

    while (hasMore && pages < 3 && videos.length < max_count) {
      const res = await fetch(
        `https://open.tiktokapis.com/v2/video/list/?fields=${VIDEO_FIELDS}`,
        {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + token,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ max_count: Math.min(20, max_count - videos.length), cursor })
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error('TikTok video list failed: ' + JSON.stringify(data));

      const batch = data?.data?.videos || [];
      videos.push(...batch);
      cursor = data?.data?.cursor || 0;
      hasMore = !!data?.data?.has_more;
      pages++;
    }

    const cutoff = Math.floor((Date.now() - days * 86400000) / 1000);
    const recent = videos.filter((v: any) => Number(v.create_time || 0) >= cutoff);

    const rows = recent.map((v: any) => ({
      client_id,
      external_id: String(v.id),
      network: 'tiktok',
      post_type: 'video',
      caption: v.title || v.video_description || '',
      permalink: v.embed_link || '',
      thumbnail_url: v.cover_image_url || '',
      published_at: v.create_time ? new Date(Number(v.create_time) * 1000).toISOString() : null,
      reach: 0,                              // TikTok Display API doesn't expose reach
      impressions: 0,
      views: Number(v.view_count || 0),
      likes: Number(v.like_count || 0),
      comments: Number(v.comment_count || 0),
      saves: 0,                              // not in Display API — would need Business API
      shares: Number(v.share_count || 0),
      source: 'api',
      raw_data: v
    }));

    if (rows.length) {
      const { error: upErr } = await sb
        .from('social_posts')
        .upsert(rows, { onConflict: 'client_id,network,external_id' });
      if (upErr) throw new Error('Upsert failed: ' + upErr.message);
    }

    await sb.from('client_integrations')
      .update({ last_pulled_at: new Date().toISOString() })
      .eq('id', integ.id);

    return json({ ok: true, count: rows.length, scanned: videos.length });

  } catch (e: any) {
    return json({ ok: false, error: e.message }, 400);
  }
});

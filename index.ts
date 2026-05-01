// =============================================================
// YAH! Edge Function — pull-metricool
// Proxies Metricool API calls (CORS-safe), upserts posts.
//
// Deploy:  supabase functions deploy pull-metricool
// Env:     SB_URL, SB_SERVICE_ROLE
// =============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SB_URL = Deno.env.get('SB_URL')!;
const SB_SERVICE = Deno.env.get('SB_SERVICE_ROLE')!;
const METRICOOL_BASE = 'https://app.metricool.com/api/v2';

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { client_id, days = 90, networks = ['instagram'] } = await req.json();
    if (!client_id) throw new Error('client_id required');

    const sb = createClient(SB_URL, SB_SERVICE);

    // Fetch credentials
    const { data: integ, error: integErr } = await sb
      .from('client_integrations')
      .select('*')
      .eq('client_id', client_id)
      .eq('provider', 'metricool')
      .eq('active', true)
      .maybeSingle();

    if (integErr) throw new Error('Lookup failed: ' + integErr.message);
    if (!integ) throw new Error('Metricool integration not configured for this client');
    if (!integ.api_key || !integ.account_blog_id || !integ.user_id) {
      throw new Error('Missing api_key / blog_id / user_id in client_integrations');
    }

    // Date window
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - days);
    const fmt = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');

    let totalUpserted = 0;
    const errors: string[] = [];

    for (const net of networks) {
      try {
        const url = `${METRICOOL_BASE}/analytics/posts/${net}` +
                    `?start=${fmt(start)}&end=${fmt(end)}` +
                    `&blogId=${integ.account_blog_id}&userId=${integ.user_id}`;

        const res = await fetch(url, {
          headers: { 'X-Mc-Auth': integ.api_key, 'Accept': 'application/json' }
        });

        if (!res.ok) {
          const txt = await res.text();
          errors.push(`${net}: ${res.status} — ${txt.slice(0, 160)}`);
          continue;
        }

        const data = await res.json();
        const posts = Array.isArray(data?.data) ? data.data
                    : Array.isArray(data) ? data
                    : [];

        const rows = posts.map((p: any) => ({
          client_id,
          external_id: String(p.id ?? p.postId ?? p.mediaId ?? p.shortcode ?? ''),
          network: net,
          post_type: String(p.type || p.mediaType || p.postType || 'image').toLowerCase(),
          caption: p.caption || p.text || p.description || '',
          permalink: p.permalink || p.url || p.link || '',
          thumbnail_url: p.thumbnailUrl || p.thumbnail || p.mediaUrl || p.image || '',
          published_at: p.publishedAt || p.timestamp || p.date || p.createdAt || null,
          reach: Number(p.reach || 0),
          impressions: Number(p.impressions || 0),
          views: Number(p.videoViews || p.views || p.plays || 0),
          likes: Number(p.likes || p.likeCount || 0),
          comments: Number(p.comments || p.commentCount || 0),
          saves: Number(p.saved || p.saves || p.savedCount || 0),
          shares: Number(p.shares || p.shareCount || 0),
          source: 'api',
          raw_data: p,
        })).filter((r: any) => r.external_id);

        if (rows.length === 0) continue;

        const { error: upErr } = await sb
          .from('metricool_posts')
          .upsert(rows, { onConflict: 'client_id,network,external_id' });

        if (upErr) {
          errors.push(`${net} upsert: ${upErr.message}`);
          continue;
        }

        totalUpserted += rows.length;

      } catch (innerErr: any) {
        errors.push(`${net}: ${innerErr.message}`);
      }
    }

    return json({
      ok: true,
      count: totalUpserted,
      networks,
      errors: errors.length ? errors : undefined
    });

  } catch (e: any) {
    return json({ ok: false, error: e.message }, 400);
  }
});

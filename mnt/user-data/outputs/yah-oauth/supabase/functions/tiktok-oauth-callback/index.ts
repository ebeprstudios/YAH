// =============================================================
// YAH! Edge Function — tiktok-oauth-callback
// Receives auth code from TikTok, exchanges for access + refresh tokens,
// stores in client_integrations.
//
// Deploy:  supabase functions deploy tiktok-oauth-callback
// Env:     SB_URL, SB_SERVICE_ROLE, TT_CLIENT_KEY, TT_CLIENT_SECRET, TT_REDIRECT_URI
// =============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SB_URL = Deno.env.get('SB_URL')!;
const SB_SERVICE = Deno.env.get('SB_SERVICE_ROLE')!;
const TT_CLIENT_KEY = Deno.env.get('TT_CLIENT_KEY')!;
const TT_CLIENT_SECRET = Deno.env.get('TT_CLIENT_SECRET')!;
const TT_REDIRECT_URI = Deno.env.get('TT_REDIRECT_URI')!;

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
    const { code, state } = await req.json();
    if (!code || !state) throw new Error('code and state required');

    const sb = createClient(SB_URL, SB_SERVICE);

    // Validate state
    const { data: stateRow, error: stateErr } = await sb
      .from('oauth_state')
      .select('*')
      .eq('state_token', state)
      .eq('used', false)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();

    if (stateErr || !stateRow) throw new Error('Invalid or expired state token');
    if (stateRow.provider !== 'tiktok') throw new Error('State/provider mismatch');

    await sb.from('oauth_state').update({ used: true }).eq('id', stateRow.id);

    // Exchange code for tokens
    const formBody = new URLSearchParams({
      client_key: TT_CLIENT_KEY,
      client_secret: TT_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: TT_REDIRECT_URI,
    });

    const tokenRes = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cache-Control': 'no-cache'
      },
      body: formBody.toString()
    });

    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.access_token) {
      throw new Error('TikTok token exchange failed: ' + JSON.stringify(tokenData));
    }

    const expiresIn = Number(tokenData.expires_in || 86400); // 24h default
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    // Get user info
    const userRes = await fetch('https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,display_name,username,avatar_url', {
      headers: { 'Authorization': 'Bearer ' + tokenData.access_token }
    });
    const userData = await userRes.json();
    const userInfo = userData?.data?.user || {};

    // Upsert
    const payload = {
      client_id: stateRow.client_id,
      provider: 'tiktok',
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      token_expires_at: expiresAt,
      platform_user_id: tokenData.open_id || userInfo.open_id,
      platform_username: userInfo.username || userInfo.display_name || null,
      scope: tokenData.scope || 'user.info.basic,video.list',
      active: true,
    };

    const { data: existing } = await sb
      .from('client_integrations')
      .select('id')
      .eq('client_id', stateRow.client_id)
      .eq('provider', 'tiktok')
      .maybeSingle();

    if (existing) {
      await sb.from('client_integrations').update(payload).eq('id', existing.id);
    } else {
      await sb.from('client_integrations').insert([payload]);
    }

    return json({
      ok: true,
      provider: 'tiktok',
      username: userInfo.username || userInfo.display_name,
      expires_at: expiresAt
    });

  } catch (e: any) {
    return json({ ok: false, error: e.message }, 400);
  }
});

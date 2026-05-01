// =============================================================
// YAH! Edge Function — instagram-oauth-callback
// Receives auth code from Instagram, exchanges for long-lived token,
// stores in client_integrations, returns success/redirect.
//
// Deploy:  supabase functions deploy instagram-oauth-callback
// Env:     SB_URL, SB_SERVICE_ROLE, IG_CLIENT_ID, IG_CLIENT_SECRET, IG_REDIRECT_URI
// =============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SB_URL = Deno.env.get('SB_URL')!;
const SB_SERVICE = Deno.env.get('SB_SERVICE_ROLE')!;
const IG_CLIENT_ID = Deno.env.get('IG_CLIENT_ID')!;
const IG_CLIENT_SECRET = Deno.env.get('IG_CLIENT_SECRET')!;
const IG_REDIRECT_URI = Deno.env.get('IG_REDIRECT_URI')!;

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

    // Validate state token (CSRF + flow context)
    const { data: stateRow, error: stateErr } = await sb
      .from('oauth_state')
      .select('*')
      .eq('state_token', state)
      .eq('used', false)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();

    if (stateErr || !stateRow) throw new Error('Invalid or expired state token');
    if (stateRow.provider !== 'instagram') throw new Error('State/provider mismatch');

    // Mark state used
    await sb.from('oauth_state').update({ used: true }).eq('id', stateRow.id);

    // Step 1: Exchange code for short-lived token
    const formBody = new URLSearchParams({
      client_id: IG_CLIENT_ID,
      client_secret: IG_CLIENT_SECRET,
      grant_type: 'authorization_code',
      redirect_uri: IG_REDIRECT_URI,
      code,
    });

    const shortRes = await fetch('https://api.instagram.com/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formBody.toString()
    });

    const shortData = await shortRes.json();
    if (!shortRes.ok || !shortData.access_token) {
      throw new Error('Short-lived token exchange failed: ' + JSON.stringify(shortData));
    }

    const shortToken = shortData.access_token;
    const userId = String(shortData.user_id || '');

    // Step 2: Exchange short-lived for long-lived (60-day) token
    const longUrl = 'https://graph.instagram.com/access_token' +
      '?grant_type=ig_exchange_token' +
      '&client_secret=' + encodeURIComponent(IG_CLIENT_SECRET) +
      '&access_token=' + encodeURIComponent(shortToken);

    const longRes = await fetch(longUrl);
    const longData = await longRes.json();
    if (!longRes.ok || !longData.access_token) {
      throw new Error('Long-lived token exchange failed: ' + JSON.stringify(longData));
    }

    const longToken = longData.access_token;
    const expiresIn = Number(longData.expires_in || 60 * 24 * 3600); // seconds
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    // Step 3: Get profile info
    const profUrl = 'https://graph.instagram.com/me?fields=id,username,account_type&access_token=' +
                    encodeURIComponent(longToken);
    const profRes = await fetch(profUrl);
    const profData = await profRes.json();

    // Step 4: Upsert into client_integrations
    const payload = {
      client_id: stateRow.client_id,
      provider: 'instagram',
      access_token: longToken,
      token_expires_at: expiresAt,
      platform_user_id: profData.id || userId,
      platform_username: profData.username || null,
      scope: 'instagram_business_basic,instagram_business_manage_insights',
      active: true,
    };

    const { data: existing } = await sb
      .from('client_integrations')
      .select('id')
      .eq('client_id', stateRow.client_id)
      .eq('provider', 'instagram')
      .maybeSingle();

    if (existing) {
      await sb.from('client_integrations').update(payload).eq('id', existing.id);
    } else {
      await sb.from('client_integrations').insert([payload]);
    }

    return json({
      ok: true,
      provider: 'instagram',
      username: profData.username,
      account_type: profData.account_type,
      expires_at: expiresAt
    });

  } catch (e: any) {
    return json({ ok: false, error: e.message }, 400);
  }
});

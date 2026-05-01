// =============================================================
// YAH! Edge Function — send-approval (clean SaaS version)
//
// Pure routing logic, no hardcoded agency emails:
//   TO  = client.client_email if set, else agencies.owner_email
//   CC  = agencies.owner_email if it differs from TO
//
// This means: while a client_email is empty, all approval emails
// land in the agency owner's inbox naturally. No flags, no banners.
// Once the agency owner fills in the real client email, emails route
// there with the owner CC'd — standard production behavior.
//
// Deploy:  supabase functions deploy send-approval
// Env required: SB_URL, SB_SERVICE_ROLE, RESEND_API_KEY, EMAIL_FROM, APP_BASE_URL
// =============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SB_URL = Deno.env.get('SB_URL')!;
const SB_SERVICE = Deno.env.get('SB_SERVICE_ROLE')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;
const EMAIL_FROM = Deno.env.get('EMAIL_FROM') || 'YAH! Studio <noreply@yah-lovat.vercel.app>';
const APP_BASE_URL = Deno.env.get('APP_BASE_URL') || 'https://yah-lovat.vercel.app';

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
    const { plan_id, approval_id } = await req.json();
    if (!plan_id) throw new Error('plan_id required');

    const sb = createClient(SB_URL, SB_SERVICE);

    // Fetch plan, client, plan days, approval token
    const { data: plan } = await sb.from('plans').select('*').eq('id', plan_id).maybeSingle();
    if (!plan) throw new Error('Plan not found');

    const { data: client } = await sb.from('clients').select('*').eq('id', plan.client_id).maybeSingle();
    if (!client) throw new Error('Client not found');

    const { data: days } = await sb.from('plan_days')
      .select('*').eq('plan_id', plan_id).order('day_number', { ascending: true });

    let approval;
    if (approval_id) {
      const { data } = await sb.from('approvals').select('*').eq('id', approval_id).maybeSingle();
      approval = data;
    } else {
      const { data } = await sb.from('approvals')
        .select('*').eq('plan_id', plan_id).order('created_at', { ascending: false }).limit(1).maybeSingle();
      approval = data;
    }
    if (!approval?.token) throw new Error('Approval token not found');

    // Find the agency that owns this client
    // (For now we have one agency per app; once multi-tenant, scope by owner_user_id)
    const { data: agency } = await sb.from('agencies').select('*').limit(1).maybeSingle();
    const ownerEmail = agency?.owner_email;

    if (!ownerEmail) {
      throw new Error('No agency owner email configured. Set it in Settings.');
    }

    // ---- Routing logic ----
    // TO = client_email if set, else owner_email
    // CC = owner_email if it differs from TO
    const toAddress = (client.client_email && client.client_email.trim())
      ? client.client_email.trim()
      : ownerEmail;

    const ccAddresses: string[] = [];
    if (toAddress.toLowerCase() !== ownerEmail.toLowerCase()) {
      ccAddresses.push(ownerEmail);
    }

    // Subject + body
    const subject = `Plan ready for review — ${client.brand_name || client.name} — ${plan.week_of || ''}`.trim();
    const approvalUrl = `${APP_BASE_URL}/yah_plan_approval.html?token=${encodeURIComponent(approval.token)}`;
    const html = buildEmailHtml({ client, plan, days: days || [], approvalUrl });

    // Send via Resend
    const resendBody: any = {
      from: EMAIL_FROM,
      to: [toAddress],
      subject,
      html,
    };
    if (ccAddresses.length) resendBody.cc = ccAddresses;

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(resendBody)
    });

    const resendData = await resendRes.json().catch(() => ({}));
    if (!resendRes.ok) throw new Error('Resend error: ' + (resendData?.message || resendRes.status));

    await sb.from('plans').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', plan_id);
    await sb.from('approvals').update({ email_sent_at: new Date().toISOString() }).eq('id', approval.id);

    return json({
      ok: true,
      to: toAddress,
      cc: ccAddresses,
      message_id: resendData?.id || null
    });

  } catch (e: any) {
    return json({ ok: false, error: e.message }, 400);
  }
});

// ---- Helpers ----

function escapeHtml(s: any): string {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ));
}

function buildEmailHtml({ client, plan, days, approvalUrl }: any): string {
  const week1 = days.filter((d: any) => d.week === 'Week 1');
  const week2 = days.filter((d: any) => d.week === 'Week 2');

  const dayRow = (d: any) => `
    <tr>
      <td style="padding:10px 12px; border-bottom:1px solid #E5E5E5; vertical-align:top; font-family:-apple-system,sans-serif; font-size:13px; color:#1F2A1A;">
        <strong>${escapeHtml(d.day_label || '')}</strong><br>
        <span style="color:#8A8567; font-size:11px; text-transform:uppercase; letter-spacing:0.5px;">${escapeHtml(d.post_type || '')} · ${escapeHtml(d.pillar || '')}</span>
      </td>
      <td style="padding:10px 12px; border-bottom:1px solid #E5E5E5; vertical-align:top; font-family:-apple-system,sans-serif; font-size:13px; color:#1F2A1A;">
        <strong>${escapeHtml(d.title || '')}</strong>
        ${d.hook ? `<div style="color:#4A4F38; font-size:12px; margin-top:4px; line-height:1.4;">${escapeHtml(d.hook)}</div>` : ''}
      </td>
    </tr>`;

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="margin:0; padding:0; background:#F8F5E9; font-family:-apple-system,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F8F5E9;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="background:#FFFFFF; border-radius:14px; overflow:hidden; max-width:640px;">

<tr><td style="background:#1F2A1A; padding:24px;">
  <span style="background:#C2D87C; color:#1F2A1A; padding:5px 12px; border-radius:999px; font-weight:800; font-size:14px; letter-spacing:-0.3px;">YAH!</span>
  <span style="color:#B8B095; font-size:11px; margin-left:10px; text-transform:uppercase; letter-spacing:0.6px;">your audience, handled.</span>
</td></tr>

<tr><td style="padding:32px 24px 16px;">
  <div style="color:#8A8567; font-size:11px; text-transform:uppercase; letter-spacing:0.6px; margin-bottom:6px;">Plan ready for review</div>
  <h1 style="margin:0 0 6px; color:#1F2A1A; font-size:24px; font-weight:800; letter-spacing:-0.5px;">${escapeHtml(client.brand_name || client.name)}</h1>
  <div style="color:#4A4F38; font-size:14px;">${escapeHtml(plan.week_of || '')}</div>
  ${plan.planning_note ? `<div style="background:#F8F5E9; border-left:2px solid #5A6B2D; padding:12px 14px; border-radius:0 8px 8px 0; margin-top:18px; color:#1F2A1A; font-size:14px; line-height:1.55;">${escapeHtml(plan.planning_note)}</div>` : ''}
</td></tr>

${week1.length ? `
<tr><td style="padding:8px 24px;">
  <h3 style="color:#5A6B2D; font-size:13px; text-transform:uppercase; letter-spacing:0.6px; margin:16px 0 8px;">Week 1 — Recording</h3>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E5E5E5; border-radius:8px; border-collapse:separate;">
    ${week1.map(dayRow).join('')}
  </table>
</td></tr>` : ''}

${week2.length ? `
<tr><td style="padding:8px 24px;">
  <h3 style="color:#5A6B2D; font-size:13px; text-transform:uppercase; letter-spacing:0.6px; margin:16px 0 8px;">Week 2 — Editing</h3>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E5E5E5; border-radius:8px; border-collapse:separate;">
    ${week2.map(dayRow).join('')}
  </table>
</td></tr>` : ''}

<tr><td style="padding:24px; text-align:center;">
  <a href="${escapeHtml(approvalUrl)}" style="display:inline-block; background:#C2D87C; color:#1F2A1A; padding:14px 32px; border-radius:999px; text-decoration:none; font-weight:800; font-size:15px;">Review &amp; Approve Plan</a>
  <div style="color:#8A8567; font-size:11px; margin-top:14px;">Or copy this link: <span style="color:#5A6B2D;">${escapeHtml(approvalUrl)}</span></div>
</td></tr>

<tr><td style="padding:24px; background:#F8F5E9; color:#8A8567; font-size:11px; text-align:center;">
  Sent by YAH! Studio
</td></tr>

</table>
</td></tr>
</table>
</body></html>`;
}

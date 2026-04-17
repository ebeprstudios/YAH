// send-approval/index.ts
// YAH! — Supabase Edge Function
// Sends plan approval email to client with a unique approval token
// Triggered by the Send for Approval button in the YAH dashboard

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { plan_id, client_id, approval_token, base_url } = await req.json()

    if (!plan_id || !client_id || !approval_token) {
      throw new Error('Missing required fields: plan_id, client_id, approval_token')
    }

    // Initialize Supabase client with service role
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Fetch client
    const { data: client, error: clientErr } = await supabase
      .from('clients')
      .select('*')
      .eq('id', client_id)
      .single()
    if (clientErr) throw new Error('Could not fetch client: ' + clientErr.message)

    // Fetch plan
    const { data: plan, error: planErr } = await supabase
      .from('plans')
      .select('*')
      .eq('id', plan_id)
      .single()
    if (planErr) throw new Error('Could not fetch plan: ' + planErr.message)

    // Fetch plan days
    const { data: days, error: daysErr } = await supabase
      .from('plan_days')
      .select('*')
      .eq('plan_id', plan_id)
      .order('day_number', { ascending: true })
    if (daysErr) throw new Error('Could not fetch plan days: ' + daysErr.message)

    // Fetch manager email from team_members
    const { data: team } = await supabase
      .from('team_members')
      .select('*')
      .eq('client_id', client_id)
    const manager = team?.find(m => m.role === 'manager')

    // Build approval URL
    const approvalUrl = `${base_url || 'https://ebeprstudios.github.io/YAH'}/yah_plan_approval.html?token=${approval_token}`

    // Build email HTML
    const planRows = (days || []).map(day => `
      <tr style="border-bottom:1px solid #e8e5de;">
        <td style="padding:10px 12px;font-size:11px;font-weight:700;color:#666;text-transform:uppercase;letter-spacing:0.5px;white-space:nowrap;vertical-align:top;width:15%">${day.day_label || day.day_number}</td>
        <td style="padding:10px 12px;vertical-align:top;width:15%"><span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;background:${typeColor(day.post_type)};color:white">${day.post_type || ''}</span></td>
        <td style="padding:10px 12px;vertical-align:top;width:20%"><span style="font-size:10px;color:#888;font-style:italic">${day.pillar || ''}</span></td>
        <td style="padding:10px 12px;vertical-align:top;width:50%">
          <div style="font-size:13px;font-weight:700;color:#1a1a1a;margin-bottom:3px">${escHtml(day.title || '')}</div>
          ${day.hook ? `<div style="font-size:11px;color:#666;font-style:italic">"${escHtml(day.hook)}"</div>` : ''}
          ${day.brand_purpose ? `<div style="font-size:11px;color:#4a8a00;margin-top:3px;font-weight:600">${escHtml(day.brand_purpose)}</div>` : ''}
        </td>
      </tr>
    `).join('')

    const week1 = (days || []).slice(0, 7)
    const week2 = (days || []).slice(7, 14)

    const emailHtml = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f0ede8;font-family:Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f0ede8;padding:24px 0">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden">

  <!-- Header -->
  <tr><td style="background:#3D2A7A;padding:24px 32px">
    <table width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td><span style="font-size:22px;font-weight:900;color:#BAFF4A;letter-spacing:-0.5px">YAH!</span><span style="font-size:11px;color:rgba(255,255,255,0.6);margin-left:8px">Your Audience, Handled.</span></td>
        <td align="right"><span style="font-size:11px;color:rgba(255,255,255,0.5)">Content Plan for Review</span></td>
      </tr>
    </table>
  </td></tr>

  <!-- Greeting -->
  <tr><td style="padding:28px 32px 16px">
    <p style="font-size:15px;font-weight:700;color:#1a1a1a;margin:0 0 8px">Hi ${escHtml(client.name)},</p>
    <p style="font-size:13px;color:#444;line-height:1.7;margin:0 0 16px">Your <strong>${escHtml(plan.week_of || '2-week')}</strong> content plan is ready for your review. Please look through each post below and click <strong>Approve Plan</strong> if everything looks good, or use the <strong>Request Changes</strong> button to send feedback.</p>
    ${plan.planning_note ? `<p style="font-size:12px;color:#6BBF00;font-weight:700;background:#f0f8e0;padding:10px 14px;border-radius:6px;margin:0;border-left:3px solid #6BBF00">Strategic direction: ${escHtml(plan.planning_note)}</p>` : ''}
  </td></tr>

  <!-- Week 1 -->
  <tr><td style="padding:8px 32px 4px">
    <p style="font-size:9px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase;color:#4a8a00;margin:0">Week 1</p>
  </td></tr>
  <tr><td style="padding:0 20px 8px">
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;border:1px solid #e8e5de;border-radius:8px;overflow:hidden">
      ${week1.map(day => `
      <tr style="border-bottom:1px solid #e8e5de">
        <td style="padding:10px 12px;font-size:11px;font-weight:700;color:#666;text-transform:uppercase;letter-spacing:0.5px;white-space:nowrap;vertical-align:top;width:14%;background:#fafaf8">${escHtml(day.day_label || '')}</td>
        <td style="padding:10px 8px;vertical-align:top;width:14%"><span style="display:inline-block;padding:2px 7px;border-radius:8px;font-size:9px;font-weight:700;background:${typeColor(day.post_type)};color:white">${escHtml(day.post_type || '')}</span></td>
        <td style="padding:10px 8px;vertical-align:top;width:18%"><span style="font-size:9px;color:#888;font-style:italic">${escHtml(day.pillar || '')}</span></td>
        <td style="padding:10px 12px;vertical-align:top">
          <div style="font-size:13px;font-weight:700;color:#1a1a1a;margin-bottom:2px">${escHtml(day.title || '')}</div>
          ${day.hook ? `<div style="font-size:11px;color:#777;font-style:italic">"${escHtml(day.hook)}"</div>` : ''}
          ${day.brand_purpose ? `<div style="font-size:10px;color:#4a8a00;margin-top:2px;font-weight:600">${escHtml(day.brand_purpose)}</div>` : ''}
        </td>
      </tr>`).join('')}
    </table>
  </td></tr>

  <!-- Week 2 -->
  <tr><td style="padding:16px 32px 4px">
    <p style="font-size:9px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase;color:#3D2A7A;margin:0">Week 2</p>
  </td></tr>
  <tr><td style="padding:0 20px 24px">
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;border:1px solid #e8e5de;border-radius:8px;overflow:hidden">
      ${week2.map(day => `
      <tr style="border-bottom:1px solid #e8e5de">
        <td style="padding:10px 12px;font-size:11px;font-weight:700;color:#666;text-transform:uppercase;letter-spacing:0.5px;white-space:nowrap;vertical-align:top;width:14%;background:#fafaf8">${escHtml(day.day_label || '')}</td>
        <td style="padding:10px 8px;vertical-align:top;width:14%"><span style="display:inline-block;padding:2px 7px;border-radius:8px;font-size:9px;font-weight:700;background:${typeColor(day.post_type)};color:white">${escHtml(day.post_type || '')}</span></td>
        <td style="padding:10px 8px;vertical-align:top;width:18%"><span style="font-size:9px;color:#888;font-style:italic">${escHtml(day.pillar || '')}</span></td>
        <td style="padding:10px 12px;vertical-align:top">
          <div style="font-size:13px;font-weight:700;color:#1a1a1a;margin-bottom:2px">${escHtml(day.title || '')}</div>
          ${day.hook ? `<div style="font-size:11px;color:#777;font-style:italic">"${escHtml(day.hook)}"</div>` : ''}
          ${day.brand_purpose ? `<div style="font-size:10px;color:#4a8a00;margin-top:2px;font-weight:600">${escHtml(day.brand_purpose)}</div>` : ''}
        </td>
      </tr>`).join('')}
    </table>
  </td></tr>

  <!-- CTA -->
  <tr><td style="padding:8px 32px 32px;text-align:center">
    <a href="${approvalUrl}" style="display:inline-block;background:#6BBF00;color:#1a1a1a;text-decoration:none;font-size:14px;font-weight:900;padding:14px 36px;border-radius:8px;letter-spacing:-0.3px">Review &amp; Approve Plan</a>
    <p style="font-size:11px;color:#aaa;margin:14px 0 0;line-height:1.6">Or copy this link: ${approvalUrl}</p>
  </td></tr>

  <!-- Footer -->
  <tr><td style="background:#f7f6f3;padding:16px 32px;border-top:1px solid #e8e5de">
    <p style="font-size:10px;color:#aaa;margin:0;text-align:center">YAH! by EBEPR Studios &bull; Your Audience, Handled. &bull; ${manager?.email || ''}</p>
  </td></tr>

</table>
</td></tr>
</table>
</body></html>`

    // Send email via Gmail SMTP using Deno
    const emailFrom = Deno.env.get('EMAIL_FROM') ?? ''
    const emailPassword = Deno.env.get('EMAIL_PASSWORD') ?? ''
    const managerEmail = Deno.env.get('MANAGER_EMAIL') ?? (manager?.email ?? '')

    // Use fetch to send via Gmail API or SMTP2Go/Resend if configured
    // Primary: try Resend API if key exists
    const resendKey = Deno.env.get('RESEND_API_KEY')

    let emailSent = false

    if (resendKey) {
      const resendResp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: `YAH! Content Studio <${emailFrom || 'noreply@resend.dev'}>`,
          to: [client.client_email],
          cc: managerEmail ? [managerEmail] : [],
          subject: `Your ${plan.week_of || '2-Week'} Content Plan is Ready for Review`,
          html: emailHtml
        })
      })
      if (resendResp.ok) emailSent = true
      else {
        const err = await resendResp.json()
        console.error('Resend error:', err)
      }
    }

    // Fallback: log email sent (for development without email configured)
    if (!emailSent) {
      console.log('Email would be sent to:', client.client_email)
      console.log('Approval URL:', approvalUrl)
      // Still mark as sent — email config can be added later
    }

    // Update plan status to 'sent'
    await supabase
      .from('plans')
      .update({ status: 'sent', sent_at: new Date().toISOString() })
      .eq('id', plan_id)

    // Update approval record with sent timestamp
    await supabase
      .from('approvals')
      .update({ email_sent_at: new Date().toISOString() })
      .eq('token', approval_token)

    return new Response(
      JSON.stringify({
        success: true,
        approval_url: approvalUrl,
        sent_to: client.client_email,
        email_sent: emailSent
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (err) {
    console.error('send-approval error:', err)
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

function typeColor(type: string): string {
  const t = (type || '').toLowerCase()
  if (t.includes('reel')) return '#C03030'
  if (t.includes('carousel')) return '#2860B8'
  if (t.includes('quote')) return '#4a8a00'
  if (t.includes('static') || t.includes('lifestyle')) return '#C47820'
  return '#666'
}

function escHtml(str: string): string {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

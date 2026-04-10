import { createClient } from '@supabase/supabase-js'

// Sends an email via Gmail API (users.messages.send)
// Supports new compose AND threaded replies (In-Reply-To + References + threadId)
// Optional attachments: [{ filename, mimeType, data (base64) }]
export default async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST only' }), { status: 405 })
  }

  try {
    const {
      company_id,
      to,
      cc = '',
      bcc = '',
      subject = '',
      body = '',
      html = '',
      attachments = [],
      thread_id = null,
      in_reply_to = null,
      references = null
    } = await req.json()

    if (!company_id || !to) {
      return new Response(JSON.stringify({ error: 'company_id and to required' }), { status: 400 })
    }

    const supabaseAdmin = createClient(
      process.env.SUPABASE_URL || 'https://gizgnbjaemxndmrherir.supabase.co',
      process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || ''
    )

    const { data: company } = await supabaseAdmin.from('companies')
      .select('gmail_tokens').eq('id', company_id).single()

    if (!company?.gmail_tokens?.access_token) {
      return new Response(JSON.stringify({ error: 'Gmail not connected' }), { status: 401 })
    }

    let token = company.gmail_tokens.access_token
    const fromEmail = company.gmail_tokens.email || ''

    // Refresh token if expired
    if (company.gmail_tokens.expires_at && new Date(company.gmail_tokens.expires_at) < new Date()) {
      if (!company.gmail_tokens.refresh_token) {
        return new Response(JSON.stringify({ error: 'Token expired, reconnect Gmail' }), { status: 401 })
      }
      const refreshRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: process.env.GOOGLE_CLIENT_ID,
          client_secret: process.env.GOOGLE_CLIENT_SECRET,
          refresh_token: company.gmail_tokens.refresh_token,
          grant_type: 'refresh_token'
        })
      })
      const refreshData = await refreshRes.json()
      if (!refreshData.access_token) {
        return new Response(JSON.stringify({ error: 'Token refresh failed, reconnect Gmail' }), { status: 401 })
      }
      token = refreshData.access_token
      await supabaseAdmin.from('companies').update({
        gmail_tokens: {
          ...company.gmail_tokens,
          access_token: token,
          expires_at: new Date(Date.now() + (refreshData.expires_in || 3600) * 1000).toISOString()
        }
      }).eq('id', company_id)
    }

    // Build RFC 2822 message (multipart if attachments or html+text, plain if simple)
    const boundary = `----=_Operix_${Date.now()}_${Math.random().toString(36).slice(2)}`
    const altBoundary = `----=_OperixAlt_${Date.now()}_${Math.random().toString(36).slice(2)}`
    const hasAttachments = attachments.length > 0
    const hasHtml = !!html

    const headers = []
    headers.push(`From: ${fromEmail}`)
    headers.push(`To: ${to}`)
    if (cc) headers.push(`Cc: ${cc}`)
    if (bcc) headers.push(`Bcc: ${bcc}`)
    headers.push(`Subject: ${encodeSubject(subject)}`)
    headers.push(`MIME-Version: 1.0`)
    if (in_reply_to) headers.push(`In-Reply-To: ${in_reply_to}`)
    if (references) headers.push(`References: ${references}`)

    let rawMessage = ''

    if (!hasAttachments && !hasHtml) {
      // Simple text
      headers.push(`Content-Type: text/plain; charset="UTF-8"`)
      headers.push(`Content-Transfer-Encoding: 7bit`)
      rawMessage = headers.join('\r\n') + '\r\n\r\n' + body
    } else if (!hasAttachments && hasHtml) {
      // multipart/alternative (text + html)
      headers.push(`Content-Type: multipart/alternative; boundary="${altBoundary}"`)
      rawMessage = headers.join('\r\n') + '\r\n\r\n'
      rawMessage += `--${altBoundary}\r\n`
      rawMessage += `Content-Type: text/plain; charset="UTF-8"\r\n\r\n${body}\r\n\r\n`
      rawMessage += `--${altBoundary}\r\n`
      rawMessage += `Content-Type: text/html; charset="UTF-8"\r\n\r\n${html}\r\n\r\n`
      rawMessage += `--${altBoundary}--`
    } else {
      // multipart/mixed with attachments
      headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`)
      rawMessage = headers.join('\r\n') + '\r\n\r\n'

      // Body part (alternative if html)
      if (hasHtml) {
        rawMessage += `--${boundary}\r\n`
        rawMessage += `Content-Type: multipart/alternative; boundary="${altBoundary}"\r\n\r\n`
        rawMessage += `--${altBoundary}\r\n`
        rawMessage += `Content-Type: text/plain; charset="UTF-8"\r\n\r\n${body}\r\n\r\n`
        rawMessage += `--${altBoundary}\r\n`
        rawMessage += `Content-Type: text/html; charset="UTF-8"\r\n\r\n${html}\r\n\r\n`
        rawMessage += `--${altBoundary}--\r\n\r\n`
      } else {
        rawMessage += `--${boundary}\r\n`
        rawMessage += `Content-Type: text/plain; charset="UTF-8"\r\n\r\n${body}\r\n\r\n`
      }

      // Attachments
      for (const att of attachments) {
        rawMessage += `--${boundary}\r\n`
        rawMessage += `Content-Type: ${att.mimeType || 'application/octet-stream'}; name="${att.filename}"\r\n`
        rawMessage += `Content-Disposition: attachment; filename="${att.filename}"\r\n`
        rawMessage += `Content-Transfer-Encoding: base64\r\n\r\n`
        // Chunk base64 to 76 chars per line (RFC compliant)
        const chunked = att.data.replace(/(.{76})/g, '$1\r\n')
        rawMessage += chunked + '\r\n\r\n'
      }
      rawMessage += `--${boundary}--`
    }

    // Base64url encode the full MIME message
    const raw = Buffer.from(rawMessage, 'utf-8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')

    const sendBody = { raw }
    if (thread_id) sendBody.threadId = thread_id

    const sendRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(sendBody)
    })

    const sendData = await sendRes.json()
    if (!sendRes.ok) {
      return new Response(JSON.stringify({
        error: sendData.error?.message || 'Send failed',
        details: sendData
      }), { status: sendRes.status })
    }

    return new Response(JSON.stringify({
      success: true,
      gmail_id: sendData.id,
      thread_id: sendData.threadId,
      from: fromEmail
    }), { headers: { 'Content-Type': 'application/json' } })

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 })
  }
}

// RFC 2047 encode subject if it has non-ASCII chars
function encodeSubject(subject) {
  if (/^[\x00-\x7F]*$/.test(subject)) return subject
  return `=?UTF-8?B?${Buffer.from(subject, 'utf-8').toString('base64')}?=`
}

export const config = { path: '/.netlify/functions/gmail-send' }

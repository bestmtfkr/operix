import { createClient } from '@supabase/supabase-js'

// Fetches emails from Gmail — tokens are read server-side from DB
// Frontend only sends company_id, never sees tokens
export default async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST only' }), { status: 405 })
  }

  try {
    const { company_id, max_results, after_date } = await req.json()
    if (!company_id) {
      return new Response(JSON.stringify({ error: 'company_id required' }), { status: 400 })
    }

    // Get tokens from DB (server-side only)
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

    // Check if token expired, refresh if needed
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

      // Update stored token
      await supabaseAdmin.from('companies').update({
        gmail_tokens: {
          ...company.gmail_tokens,
          access_token: token,
          expires_at: new Date(Date.now() + (refreshData.expires_in || 3600) * 1000).toISOString()
        }
      }).eq('id', company_id)
    }

    // Fetch messages
    const listRes = await fetch(
      `https://www.googleapis.com/gmail/v1/users/me/messages?maxResults=${max_results || 10}&q=is:inbox${after_date ? ' after:' + after_date : ''}`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    const listData = await listRes.json()

    if (!listData.messages) {
      return new Response(JSON.stringify({ emails: [] }), {
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // Fetch each message
    const emails = await Promise.all(
      listData.messages.slice(0, max_results || 10).map(async (msg) => {
        const msgRes = await fetch(
          `https://www.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`,
          { headers: { Authorization: `Bearer ${token}` } }
        )
        const msgData = await msgRes.json()
        const headers = msgData.payload?.headers || []
        const getHeader = (name) => headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || ''

        let body = ''
        let htmlBody = ''

        function extractBodies(payload) {
          if (!payload) return
          if (payload.mimeType === 'text/html' && payload.body?.data) {
            htmlBody = Buffer.from(payload.body.data, 'base64url').toString('utf8')
          }
          if (payload.mimeType === 'text/plain' && payload.body?.data) {
            body = Buffer.from(payload.body.data, 'base64url').toString('utf8')
          }
          if (payload.parts) {
            for (const part of payload.parts) {
              extractBodies(part)
            }
          }
        }
        extractBodies(msgData.payload)

        // Extract attachment info (don't download yet — on demand)
        const attachments = []
        function findAttachments(parts) {
          if (!parts) return
          for (const part of parts) {
            if (part.filename && part.body?.attachmentId) {
              attachments.push({
                id: part.body.attachmentId,
                filename: part.filename,
                mimeType: part.mimeType,
                size: part.body.size || 0
              })
            }
            if (part.parts) findAttachments(part.parts)
          }
        }
        findAttachments(msgData.payload?.parts)

        return {
          gmail_id: msg.id,
          thread_id: msg.threadId,
          message_id: getHeader('Message-ID') || getHeader('Message-Id'),
          from: getHeader('From'),
          to: getHeader('To'),
          cc: getHeader('Cc'),
          subject: getHeader('Subject'),
          date: getHeader('Date'),
          body: body.slice(0, 3000),
          html_body: htmlBody.slice(0, 50000),
          snippet: msgData.snippet || '',
          attachments
        }
      })
    )

    return new Response(JSON.stringify({ emails }), {
      headers: { 'Content-Type': 'application/json' }
    })

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 })
  }
}

export const config = { path: '/.netlify/functions/gmail-fetch' }

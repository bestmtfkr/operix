import { createClient } from '@supabase/supabase-js'

// Bulk fetch emails — called repeatedly with page tokens for pagination
export default async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST only' }), { status: 405 })
  }

  try {
    const { company_id, page_token, months_back } = await req.json()
    if (!company_id) {
      return new Response(JSON.stringify({ error: 'company_id required' }), { status: 400 })
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

    // Refresh if needed
    if (company.gmail_tokens.expires_at && new Date(company.gmail_tokens.expires_at) < new Date()) {
      if (!company.gmail_tokens.refresh_token) {
        return new Response(JSON.stringify({ error: 'Token expired' }), { status: 401 })
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
      if (refreshData.access_token) {
        token = refreshData.access_token
        await supabaseAdmin.from('companies').update({
          gmail_tokens: {
            ...company.gmail_tokens,
            access_token: token,
            expires_at: new Date(Date.now() + (refreshData.expires_in || 3600) * 1000).toISOString()
          }
        }).eq('id', company_id)
      }
    }

    // Calculate date filter
    const afterDate = new Date()
    afterDate.setMonth(afterDate.getMonth() - (months_back || 6))
    const afterStr = `${afterDate.getFullYear()}/${String(afterDate.getMonth() + 1).padStart(2, '0')}/${String(afterDate.getDate()).padStart(2, '0')}`

    // Fetch message list (50 per page)
    let url = `https://www.googleapis.com/gmail/v1/users/me/messages?maxResults=50&q=after:${afterStr}`
    if (page_token) url += `&pageToken=${page_token}`

    const listRes = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    const listData = await listRes.json()

    if (!listData.messages || listData.messages.length === 0) {
      return new Response(JSON.stringify({
        emails: [], next_page_token: null, total_estimated: listData.resultSizeEstimate || 0
      }), { headers: { 'Content-Type': 'application/json' } })
    }

    // Fetch details for each message (batch of 50)
    const emails = []
    for (const msg of listData.messages) {
      try {
        const msgRes = await fetch(
          `https://www.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`,
          { headers: { Authorization: `Bearer ${token}` } }
        )
        const msgData = await msgRes.json()
        const headers = msgData.payload?.headers || []
        const getHeader = (name) => headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || ''

        let body = ''
        if (msgData.payload?.body?.data) {
          body = Buffer.from(msgData.payload.body.data, 'base64url').toString('utf8')
        } else if (msgData.payload?.parts) {
          const textPart = msgData.payload.parts.find(p => p.mimeType === 'text/plain')
          if (textPart?.body?.data) {
            body = Buffer.from(textPart.body.data, 'base64url').toString('utf8')
          }
        }

        // Extract attachment info
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

        emails.push({
          gmail_id: msg.id,
          thread_id: msg.threadId,
          from: getHeader('From'),
          to: getHeader('To'),
          subject: getHeader('Subject'),
          date: getHeader('Date'),
          body: body.slice(0, 3000),
          snippet: msgData.snippet || '',
          attachments
        })
      } catch (e) {
        // Skip failed messages
      }
    }

    return new Response(JSON.stringify({
      emails,
      next_page_token: listData.nextPageToken || null,
      total_estimated: listData.resultSizeEstimate || 0
    }), { headers: { 'Content-Type': 'application/json' } })

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 })
  }
}

export const config = { path: '/.netlify/functions/gmail-bulk' }

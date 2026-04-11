import { makeAdmin, loadMailbox } from './_mailbox-helpers.mjs'

// Bulk historical fetch — paginated by pageToken.
// Accepts either mailbox_id or company_id.
export default async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST only' }), { status: 405 })
  }

  try {
    const { company_id, mailbox_id, page_token, months_back } = await req.json()
    if (!company_id && !mailbox_id) {
      return new Response(JSON.stringify({ error: 'company_id or mailbox_id required' }), { status: 400 })
    }

    const supabase = makeAdmin()
    const { mailbox, accessToken } = await loadMailbox(supabase, { mailbox_id, company_id })

    const afterDate = new Date()
    afterDate.setMonth(afterDate.getMonth() - (months_back || 6))
    const afterStr = `${afterDate.getFullYear()}/${String(afterDate.getMonth() + 1).padStart(2, '0')}/${String(afterDate.getDate()).padStart(2, '0')}`

    let url = `https://www.googleapis.com/gmail/v1/users/me/messages?maxResults=50&q=after:${afterStr}`
    if (page_token) url += `&pageToken=${page_token}`

    const listRes = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
    const listData = await listRes.json()

    if (!listData.messages || listData.messages.length === 0) {
      return new Response(JSON.stringify({
        emails: [],
        next_page_token: null,
        total_estimated: listData.resultSizeEstimate || 0,
        mailbox_id: mailbox.id || null
      }), { headers: { 'Content-Type': 'application/json' } })
    }

    const emails = []
    for (const msg of listData.messages) {
      try {
        const msgRes = await fetch(
          `https://www.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        )
        const msgData = await msgRes.json()
        const headers = msgData.payload?.headers || []
        const getHeader = (name) => headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || ''

        let body = ''
        let htmlBody = ''
        function extractBodies(payload) {
          if (!payload) return
          if (payload.mimeType === 'text/html' && payload.body?.data) htmlBody = Buffer.from(payload.body.data, 'base64url').toString('utf8')
          if (payload.mimeType === 'text/plain' && payload.body?.data) body = Buffer.from(payload.body.data, 'base64url').toString('utf8')
          if (payload.parts) payload.parts.forEach(p => extractBodies(p))
        }
        extractBodies(msgData.payload)

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
        })
      } catch (e) { /* skip failed */ }
    }

    return new Response(JSON.stringify({
      emails,
      next_page_token: listData.nextPageToken || null,
      total_estimated: listData.resultSizeEstimate || 0,
      mailbox_id: mailbox.id || null,
      mailbox_email: mailbox.email_address
    }), { headers: { 'Content-Type': 'application/json' } })

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: err.status || 500 })
  }
}

export const config = { path: '/.netlify/functions/gmail-bulk' }

import { makeAdmin, loadMailbox } from './_mailbox-helpers.mjs'

// Fetch recent emails for a specific mailbox.
// Accepts either mailbox_id (preferred) or company_id (legacy → resolves to primary).
export default async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST only' }), { status: 405 })
  }

  try {
    const { company_id, mailbox_id, max_results, after_date, folder = 'inbox' } = await req.json()
    if (!company_id && !mailbox_id) {
      return new Response(JSON.stringify({ error: 'company_id or mailbox_id required' }), { status: 400 })
    }

    const supabase = makeAdmin()
    const { mailbox, accessToken } = await loadMailbox(supabase, { mailbox_id, company_id })

    // Map folder → Gmail query operator
    const folderQuery = {
      inbox: 'in:inbox',
      sent: 'in:sent',
      spam: 'in:spam',
      trash: 'in:trash',
      drafts: 'in:drafts'
    }[folder] || 'in:inbox'

    // Fetch message list
    const listRes = await fetch(
      `https://www.googleapis.com/gmail/v1/users/me/messages?maxResults=${max_results || 10}&q=${encodeURIComponent(folderQuery + (after_date ? ' after:' + after_date : ''))}&includeSpamTrash=${folder === 'spam' || folder === 'trash' ? 'true' : 'false'}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
    const listData = await listRes.json()

    if (!listData.messages) {
      return new Response(JSON.stringify({
        emails: [],
        mailbox_id: mailbox.id || null,
        mailbox_email: mailbox.email_address
      }), { headers: { 'Content-Type': 'application/json' } })
    }

    const emails = await Promise.all(
      listData.messages.slice(0, max_results || 10).map(async (msg) => {
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
          if (payload.mimeType === 'text/html' && payload.body?.data) {
            htmlBody = Buffer.from(payload.body.data, 'base64url').toString('utf8')
          }
          if (payload.mimeType === 'text/plain' && payload.body?.data) {
            body = Buffer.from(payload.body.data, 'base64url').toString('utf8')
          }
          if (payload.parts) {
            for (const part of payload.parts) extractBodies(part)
          }
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

    // Bump last_sync_at
    if (mailbox.id) {
      await supabase
        .from('mailboxes')
        .update({ last_sync_at: new Date().toISOString(), last_sync_error: null })
        .eq('id', mailbox.id)
    }

    return new Response(JSON.stringify({
      emails,
      folder,
      mailbox_id: mailbox.id || null,
      mailbox_email: mailbox.email_address
    }), { headers: { 'Content-Type': 'application/json' } })

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: err.status || 500 })
  }
}

export const config = { path: '/.netlify/functions/gmail-fetch' }

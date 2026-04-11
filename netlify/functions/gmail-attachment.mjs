import { makeAdmin, loadMailbox } from './_mailbox-helpers.mjs'

// Download a Gmail attachment on demand.
// Accepts either mailbox_id or company_id.
export default async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST only' }), { status: 405 })
  }

  try {
    const { company_id, mailbox_id, gmail_id, attachment_id, filename } = await req.json()
    if ((!company_id && !mailbox_id) || !gmail_id || !attachment_id) {
      return new Response(JSON.stringify({ error: 'Missing params' }), { status: 400 })
    }

    const supabase = makeAdmin()
    const { accessToken } = await loadMailbox(supabase, { mailbox_id, company_id })

    const attRes = await fetch(
      `https://www.googleapis.com/gmail/v1/users/me/messages/${gmail_id}/attachments/${attachment_id}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
    const attData = await attRes.json()

    if (!attData.data) {
      return new Response(JSON.stringify({ error: 'Attachment not found' }), { status: 404 })
    }

    const fileData = Buffer.from(attData.data, 'base64url')
    const mimeType = attData.mimeType || 'application/octet-stream'

    return new Response(fileData, {
      headers: {
        'Content-Type': mimeType,
        'Content-Disposition': `attachment; filename="${filename || 'attachment'}"`,
      }
    })

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: err.status || 500 })
  }
}

export const config = { path: '/.netlify/functions/gmail-attachment' }

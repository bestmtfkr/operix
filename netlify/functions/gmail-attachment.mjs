import { createClient } from '@supabase/supabase-js'

// Download a specific Gmail attachment on demand
export default async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST only' }), { status: 405 })
  }

  try {
    const { company_id, gmail_id, attachment_id, filename } = await req.json()
    if (!company_id || !gmail_id || !attachment_id) {
      return new Response(JSON.stringify({ error: 'Missing params' }), { status: 400 })
    }

    const supabaseAdmin = createClient(
      process.env.SUPABASE_URL || 'https://gizgnbjaemxndmrherir.supabase.co',
      process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || ''
    )

    // Get Gmail token
    const { data: company } = await supabaseAdmin.from('companies')
      .select('gmail_tokens').eq('id', company_id).single()

    if (!company?.gmail_tokens?.access_token) {
      return new Response(JSON.stringify({ error: 'Gmail not connected' }), { status: 401 })
    }

    let token = company.gmail_tokens.access_token

    // Refresh if needed
    if (company.gmail_tokens.expires_at && new Date(company.gmail_tokens.expires_at) < new Date()) {
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
      if (refreshData.access_token) token = refreshData.access_token
    }

    // Fetch attachment from Gmail
    const attRes = await fetch(
      `https://www.googleapis.com/gmail/v1/users/me/messages/${gmail_id}/attachments/${attachment_id}`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    const attData = await attRes.json()

    if (!attData.data) {
      return new Response(JSON.stringify({ error: 'Attachment not found' }), { status: 404 })
    }

    // Return file directly as download — no storage needed
    const fileData = Buffer.from(attData.data, 'base64url')
    const mimeType = attData.mimeType || 'application/octet-stream'

    return new Response(fileData, {
      headers: {
        'Content-Type': mimeType,
        'Content-Disposition': `attachment; filename="${filename || 'attachment'}"`,
      }
    })

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 })
  }
}

export const config = { path: '/.netlify/functions/gmail-attachment' }

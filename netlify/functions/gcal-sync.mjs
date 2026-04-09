import { createClient } from '@supabase/supabase-js'

// Sync a job to Google Calendar — creates/updates a calendar event
export default async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST only' }), { status: 405 })
  }

  try {
    const { company_id, job } = await req.json()
    if (!company_id || !job) {
      return new Response(JSON.stringify({ error: 'Missing params' }), { status: 400 })
    }

    const supabaseAdmin = createClient(
      process.env.SUPABASE_URL || 'https://gizgnbjaemxndmrherir.supabase.co',
      process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || ''
    )

    // Get Gmail tokens (same Google account = same tokens for Calendar)
    const { data: company } = await supabaseAdmin.from('companies')
      .select('gmail_tokens').eq('id', company_id).single()

    if (!company?.gmail_tokens?.access_token) {
      return new Response(JSON.stringify({ error: 'Google not connected' }), { status: 401 })
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

    // Build calendar event
    const event = {
      summary: `${job.job_number || ''} ${job.name}`.trim(),
      description: [
        job.client_name ? `Client: ${job.client_name}` : '',
        job.site_address ? `Address: ${job.site_address}` : '',
        job.job_type ? `Type: ${job.job_type}` : '',
        job.description || ''
      ].filter(Boolean).join('\n'),
      location: job.site_address || '',
      start: {
        dateTime: job.scheduled_start,
        timeZone: 'America/Montreal'
      },
      end: {
        dateTime: job.scheduled_end || new Date(new Date(job.scheduled_start).getTime() + 2 * 3600000).toISOString(),
        timeZone: 'America/Montreal'
      },
      colorId: job.priority === 'emergency' ? '11' : job.priority === 'urgent' ? '6' : '10'
    }

    let eventId = job.gcal_event_id
    let res

    if (eventId) {
      // Update existing event
      res = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`,
        {
          method: 'PUT',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(event)
        }
      )
    } else {
      // Create new event
      res = await fetch(
        'https://www.googleapis.com/calendar/v3/calendars/primary/events',
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(event)
        }
      )
    }

    const eventData = await res.json()

    if (!res.ok) {
      return new Response(JSON.stringify({ error: 'Calendar error', details: eventData }), { status: 500 })
    }

    return new Response(JSON.stringify({
      event_id: eventData.id,
      html_link: eventData.htmlLink
    }), { headers: { 'Content-Type': 'application/json' } })

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 })
  }
}

export const config = { path: '/.netlify/functions/gcal-sync' }

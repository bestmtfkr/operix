// Fetches emails from Gmail using the user's access token
export default async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST only' }), { status: 405 })
  }

  try {
    const { access_token, refresh_token, max_results } = await req.json()

    let token = access_token

    // Try to refresh token if we have a refresh token
    if (refresh_token && !access_token) {
      const refreshRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: process.env.GOOGLE_CLIENT_ID,
          client_secret: process.env.GOOGLE_CLIENT_SECRET,
          refresh_token,
          grant_type: 'refresh_token'
        })
      })
      const refreshData = await refreshRes.json()
      token = refreshData.access_token
    }

    if (!token) {
      return new Response(JSON.stringify({ error: 'No valid token' }), { status: 401 })
    }

    // Fetch recent messages
    const listRes = await fetch(
      `https://www.googleapis.com/gmail/v1/users/me/messages?maxResults=${max_results || 10}&q=is:inbox`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    const listData = await listRes.json()

    if (!listData.messages) {
      return new Response(JSON.stringify({ emails: [], new_token: token }), {
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // Fetch each message details
    const emails = await Promise.all(
      listData.messages.slice(0, max_results || 10).map(async (msg) => {
        const msgRes = await fetch(
          `https://www.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`,
          { headers: { Authorization: `Bearer ${token}` } }
        )
        const msgData = await msgRes.json()

        const headers = msgData.payload?.headers || []
        const getHeader = (name) => headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || ''

        // Extract body
        let body = ''
        if (msgData.payload?.body?.data) {
          body = atob(msgData.payload.body.data.replace(/-/g, '+').replace(/_/g, '/'))
        } else if (msgData.payload?.parts) {
          const textPart = msgData.payload.parts.find(p => p.mimeType === 'text/plain')
          if (textPart?.body?.data) {
            body = atob(textPart.body.data.replace(/-/g, '+').replace(/_/g, '/'))
          }
        }

        return {
          gmail_id: msg.id,
          thread_id: msg.threadId,
          from: getHeader('From'),
          to: getHeader('To'),
          subject: getHeader('Subject'),
          date: getHeader('Date'),
          body: body.slice(0, 3000), // Limit body size
          snippet: msgData.snippet || ''
        }
      })
    )

    return new Response(JSON.stringify({ emails, new_token: token }), {
      headers: { 'Content-Type': 'application/json' }
    })

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 })
  }
}

export const config = { path: '/.netlify/functions/gmail-fetch' }

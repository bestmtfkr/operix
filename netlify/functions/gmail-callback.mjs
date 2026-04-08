import { createClient } from '@supabase/supabase-js'

// Handles Google OAuth callback
// Tokens are stored server-side in Supabase — NEVER sent to the browser
export default async (req) => {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const error = url.searchParams.get('error')
  const state = url.searchParams.get('state') // company_id passed from auth URL

  if (error || !code) {
    return new Response(`<html><body><script>
      window.opener?.postMessage({ type: 'gmail-error', error: '${error || 'No authorization code'}' }, '*');
      window.close();
    </script></body></html>`, { headers: { 'Content-Type': 'text/html' } })
  }

  try {
    // Exchange code for tokens (server-side)
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: `${url.origin}/auth/gmail/callback`,
        grant_type: 'authorization_code'
      })
    })

    const tokens = await tokenRes.json()
    if (!tokens.access_token) throw new Error('No access token received')

    // Get Gmail address
    const profileRes = await fetch('https://www.googleapis.com/gmail/v1/users/me/profile', {
      headers: { Authorization: `Bearer ${tokens.access_token}` }
    })
    const gmailProfile = await profileRes.json()

    // Store tokens server-side in Supabase using service role
    // Tokens are encrypted at rest by Supabase
    if (state) {
      const supabaseAdmin = createClient(
        process.env.SUPABASE_URL || 'https://gizgnbjaemxndmrherir.supabase.co',
        process.env.SUPABASE_SERVICE_KEY || ''
      )

      if (process.env.SUPABASE_SERVICE_KEY) {
        await supabaseAdmin.from('companies').update({
          gmail_tokens: {
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token || '',
            email: gmailProfile.emailAddress || '',
            connected_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString()
          }
        }).eq('id', state)
      }
    }

    // Only send the email back to the browser — NOT the tokens
    return new Response(`<html><body><script>
      window.opener?.postMessage({
        type: 'gmail-connected',
        email: '${gmailProfile.emailAddress || ''}'
      }, '*');
      window.close();
    </script><p>Gmail connected securely! This window will close...</p></body></html>`, {
      headers: { 'Content-Type': 'text/html' }
    })

  } catch (err) {
    return new Response(`<html><body><script>
      window.opener?.postMessage({ type: 'gmail-error', error: 'Connection failed' }, '*');
      window.close();
    </script></body></html>`, { headers: { 'Content-Type': 'text/html' } })
  }
}

export const config = { path: '/auth/gmail/callback' }

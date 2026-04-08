// Handles Google OAuth callback — exchanges code for tokens
export default async (req) => {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const error = url.searchParams.get('error')

  if (error || !code) {
    return new Response(`<html><body><script>
      window.opener?.postMessage({ type: 'gmail-error', error: '${error || 'No code'}' }, '*');
      window.close();
    </script></body></html>`, { headers: { 'Content-Type': 'text/html' } })
  }

  try {
    // Exchange code for tokens
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

    if (!tokens.access_token) {
      return new Response(`<html><body><script>
        window.opener?.postMessage({ type: 'gmail-error', error: 'Token exchange failed' }, '*');
        window.close();
      </script></body></html>`, { headers: { 'Content-Type': 'text/html' } })
    }

    // Get user's Gmail address
    const profileRes = await fetch('https://www.googleapis.com/gmail/v1/users/me/profile', {
      headers: { Authorization: `Bearer ${tokens.access_token}` }
    })
    const profile = await profileRes.json()

    // Send tokens back to the opener window
    return new Response(`<html><body><script>
      window.opener?.postMessage({
        type: 'gmail-connected',
        access_token: '${tokens.access_token}',
        refresh_token: '${tokens.refresh_token || ''}',
        email: '${profile.emailAddress || ''}',
        expires_in: ${tokens.expires_in || 3600}
      }, '*');
      window.close();
    </script><p>Gmail connected! This window will close...</p></body></html>`, {
      headers: { 'Content-Type': 'text/html' }
    })

  } catch (err) {
    return new Response(`<html><body><script>
      window.opener?.postMessage({ type: 'gmail-error', error: '${err.message}' }, '*');
      window.close();
    </script></body></html>`, { headers: { 'Content-Type': 'text/html' } })
  }
}

export const config = { path: '/auth/gmail/callback' }

// Redirects user to Google OAuth to connect their Gmail
// Passes company_id as state so callback knows where to store tokens
export default async (req) => {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const url = new URL(req.url)
  const companyId = url.searchParams.get('company_id') || ''
  const redirectUri = `${url.origin}/auth/gmail/callback`

  const scopes = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send'
  ].join(' ')

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
    `client_id=${clientId}&` +
    `redirect_uri=${encodeURIComponent(redirectUri)}&` +
    `response_type=code&` +
    `scope=${encodeURIComponent(scopes)}&` +
    `access_type=offline&` +
    `prompt=consent&` +
    `state=${companyId}`

  return Response.redirect(authUrl, 302)
}

export const config = { path: '/api/gmail/connect' }

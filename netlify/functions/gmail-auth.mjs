// Redirects user to Google OAuth to connect their Gmail.
// state format: "<company_id>|<intent>"
//   intent = "add"           → create a new mailbox row
//   intent = "mailbox:<id>"  → re-auth an existing mailbox (updates tokens)
//   (no intent)              → legacy primary-mailbox flow
export default async (req) => {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const url = new URL(req.url)
  const companyId = url.searchParams.get('company_id') || ''
  const intent = url.searchParams.get('intent') || 'add'
  const redirectUri = `${url.origin}/auth/gmail/callback`

  const scopes = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/gmail.send'
  ].join(' ')

  const state = `${companyId}|${intent}`

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
    `client_id=${clientId}&` +
    `redirect_uri=${encodeURIComponent(redirectUri)}&` +
    `response_type=code&` +
    `scope=${encodeURIComponent(scopes)}&` +
    `access_type=offline&` +
    `prompt=consent&` +
    `state=${encodeURIComponent(state)}`

  return Response.redirect(authUrl, 302)
}

export const config = { path: '/api/gmail/connect' }

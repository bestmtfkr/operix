// Redirects user to Intuit OAuth — passes company_id as state
// On first connect: scopes = accounting + openid (so we can read the realm)
export default async (req) => {
  const clientId = process.env.INTUIT_CLIENT_ID
  if (!clientId) {
    return new Response('INTUIT_CLIENT_ID not configured', { status: 500 })
  }
  const url = new URL(req.url)
  const companyId = url.searchParams.get('company_id') || ''
  const redirectUri = `${url.origin}/auth/qbo/callback`

  // com.intuit.quickbooks.accounting = read/write QBO data
  // openid + profile + email = identify the user account
  const scopes = 'com.intuit.quickbooks.accounting openid profile email'

  const state = `${companyId}|${Math.random().toString(36).slice(2)}`

  const authUrl = `https://appcenter.intuit.com/connect/oauth2?` +
    `client_id=${encodeURIComponent(clientId)}&` +
    `response_type=code&` +
    `scope=${encodeURIComponent(scopes)}&` +
    `redirect_uri=${encodeURIComponent(redirectUri)}&` +
    `state=${encodeURIComponent(state)}`

  return Response.redirect(authUrl, 302)
}

export const config = { path: '/api/qbo/connect' }

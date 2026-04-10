import { createClient } from '@supabase/supabase-js'

// Intuit OAuth callback
// - Exchanges code for tokens
// - Reads realmId from query string (Intuit appends it)
// - Stores tokens + realm + environment in companies.qbo_tokens (server-side only)
export default async (req) => {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const realmId = url.searchParams.get('realmId')
  const state = url.searchParams.get('state') || ''
  const error = url.searchParams.get('error')
  const companyId = state.split('|')[0]

  if (error || !code) {
    return new Response(popupHtml('error', { error: error || 'No authorization code' }), {
      headers: { 'Content-Type': 'text/html' }
    })
  }

  if (!realmId) {
    return new Response(popupHtml('error', { error: 'No realmId returned by Intuit' }), {
      headers: { 'Content-Type': 'text/html' }
    })
  }

  try {
    const clientId = process.env.INTUIT_CLIENT_ID
    const clientSecret = process.env.INTUIT_CLIENT_SECRET
    const env = process.env.INTUIT_ENV || 'sandbox'

    if (!clientId || !clientSecret) {
      throw new Error('INTUIT_CLIENT_ID / INTUIT_CLIENT_SECRET not configured')
    }

    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json'
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: `${url.origin}/auth/qbo/callback`
      })
    })

    const tokens = await tokenRes.json()
    if (!tokens.access_token) {
      throw new Error(tokens.error_description || tokens.error || 'Token exchange failed')
    }

    // Persist server-side
    if (companyId) {
      const supabaseAdmin = createClient(
        process.env.SUPABASE_URL || 'https://gizgnbjaemxndmrherir.supabase.co',
        process.env.SUPABASE_SERVICE_KEY || ''
      )

      if (process.env.SUPABASE_SERVICE_KEY) {
        // Read existing settings to merge realm_id without clobbering tax mapping
        const { data: existing } = await supabaseAdmin
          .from('companies')
          .select('qbo_settings')
          .eq('id', companyId)
          .single()

        const mergedSettings = {
          ...(existing?.qbo_settings || {}),
          realm_id: realmId,
          environment: env
        }

        await supabaseAdmin.from('companies').update({
          qbo_tokens: {
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token || '',
            connected_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString(),
            refresh_expires_at: new Date(Date.now() + (tokens.x_refresh_token_expires_in || 8726400) * 1000).toISOString(),
            realm_id: realmId
          },
          qbo_settings: mergedSettings
        }).eq('id', companyId)
      }
    }

    return new Response(popupHtml('connected', { realmId, environment: env }), {
      headers: { 'Content-Type': 'text/html' }
    })

  } catch (err) {
    return new Response(popupHtml('error', { error: err.message }), {
      headers: { 'Content-Type': 'text/html' }
    })
  }
}

function popupHtml(type, payload) {
  const json = JSON.stringify({ type: `qbo-${type}`, ...payload }).replace(/</g, '\\u003c')
  return `<!doctype html><html><body style="font-family:system-ui;padding:24px;color:#333">
    <p>${type === 'connected' ? '✓ QuickBooks connected — you can close this window.' : '✗ Connection failed: ' + (payload.error || '')}</p>
    <script>
      try { window.opener?.postMessage(${json}, '*') } catch(e) {}
      setTimeout(() => window.close(), 800)
    </script>
  </body></html>`
}

export const config = { path: '/auth/qbo/callback' }

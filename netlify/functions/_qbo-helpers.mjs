import { createClient } from '@supabase/supabase-js'

// Shared helpers for all QBO functions:
// - getCompanyQbo(supabase, companyId)  → { tokens, settings, realmId, baseUrl } or throws
// - refreshIfNeeded(supabase, companyId, current) → updated tokens
// - qboFetch(baseUrl, token, path, opts) → JSON
// - getBaseUrl(env) → API base for sandbox or production

export function getBaseUrl(env) {
  return env === 'production'
    ? 'https://quickbooks.api.intuit.com'
    : 'https://sandbox-quickbooks.api.intuit.com'
}

export function makeAdmin() {
  return createClient(
    process.env.SUPABASE_URL || 'https://gizgnbjaemxndmrherir.supabase.co',
    process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || ''
  )
}

export async function loadQboCompany(supabase, companyId) {
  const { data: company, error } = await supabase
    .from('companies')
    .select('qbo_tokens, qbo_settings')
    .eq('id', companyId)
    .single()

  if (error || !company) throw new Error('Company not found')
  if (!company.qbo_tokens?.access_token) throw new Error('QuickBooks not connected')

  const env = company.qbo_settings?.environment || 'sandbox'
  const realmId = company.qbo_tokens.realm_id
  if (!realmId) throw new Error('No realmId stored — reconnect QuickBooks')

  return {
    tokens: company.qbo_tokens,
    settings: company.qbo_settings || {},
    realmId,
    env,
    baseUrl: getBaseUrl(env)
  }
}

// Refresh access token if expired (or about to expire in <2 min)
export async function refreshIfNeeded(supabase, companyId, tokens) {
  const expiresAt = tokens.expires_at ? new Date(tokens.expires_at) : new Date(0)
  const needsRefresh = expiresAt.getTime() - Date.now() < 2 * 60 * 1000

  if (!needsRefresh) return tokens.access_token

  if (!tokens.refresh_token) throw new Error('Token expired and no refresh_token — reconnect QuickBooks')

  const clientId = process.env.INTUIT_CLIENT_ID
  const clientSecret = process.env.INTUIT_CLIENT_SECRET

  const refreshRes = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json'
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token
    })
  })

  const refreshed = await refreshRes.json()
  if (!refreshed.access_token) {
    throw new Error('Token refresh failed: ' + (refreshed.error_description || refreshed.error || 'unknown'))
  }

  const newTokens = {
    ...tokens,
    access_token: refreshed.access_token,
    refresh_token: refreshed.refresh_token || tokens.refresh_token,
    expires_at: new Date(Date.now() + (refreshed.expires_in || 3600) * 1000).toISOString(),
    refresh_expires_at: new Date(Date.now() + (refreshed.x_refresh_token_expires_in || 8726400) * 1000).toISOString()
  }

  await supabase.from('companies').update({ qbo_tokens: newTokens }).eq('id', companyId)
  return newTokens.access_token
}

// Single entry point for all QBO REST calls
// path is the part AFTER /v3/company/{realmId}/ — e.g. "customer" or "query?query=..."
export async function qboFetch(baseUrl, realmId, token, path, opts = {}) {
  const url = `${baseUrl}/v3/company/${realmId}/${path}${path.includes('?') ? '&' : '?'}minorversion=70`
  const res = await fetch(url, {
    method: opts.method || 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(opts.headers || {})
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  })

  const text = await res.text()
  let data
  try { data = text ? JSON.parse(text) : null } catch { data = { raw: text } }

  if (!res.ok) {
    const fault = data?.Fault?.Error?.[0]
    const msg = fault ? `${fault.Message}: ${fault.Detail || ''}` : `QBO API ${res.status}: ${text.slice(0, 300)}`
    const err = new Error(msg)
    err.status = res.status
    err.data = data
    throw err
  }

  return data
}

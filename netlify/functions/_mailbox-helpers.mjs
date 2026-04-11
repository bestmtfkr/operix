import { createClient } from '@supabase/supabase-js'

// Shared helpers for Gmail serverless functions.
// Backwards-compatible: accepts either mailbox_id (new) or company_id (legacy).
// When only company_id is passed, resolves to the primary mailbox for that company.

export function makeAdmin() {
  return createClient(
    process.env.SUPABASE_URL || 'https://gizgnbjaemxndmrherir.supabase.co',
    process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || ''
  )
}

// Load a mailbox row + return a fresh access token.
// opts: { mailbox_id?, company_id? }
// Priority: mailbox_id > primary mailbox of company_id > legacy companies.gmail_tokens
export async function loadMailbox(supabase, { mailbox_id, company_id }) {
  let mailbox = null

  if (mailbox_id) {
    const { data } = await supabase
      .from('mailboxes')
      .select('*')
      .eq('id', mailbox_id)
      .is('archived_at', null)
      .single()
    mailbox = data
  } else if (company_id) {
    // Resolve to primary mailbox
    const { data } = await supabase
      .from('mailboxes')
      .select('*')
      .eq('company_id', company_id)
      .eq('is_primary', true)
      .is('archived_at', null)
      .order('connected_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    mailbox = data
  }

  // Legacy fallback: if no mailbox row exists but the company still has
  // gmail_tokens on it, synthesize a virtual mailbox so nothing breaks.
  if (!mailbox && company_id) {
    const { data: company } = await supabase
      .from('companies')
      .select('id, gmail_tokens')
      .eq('id', company_id)
      .single()

    if (company?.gmail_tokens?.access_token) {
      mailbox = {
        id: null, // virtual — not a real row
        company_id: company.id,
        provider: 'gmail',
        email_address: company.gmail_tokens.email || '',
        tokens: company.gmail_tokens,
        _legacy: true
      }
    }
  }

  if (!mailbox) {
    const err = new Error('No connected mailbox found')
    err.status = 401
    throw err
  }

  if (!mailbox.tokens?.access_token) {
    const err = new Error('Gmail not connected')
    err.status = 401
    throw err
  }

  const accessToken = await refreshIfNeeded(supabase, mailbox)
  return { mailbox, accessToken }
}

// Refresh OAuth token if it's expired or about to expire in <2 min.
// Writes back to the correct store (mailboxes table or legacy companies.gmail_tokens).
export async function refreshIfNeeded(supabase, mailbox) {
  const tokens = mailbox.tokens
  const expiresAt = tokens.expires_at ? new Date(tokens.expires_at) : new Date(0)
  const stillValid = expiresAt.getTime() - Date.now() > 2 * 60 * 1000
  if (stillValid) return tokens.access_token

  if (!tokens.refresh_token) {
    const err = new Error('Token expired and no refresh_token — reconnect Gmail')
    err.status = 401
    throw err
  }

  const refreshRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: tokens.refresh_token,
      grant_type: 'refresh_token'
    })
  })
  const refreshData = await refreshRes.json()
  if (!refreshData.access_token) {
    const err = new Error('Token refresh failed — reconnect Gmail')
    err.status = 401
    throw err
  }

  const newTokens = {
    ...tokens,
    access_token: refreshData.access_token,
    expires_at: new Date(Date.now() + (refreshData.expires_in || 3600) * 1000).toISOString()
  }

  // Persist
  if (mailbox._legacy) {
    await supabase
      .from('companies')
      .update({ gmail_tokens: newTokens })
      .eq('id', mailbox.company_id)
  } else if (mailbox.id) {
    await supabase
      .from('mailboxes')
      .update({ tokens: newTokens, last_sync_at: new Date().toISOString() })
      .eq('id', mailbox.id)
  }

  mailbox.tokens = newTokens
  return newTokens.access_token
}

// Persist the list of active, sync-enabled mailboxes for a company.
// Used by frontend auto-sync loop to know which accounts to poll.
export async function listActiveMailboxes(supabase, companyId) {
  const { data } = await supabase
    .from('mailboxes')
    .select('id, email_address, provider, color, is_primary')
    .eq('company_id', companyId)
    .eq('status', 'active')
    .eq('sync_enabled', true)
    .is('archived_at', null)
    .order('is_primary', { ascending: false })
  return data || []
}

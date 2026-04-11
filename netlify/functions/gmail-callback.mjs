import { createClient } from '@supabase/supabase-js'

// Google OAuth callback.
// Exchanges code for tokens, then:
//   intent=add          → inserts a new row in mailboxes (or updates if email already exists)
//   intent=mailbox:<id> → updates tokens on the specified mailbox row
// Also mirrors tokens to companies.gmail_tokens for the primary mailbox (backwards compat).
const MAILBOX_COLORS = ['#00D4A0', '#2196F3', '#FF6B35', '#8B5CF6', '#FFB800']

export default async (req) => {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const error = url.searchParams.get('error')
  const rawState = url.searchParams.get('state') || ''
  const [companyId, intent = 'add'] = rawState.split('|')

  if (error || !code) {
    return popupResponse('gmail-error', { error: error || 'No authorization code' })
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
    if (!tokens.access_token) throw new Error('No access token received')

    // Get Gmail profile → email address
    const profileRes = await fetch('https://www.googleapis.com/gmail/v1/users/me/profile', {
      headers: { Authorization: `Bearer ${tokens.access_token}` }
    })
    const gmailProfile = await profileRes.json()
    const emailAddress = gmailProfile.emailAddress || ''

    if (!companyId) {
      return popupResponse('gmail-connected', { email: emailAddress })
    }

    const supabaseAdmin = createClient(
      process.env.SUPABASE_URL || 'https://gizgnbjaemxndmrherir.supabase.co',
      process.env.SUPABASE_SERVICE_KEY || ''
    )

    if (!process.env.SUPABASE_SERVICE_KEY) {
      // No service key — can't write to DB. Still inform the user in the popup.
      return popupResponse('gmail-connected', { email: emailAddress })
    }

    const tokenBlob = {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || '',
      email: emailAddress,
      connected_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString()
    }

    // Look up existing mailboxes for this company
    const { data: existing } = await supabaseAdmin
      .from('mailboxes')
      .select('id, email_address, is_primary')
      .eq('company_id', companyId)
      .is('archived_at', null)

    const existingByEmail = (existing || []).find(m => m.email_address === emailAddress)

    let mailboxRow = null

    if (intent.startsWith('mailbox:')) {
      // Re-auth of a specific existing mailbox — update tokens only
      const targetId = intent.split(':')[1]
      const { data } = await supabaseAdmin
        .from('mailboxes')
        .update({
          tokens: tokenBlob,
          email_address: emailAddress,
          status: 'active',
          last_sync_error: null
        })
        .eq('id', targetId)
        .eq('company_id', companyId)
        .select()
        .single()
      mailboxRow = data
    } else if (existingByEmail) {
      // Same email address already connected — update tokens, don't create duplicate
      const { data } = await supabaseAdmin
        .from('mailboxes')
        .update({
          tokens: tokenBlob,
          status: 'active',
          last_sync_error: null
        })
        .eq('id', existingByEmail.id)
        .select()
        .single()
      mailboxRow = data
    } else {
      // Brand new mailbox — insert
      const isFirst = (existing || []).length === 0
      const color = MAILBOX_COLORS[(existing || []).length % MAILBOX_COLORS.length]
      const { data } = await supabaseAdmin
        .from('mailboxes')
        .insert({
          company_id: companyId,
          provider: 'gmail',
          email_address: emailAddress,
          tokens: tokenBlob,
          display_name: emailAddress.split('@')[0],
          color,
          is_primary: isFirst,
          status: 'active'
        })
        .select()
        .single()
      mailboxRow = data
    }

    // Mirror to companies.gmail_tokens ONLY if this is the primary mailbox,
    // so legacy read paths keep working during the transition.
    if (mailboxRow?.is_primary) {
      await supabaseAdmin
        .from('companies')
        .update({ gmail_tokens: tokenBlob })
        .eq('id', companyId)
    }

    return popupResponse('gmail-connected', {
      email: emailAddress,
      mailbox_id: mailboxRow?.id || null
    })

  } catch (err) {
    return popupResponse('gmail-error', { error: err.message || 'Connection failed' })
  }
}

function popupResponse(type, payload) {
  const json = JSON.stringify({ type, ...payload }).replace(/</g, '\\u003c')
  return new Response(`<html><body>
    <p style="font-family:system-ui;padding:24px;color:#333">
      ${type === 'gmail-connected' ? '✓ Gmail connected — this window will close.' : '✗ ' + (payload.error || 'Connection failed')}
    </p>
    <script>
      try { window.opener?.postMessage(${json}, '*') } catch(e) {}
      setTimeout(() => window.close(), 600)
    </script>
  </body></html>`, { headers: { 'Content-Type': 'text/html' } })
}

export const config = { path: '/auth/gmail/callback' }

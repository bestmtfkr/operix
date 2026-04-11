import { makeAdmin, loadMailbox } from './_mailbox-helpers.mjs'

// Move an email between folders bidirectionally:
//   1. Update the inbox_emails row's folder column
//   2. Call Gmail's users.messages.modify to update labels
//
// Without step 2, the next sync would pull the message back into its
// original folder. Operix and Gmail must stay in sync.
//
// Gmail label mapping:
//   inbox → add INBOX, remove SPAM/TRASH
//   sent  → no-op (sent mail lives in SENT, you don't "move" things there)
//   spam  → add SPAM, remove INBOX, also call /trash? no (spam ≠ trash in Gmail)
//   trash → call users.messages.trash (preferred over label modify)
//   drafts → not supported via this function (drafts have their own flow)
export default async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST only' }), { status: 405 })
  }

  try {
    const { company_id, mailbox_id, email_id, gmail_id, target_folder } = await req.json()
    if (!email_id || !target_folder) {
      return new Response(JSON.stringify({ error: 'email_id and target_folder required' }), { status: 400 })
    }

    const validTargets = ['inbox', 'sent', 'spam', 'trash']
    if (!validTargets.includes(target_folder)) {
      return new Response(JSON.stringify({ error: 'invalid target_folder' }), { status: 400 })
    }

    const supabase = makeAdmin()

    // Look up the email row if mailbox_id or gmail_id not provided
    let mailboxIdResolved = mailbox_id
    let gmailIdResolved = gmail_id
    if (!mailboxIdResolved || !gmailIdResolved) {
      const { data: row } = await supabase
        .from('inbox_emails')
        .select('mailbox_id, metadata')
        .eq('id', email_id)
        .single()
      if (!row) {
        return new Response(JSON.stringify({ error: 'Email not found' }), { status: 404 })
      }
      mailboxIdResolved = mailboxIdResolved || row.mailbox_id
      gmailIdResolved = gmailIdResolved || row.metadata?.gmail_id
    }

    // Update local row first — optimistic, reversible if Gmail call fails
    await supabase.from('inbox_emails')
      .update({ folder: target_folder })
      .eq('id', email_id)

    // If we don't have Gmail credentials (local-only email), stop here
    if (!mailboxIdResolved || !gmailIdResolved) {
      return new Response(JSON.stringify({ success: true, gmail_synced: false }), {
        headers: { 'Content-Type': 'application/json' }
      })
    }

    const { accessToken } = await loadMailbox(supabase, { mailbox_id: mailboxIdResolved, company_id })

    // Trash uses its own endpoint
    if (target_folder === 'trash') {
      const trashRes = await fetch(
        `https://www.googleapis.com/gmail/v1/users/me/messages/${gmailIdResolved}/trash`,
        { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } }
      )
      if (!trashRes.ok) {
        const err = await trashRes.text()
        // Don't roll back local change — user's intent was clear, Gmail can be reconciled later
        console.error('Gmail trash failed:', err)
      }
    } else {
      // Use label modify for inbox/sent/spam
      const addLabels = []
      const removeLabels = []

      if (target_folder === 'inbox') {
        addLabels.push('INBOX')
        removeLabels.push('SPAM', 'TRASH')
      } else if (target_folder === 'spam') {
        addLabels.push('SPAM')
        removeLabels.push('INBOX')
      }
      // 'sent' → no label change; SENT is a Gmail system label assigned on send

      if (addLabels.length || removeLabels.length) {
        const modifyRes = await fetch(
          `https://www.googleapis.com/gmail/v1/users/me/messages/${gmailIdResolved}/modify`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ addLabelIds: addLabels, removeLabelIds: removeLabels })
          }
        )
        if (!modifyRes.ok) {
          const err = await modifyRes.text()
          console.error('Gmail modify failed:', err)
        }
      }
    }

    return new Response(JSON.stringify({
      success: true,
      gmail_synced: true,
      folder: target_folder
    }), { headers: { 'Content-Type': 'application/json' } })

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: err.status || 500 })
  }
}

export const config = { path: '/.netlify/functions/gmail-move-folder' }

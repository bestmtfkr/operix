import { makeAdmin, loadQboCompany, refreshIfNeeded, qboFetch } from './_qbo-helpers.mjs'

// Polls QBO for payment status of all pushed invoices.
// Runs:
//   - As a scheduled Netlify function (every 15 min, configured below)
//   - Manually via POST { company_id, invoice_id? } from the UI
//
// For each in-flight invoice (qbo_invoice_id IS NOT NULL, status not paid/void):
//   - Pull the QBO Invoice
//   - Compare Balance vs total → update amount_paid, amount_due, status
//   - When fully paid, mark status='paid' and add a payment record + job activity entry
export default async (req) => {
  const isScheduled = req.headers.get('user-agent')?.includes('Netlify') && req.method === 'POST'
  let body = {}
  if (req.method === 'POST') {
    try { body = await req.json() } catch {}
  }

  try {
    const supabase = makeAdmin()

    // If a single company_id was passed, only poll that one. Otherwise scan all connected companies.
    let companyIds = []
    if (body.company_id) {
      companyIds = [body.company_id]
    } else {
      const { data } = await supabase
        .from('companies')
        .select('id')
        .not('qbo_tokens', 'is', null)
      companyIds = (data || []).map(c => c.id)
    }

    const summary = { polled_companies: 0, updated_invoices: 0, errors: [] }

    for (const companyId of companyIds) {
      try {
        const { tokens, realmId, baseUrl } = await loadQboCompany(supabase, companyId)
        const token = await refreshIfNeeded(supabase, companyId, tokens)

        // Pull all in-flight pushed invoices for this company
        let invoicesQuery = supabase
          .from('invoices')
          .select('id, total, amount_paid, amount_due, status, qbo_invoice_id, qbo_sync_token, job_id')
          .eq('company_id', companyId)
          .not('qbo_invoice_id', 'is', null)
          .not('status', 'in', '(paid,void)')

        if (body.invoice_id) {
          invoicesQuery = invoicesQuery.eq('id', body.invoice_id)
        }

        const { data: ourInvoices } = await invoicesQuery
        if (!ourInvoices || ourInvoices.length === 0) continue

        // Batch fetch from QBO — up to 1000 IDs per query
        const ids = ourInvoices.map(i => `'${i.qbo_invoice_id}'`).join(',')
        const query = `select * from Invoice where Id in (${ids}) maxresults 1000`
        const data = await qboFetch(baseUrl, realmId, token, `query?query=${encodeURIComponent(query)}`)

        const qboInvoices = data?.QueryResponse?.Invoice || []
        const qboById = new Map(qboInvoices.map(qi => [qi.Id, qi]))

        for (const local of ourInvoices) {
          const qbo = qboById.get(local.qbo_invoice_id)
          if (!qbo) continue

          const totalAmt = parseFloat(qbo.TotalAmt || 0)
          const balance = parseFloat(qbo.Balance || 0)
          const amountPaid = totalAmt - balance

          // Determine new status
          let newStatus = local.status
          if (balance <= 0.001 && totalAmt > 0) newStatus = 'paid'
          else if (amountPaid > 0 && balance > 0) newStatus = 'partial'
          else if (qbo.EmailStatus === 'EmailSent' && local.status === 'draft') newStatus = 'sent'

          // Only update if something actually changed
          const changed = (
            Math.abs((parseFloat(local.amount_paid || 0)) - amountPaid) > 0.001 ||
            local.status !== newStatus
          )

          if (changed) {
            await supabase.from('invoices').update({
              amount_paid: amountPaid,
              amount_due: balance,
              status: newStatus,
              qbo_sync_token: qbo.SyncToken,
              qbo_last_synced_at: new Date().toISOString(),
              paid_at: newStatus === 'paid' ? new Date().toISOString() : undefined
            }).eq('id', local.id)

            // If newly fully paid, log to job activity
            if (newStatus === 'paid' && local.status !== 'paid' && local.job_id) {
              await supabase.from('job_activity').insert({
                company_id: companyId,
                job_id: local.job_id,
                type: 'payment_received',
                content: `Payment received: $${totalAmt.toFixed(2)} (via QuickBooks)`,
                metadata: { qbo_invoice_id: local.qbo_invoice_id, amount: totalAmt }
              })
            }

            summary.updated_invoices++
          }
        }

        summary.polled_companies++
      } catch (compErr) {
        summary.errors.push({ company_id: companyId, error: compErr.message })
      }
    }

    return new Response(JSON.stringify({ success: true, ...summary }), {
      headers: { 'Content-Type': 'application/json' }
    })

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500 })
  }
}

export const config = {
  path: '/.netlify/functions/qbo-poll-payments',
  schedule: '*/15 * * * *' // every 15 min
}

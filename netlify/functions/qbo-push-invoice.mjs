import { makeAdmin, loadQboCompany, refreshIfNeeded, qboFetch } from './_qbo-helpers.mjs'

// Push an Operix invoice to QuickBooks Online as a draft
// - If client has no qbo_customer_id, creates the Customer first
// - Maps line items, applies the configured tax code
// - Sets BillEmail to the resolved billing_email (job override > client > contact)
// - Optionally calls Invoice/{id}/send to email it from QBO when auto_send is enabled
//
// Sets invoices.qbo_invoice_id, qbo_sync_token, qbo_pushed_at, clears qbo_sync_error.
export default async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST only' }), { status: 405 })
  }

  try {
    const { company_id, invoice_id, send_now } = await req.json()
    if (!company_id || !invoice_id) {
      return new Response(JSON.stringify({ error: 'company_id and invoice_id required' }), { status: 400 })
    }

    const supabase = makeAdmin()
    const { tokens, settings, realmId, baseUrl } = await loadQboCompany(supabase, company_id)
    const token = await refreshIfNeeded(supabase, company_id, tokens)

    // Load invoice + lines + client + job
    const { data: invoice, error: invErr } = await supabase
      .from('invoices')
      .select('*, clients(id, name, contact_email, billing_email, qbo_customer_id, qbo_sync_token, billing_address_line1, billing_city, billing_province_state, billing_postal_zip, billing_country), jobs(id, name, billing_email)')
      .eq('id', invoice_id)
      .eq('company_id', company_id)
      .single()

    if (invErr || !invoice) throw new Error('Invoice not found')

    const { data: lines } = await supabase
      .from('invoice_lines')
      .select('*')
      .eq('invoice_id', invoice_id)
      .order('sort_order')

    if (!lines || lines.length === 0) throw new Error('Invoice has no line items')

    // Resolve billing email: invoice override > job override > client billing > client contact
    const billingEmail =
      invoice.billing_email ||
      invoice.jobs?.billing_email ||
      invoice.clients?.billing_email ||
      invoice.clients?.contact_email ||
      null

    // Step 1: Ensure customer exists in QBO
    let qboCustomerId = invoice.clients?.qbo_customer_id
    let qboCustomerSyncToken = invoice.clients?.qbo_sync_token

    if (!qboCustomerId) {
      // Create customer
      const customerPayload = {
        DisplayName: invoice.clients.name,
        PrimaryEmailAddr: invoice.clients.contact_email ? { Address: invoice.clients.contact_email } : undefined,
        BillAddr: invoice.clients.billing_address_line1 ? {
          Line1: invoice.clients.billing_address_line1,
          City: invoice.clients.billing_city || undefined,
          CountrySubDivisionCode: invoice.clients.billing_province_state || undefined,
          PostalCode: invoice.clients.billing_postal_zip || undefined,
          Country: invoice.clients.billing_country || undefined
        } : undefined
      }

      const created = await qboFetch(baseUrl, realmId, token, 'customer', {
        method: 'POST',
        body: customerPayload
      })

      qboCustomerId = created?.Customer?.Id
      qboCustomerSyncToken = created?.Customer?.SyncToken
      if (!qboCustomerId) throw new Error('Customer create failed')

      await supabase.from('clients').update({
        qbo_customer_id: qboCustomerId,
        qbo_sync_token: qboCustomerSyncToken
      }).eq('id', invoice.clients.id)
    }

    // Step 2: Build invoice payload
    // QBO requires every line to reference an Item. We use the configured default_item_id
    // or fall back to the first available service item.
    let defaultItemId = settings.default_item_id
    if (!defaultItemId) {
      const itemQuery = await qboFetch(
        baseUrl, realmId, token,
        `query?query=${encodeURIComponent("select * from Item where Type = 'Service' and Active = true maxresults 1")}`
      )
      defaultItemId = itemQuery?.QueryResponse?.Item?.[0]?.Id
      if (!defaultItemId) throw new Error('No service item found in QuickBooks. Please create at least one service item.')
    }

    const taxCodeId = settings.tax_code_id || 'NON' // 'NON' = non-taxable fallback

    const qboLines = lines.map((l, idx) => ({
      DetailType: 'SalesItemLineDetail',
      Description: l.description,
      Amount: parseFloat(l.amount || (l.quantity * l.unit_price)),
      LineNum: idx + 1,
      SalesItemLineDetail: {
        ItemRef: { value: defaultItemId },
        Qty: parseFloat(l.quantity || 1),
        UnitPrice: parseFloat(l.unit_price || 0),
        TaxCodeRef: { value: l.taxable !== false ? taxCodeId : 'NON' }
      }
    }))

    const invoicePayload = {
      CustomerRef: { value: qboCustomerId },
      Line: qboLines,
      DueDate: invoice.due_date,
      TxnDate: invoice.issue_date,
      DocNumber: invoice.invoice_number,
      BillEmail: billingEmail ? { Address: billingEmail } : undefined,
      EmailStatus: send_now || settings.auto_send ? 'NeedToSend' : 'NotSet',
      PrivateNote: invoice.internal_notes || undefined,
      CustomerMemo: invoice.notes ? { value: invoice.notes } : undefined
    }

    // Step 3: Create or update the invoice in QBO
    let qboInvoice
    if (invoice.qbo_invoice_id && invoice.qbo_sync_token) {
      // Update existing — sparse update
      const updatePayload = {
        ...invoicePayload,
        Id: invoice.qbo_invoice_id,
        SyncToken: invoice.qbo_sync_token,
        sparse: true
      }
      const updated = await qboFetch(baseUrl, realmId, token, 'invoice', {
        method: 'POST',
        body: updatePayload
      })
      qboInvoice = updated?.Invoice
    } else {
      const created = await qboFetch(baseUrl, realmId, token, 'invoice', {
        method: 'POST',
        body: invoicePayload
      })
      qboInvoice = created?.Invoice
    }

    if (!qboInvoice?.Id) throw new Error('Invoice create/update failed')

    // Step 4: Optionally call /send to actually email it from QBO
    if ((send_now || settings.auto_send) && billingEmail) {
      try {
        await qboFetch(
          baseUrl, realmId, token,
          `invoice/${qboInvoice.Id}/send?sendTo=${encodeURIComponent(billingEmail)}`,
          { method: 'POST' }
        )
      } catch (sendErr) {
        // Don't fail the whole push if send fails — invoice is still in QBO
        console.error('Send failed:', sendErr.message)
      }
    }

    // Step 5: Persist sync state
    await supabase.from('invoices').update({
      qbo_invoice_id: qboInvoice.Id,
      qbo_sync_token: qboInvoice.SyncToken,
      qbo_pushed_at: new Date().toISOString(),
      qbo_last_synced_at: new Date().toISOString(),
      qbo_sync_error: null,
      billing_email: billingEmail
    }).eq('id', invoice_id)

    return new Response(JSON.stringify({
      success: true,
      qbo_invoice_id: qboInvoice.Id,
      qbo_invoice_number: qboInvoice.DocNumber,
      sent: !!(send_now || settings.auto_send),
      billing_email: billingEmail
    }), { headers: { 'Content-Type': 'application/json' } })

  } catch (err) {
    // Persist the error so the UI can show it
    try {
      const supabase = makeAdmin()
      const body = await req.clone().json().catch(() => ({}))
      if (body.invoice_id) {
        await supabase.from('invoices').update({
          qbo_sync_error: err.message
        }).eq('id', body.invoice_id)
      }
    } catch {}

    return new Response(JSON.stringify({ error: err.message }), {
      status: err.status || 500
    })
  }
}

export const config = { path: '/.netlify/functions/qbo-push-invoice' }

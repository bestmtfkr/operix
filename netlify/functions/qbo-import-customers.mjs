import { makeAdmin, loadQboCompany, refreshIfNeeded, qboFetch } from './_qbo-helpers.mjs'

// Pulls all QBO customers, returns them to the frontend
// Frontend decides what to do with them (import as new clients, link to existing, etc.)
// Also: optionally upserts directly into Operix clients table when ?save=true
export default async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST only' }), { status: 405 })
  }

  try {
    const { company_id, save = false } = await req.json()
    if (!company_id) {
      return new Response(JSON.stringify({ error: 'company_id required' }), { status: 400 })
    }

    const supabase = makeAdmin()
    const { tokens, realmId, baseUrl } = await loadQboCompany(supabase, company_id)
    const token = await refreshIfNeeded(supabase, company_id, tokens)

    // Page through all customers — QBO max 1000 per query
    const customers = []
    let startPosition = 1
    const pageSize = 1000

    while (true) {
      const query = `select * from Customer where Active = true startposition ${startPosition} maxresults ${pageSize}`
      const data = await qboFetch(baseUrl, realmId, token, `query?query=${encodeURIComponent(query)}`)

      const batch = data?.QueryResponse?.Customer || []
      customers.push(...batch)

      if (batch.length < pageSize) break
      startPosition += pageSize
    }

    // Map QBO Customer → minimal shape for Operix UI
    const mapped = customers.map(c => ({
      qbo_customer_id: c.Id,
      qbo_sync_token: c.SyncToken,
      name: c.DisplayName || c.CompanyName || c.GivenName || 'Unnamed',
      contact_name: [c.GivenName, c.FamilyName].filter(Boolean).join(' ') || null,
      contact_email: c.PrimaryEmailAddr?.Address || null,
      contact_phone: c.PrimaryPhone?.FreeFormNumber || null,
      billing_email: c.PrimaryEmailAddr?.Address || null,
      billing_address_line1: c.BillAddr?.Line1 || null,
      billing_city: c.BillAddr?.City || null,
      billing_province_state: c.BillAddr?.CountrySubDivisionCode || null,
      billing_postal_zip: c.BillAddr?.PostalCode || null,
      billing_country: c.BillAddr?.Country || null,
      type: 'commercial'
    }))

    // If save=true, upsert into clients (linked by qbo_customer_id)
    let saved = 0
    let linked = 0
    let created = 0
    if (save) {
      // Pull existing clients to detect link vs create
      const { data: existing } = await supabase
        .from('clients')
        .select('id, name, qbo_customer_id, contact_email')
        .eq('company_id', company_id)
        .is('archived_at', null)

      const byQboId = new Map((existing || []).filter(c => c.qbo_customer_id).map(c => [c.qbo_customer_id, c]))
      const byEmail = new Map((existing || []).filter(c => c.contact_email && !c.qbo_customer_id).map(c => [c.contact_email.toLowerCase(), c]))
      const byName = new Map((existing || []).filter(c => !c.qbo_customer_id).map(c => [c.name.toLowerCase().trim(), c]))

      for (const cust of mapped) {
        const payload = { ...cust, company_id }

        // Already linked by qbo_customer_id → update
        if (byQboId.has(cust.qbo_customer_id)) {
          const row = byQboId.get(cust.qbo_customer_id)
          await supabase.from('clients').update(payload).eq('id', row.id)
          saved++
          continue
        }

        // Match by email or name → link
        const emailMatch = cust.contact_email && byEmail.get(cust.contact_email.toLowerCase())
        const nameMatch = byName.get(cust.name.toLowerCase().trim())
        const match = emailMatch || nameMatch
        if (match) {
          await supabase.from('clients').update({
            qbo_customer_id: cust.qbo_customer_id,
            qbo_sync_token: cust.qbo_sync_token,
            billing_email: cust.billing_email || null
          }).eq('id', match.id)
          linked++
          continue
        }

        // New → insert
        await supabase.from('clients').insert(payload)
        created++
      }

      // Update last sync timestamp
      const { data: comp } = await supabase.from('companies').select('qbo_settings').eq('id', company_id).single()
      await supabase.from('companies').update({
        qbo_settings: { ...(comp?.qbo_settings || {}), last_customer_sync_at: new Date().toISOString() }
      }).eq('id', company_id)
    }

    return new Response(JSON.stringify({
      total: customers.length,
      saved,
      linked,
      created,
      customers: save ? null : mapped // only return rows when previewing
    }), { headers: { 'Content-Type': 'application/json' } })

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: err.status || 500
    })
  }
}

export const config = { path: '/.netlify/functions/qbo-import-customers' }

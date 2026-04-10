import { makeAdmin, loadQboCompany, refreshIfNeeded, qboFetch } from './_qbo-helpers.mjs'

// Returns the company's QBO TaxCodes so the user can pick which one
// to use as the default for pushed invoices.
export default async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST only' }), { status: 405 })
  }

  try {
    const { company_id } = await req.json()
    if (!company_id) {
      return new Response(JSON.stringify({ error: 'company_id required' }), { status: 400 })
    }

    const supabase = makeAdmin()
    const { tokens, realmId, baseUrl } = await loadQboCompany(supabase, company_id)
    const token = await refreshIfNeeded(supabase, company_id, tokens)

    const data = await qboFetch(
      baseUrl, realmId, token,
      `query?query=${encodeURIComponent('select * from TaxCode where Active = true maxresults 200')}`
    )

    const taxCodes = (data?.QueryResponse?.TaxCode || []).map(tc => ({
      id: tc.Id,
      name: tc.Name,
      description: tc.Description || '',
      taxable: tc.Taxable !== false,
      // Sum of rates from referenced TaxRates (rough preview only)
      rate: (tc.SalesTaxRateList?.TaxRateDetail || [])
        .reduce((s, d) => s + (parseFloat(d.RateValue || 0)), 0)
    }))

    return new Response(JSON.stringify({ tax_codes: taxCodes }), {
      headers: { 'Content-Type': 'application/json' }
    })

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: err.status || 500
    })
  }
}

export const config = { path: '/.netlify/functions/qbo-tax-codes' }

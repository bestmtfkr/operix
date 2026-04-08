import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'

export default function QuotePDF({ quoteId, onClose }) {
  const { companyId } = useAuth()
  const [quote, setQuote] = useState(null)
  const [lines, setLines] = useState([])
  const [company, setCompany] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadData() }, [quoteId])

  async function loadData() {
    const [qRes, linesRes, compRes] = await Promise.all([
      supabase.from('quotes').select('*, clients(*)').eq('id', quoteId).single(),
      supabase.from('invoice_lines').select('*').eq('quote_id', quoteId).order('sort_order'),
      supabase.from('companies').select('*').eq('id', companyId).single()
    ])
    setQuote(qRes.data)
    setLines(linesRes.data || [])
    setCompany(compRes.data)
    setLoading(false)
  }

  function printQuote() {
    const content = document.getElementById('quote-print-area')
    const win = window.open('', '_blank')
    win.document.write(`<html><head><title>${quote.quote_number}</title>
      <style>
        * { margin:0; padding:0; box-sizing:border-box; }
        body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1a1a1a; padding: 40px; font-size: 14px; }
        table { width: 100%; border-collapse: collapse; }
        th { text-align: left; padding: 12px 8px; font-size: 10px; font-weight: 700; color: #999; text-transform: uppercase; letter-spacing: 1px; border-bottom: 2px solid #eee; }
        td { padding: 12px 8px; border-bottom: 1px solid #f0f0f0; font-size: 13px; }
        @media print { body { padding: 20px; } }
      </style></head><body>${content.innerHTML}</body></html>`)
    win.document.close()
    setTimeout(() => win.print(), 300)
  }

  if (loading) return <div className="loading-center"><div className="spinner" /></div>
  if (!quote || !company) return null

  const client = quote.clients || {}
  const statusLabel = { draft: 'DRAFT', sent: 'SENT', approved: 'APPROVED', declined: 'DECLINED', expired: 'EXPIRED' }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.85)', display: 'flex', flexDirection: 'column', alignItems: 'center', overflow: 'auto', padding: '20px 16px', paddingTop: 'calc(env(safe-area-inset-top, 44px) + 16px)', paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 20px)' }}>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, width: '100%', maxWidth: 700 }}>
        <button className="btn btn-primary" style={{ flex: 1 }} onClick={printQuote}>🖨 Print / Save PDF</button>
        <button className="btn btn-secondary" onClick={onClose}>Close</button>
      </div>

      <div id="quote-print-area" style={{ background: '#fff', color: '#1a1a1a', borderRadius: 12, padding: 40, width: '100%', maxWidth: 700, fontSize: 14, fontFamily: "'Helvetica Neue', Arial, sans-serif" }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 40 }}>
          <div>
            <div style={{ fontSize: 24, fontWeight: 800, color: '#00D4A0' }}>{company.name}</div>
            <div style={{ fontSize: 12, color: '#666', marginTop: 4, lineHeight: 1.6 }}>
              {company.address_line1 && <>{company.address_line1}<br /></>}
              {company.city && <>{company.city}, {company.province_state} {company.postal_zip}<br /></>}
              {company.phone && <>{company.phone}<br /></>}
              {company.email && <>{company.email}</>}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 28, fontWeight: 800 }}>QUOTE</div>
            <div style={{ fontSize: 14, color: '#666', marginTop: 4 }}>{quote.quote_number}</div>
            {quote.version > 1 && <div style={{ fontSize: 12, color: '#999' }}>Version {quote.version}</div>}
          </div>
        </div>

        {/* Meta */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 30, padding: 20, background: '#f8f9fa', borderRadius: 8 }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#999', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Prepared For</div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{client.name}</div>
            {client.contact_name && <div style={{ fontSize: 12, color: '#666' }}>{client.contact_name}</div>}
            {client.billing_address_line1 && <div style={{ fontSize: 12, color: '#666' }}>{client.billing_address_line1}</div>}
            {client.billing_city && <div style={{ fontSize: 12, color: '#666' }}>{client.billing_city}, {client.billing_province_state}</div>}
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#999', textTransform: 'uppercase', letterSpacing: 1 }}>Date</div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{quote.issue_date}</div>
            </div>
            {quote.expiry_date && (
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#999', textTransform: 'uppercase', letterSpacing: 1 }}>Valid Until</div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{quote.expiry_date}</div>
              </div>
            )}
          </div>
        </div>

        {/* Line Items */}
        <table>
          <thead>
            <tr>
              <th>Description</th>
              <th>Type</th>
              <th style={{ textAlign: 'right' }}>Qty</th>
              <th style={{ textAlign: 'right' }}>Price</th>
              <th style={{ textAlign: 'right' }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.map(l => (
              <tr key={l.id}>
                <td>{l.description}</td>
                <td style={{ color: '#666', fontSize: 12 }}>{l.line_type}</td>
                <td style={{ textAlign: 'right' }}>{l.quantity} {l.unit}</td>
                <td style={{ textAlign: 'right' }}>${parseFloat(l.unit_price).toFixed(2)}</td>
                <td style={{ textAlign: 'right', fontWeight: 600 }}>${parseFloat(l.amount).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totals */}
        <div style={{ marginLeft: 'auto', width: 280, marginTop: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 13, color: '#666' }}>
            <span>Subtotal</span><span>${parseFloat(quote.subtotal).toFixed(2)}</span>
          </div>
          {quote.tax1_label && (
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 13, color: '#666' }}>
              <span>{quote.tax1_label} ({((quote.tax1_rate || 0) * 100).toFixed(1)}%)</span>
              <span>${parseFloat(quote.tax1_amount || 0).toFixed(2)}</span>
            </div>
          )}
          {quote.tax2_label && quote.tax2_rate && (
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 13, color: '#666' }}>
              <span>{quote.tax2_label} ({((quote.tax2_rate || 0) * 100).toFixed(1)}%)</span>
              <span>${parseFloat(quote.tax2_amount || 0).toFixed(2)}</span>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 18, fontWeight: 800, borderTop: '2px solid #1a1a1a', marginTop: 8, paddingTop: 10 }}>
            <span>Total</span><span>${parseFloat(quote.total).toFixed(2)}</span>
          </div>
        </div>

        {quote.notes && (
          <div style={{ marginTop: 30, padding: 16, background: '#f8f9fa', borderRadius: 8, fontSize: 12, color: '#666', lineHeight: 1.6 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#999', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Terms & Notes</div>
            {quote.notes}
          </div>
        )}

        <div style={{ marginTop: 40, textAlign: 'center', fontSize: 11, color: '#999' }}>
          This quote is valid until {quote.expiry_date || 'further notice'} — {company.name}
        </div>
      </div>
    </div>
  )
}

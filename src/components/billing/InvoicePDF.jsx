import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'

export default function InvoicePDF({ invoiceId, onClose }) {
  const { companyId } = useAuth()
  const [invoice, setInvoice] = useState(null)
  const [lines, setLines] = useState([])
  const [company, setCompany] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadData() }, [invoiceId])

  async function loadData() {
    const [invRes, linesRes, compRes] = await Promise.all([
      supabase.from('invoices').select('*, clients(*)').eq('id', invoiceId).single(),
      supabase.from('invoice_lines').select('*').eq('invoice_id', invoiceId).order('sort_order'),
      supabase.from('companies').select('*').eq('id', companyId).single()
    ])
    setInvoice(invRes.data)
    setLines(linesRes.data || [])
    setCompany(compRes.data)
    setLoading(false)
  }

  function printInvoice() {
    const content = document.getElementById('invoice-print-area')
    const win = window.open('', '_blank')
    win.document.write(`
      <html><head><title>${invoice.invoice_number}</title>
      <style>
        * { margin:0; padding:0; box-sizing:border-box; }
        body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #1a1a1a; padding: 40px; font-size: 14px; }
        .header { display: flex; justify-content: space-between; margin-bottom: 40px; }
        .company-name { font-size: 24px; font-weight: 800; color: #00D4A0; }
        .company-info { font-size: 12px; color: #666; margin-top: 4px; line-height: 1.6; }
        .invoice-title { font-size: 28px; font-weight: 800; text-align: right; }
        .invoice-number { font-size: 14px; color: #666; text-align: right; margin-top: 4px; }
        .meta { display: flex; justify-content: space-between; margin-bottom: 30px; padding: 20px; background: #f8f9fa; border-radius: 8px; }
        .meta-section { }
        .meta-label { font-size: 10px; font-weight: 700; color: #999; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px; }
        .meta-value { font-size: 14px; font-weight: 600; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
        th { text-align: left; padding: 12px 8px; font-size: 10px; font-weight: 700; color: #999; text-transform: uppercase; letter-spacing: 1px; border-bottom: 2px solid #eee; }
        td { padding: 12px 8px; border-bottom: 1px solid #f0f0f0; font-size: 13px; }
        .amount { text-align: right; font-weight: 600; }
        .totals { margin-left: auto; width: 280px; }
        .total-row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 13px; color: #666; }
        .total-final { font-size: 18px; font-weight: 800; color: #1a1a1a; border-top: 2px solid #1a1a1a; margin-top: 8px; padding-top: 10px; }
        .notes { margin-top: 30px; padding: 16px; background: #f8f9fa; border-radius: 8px; font-size: 12px; color: #666; line-height: 1.6; }
        .footer { margin-top: 40px; text-align: center; font-size: 11px; color: #999; }
        @media print { body { padding: 20px; } }
      </style></head><body>
      ${content.innerHTML}
      </body></html>
    `)
    win.document.close()
    setTimeout(() => { win.print() }, 300)
  }

  if (loading) return <div className="loading-center"><div className="spinner" /></div>
  if (!invoice || !company) return null

  const client = invoice.clients || {}

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.85)', display: 'flex', flexDirection: 'column', alignItems: 'center', overflow: 'auto', padding: '20px 16px' }}>
      {/* Actions */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, width: '100%', maxWidth: 700 }}>
        <button className="btn btn-primary" style={{ flex: 1 }} onClick={printInvoice}>🖨 Print / Save PDF</button>
        <button className="btn btn-secondary" onClick={onClose}>Close</button>
      </div>

      {/* Invoice Preview */}
      <div id="invoice-print-area" style={{ background: '#fff', color: '#1a1a1a', borderRadius: 12, padding: 40, width: '100%', maxWidth: 700, fontSize: 14, fontFamily: "'Helvetica Neue', Arial, sans-serif" }}>
        {/* Header */}
        <div className="header" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 40 }}>
          <div>
            <div style={{ fontSize: 24, fontWeight: 800, color: '#00D4A0' }}>{company.name}</div>
            <div style={{ fontSize: 12, color: '#666', marginTop: 4, lineHeight: 1.6 }}>
              {company.address_line1 && <>{company.address_line1}<br /></>}
              {company.city && <>{company.city}, {company.province_state} {company.postal_zip}<br /></>}
              {company.phone && <>{company.phone}<br /></>}
              {company.email && <>{company.email}<br /></>}
              {company.settings?.tax_registration_number && <>Tax #: {company.settings.tax_registration_number}</>}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 28, fontWeight: 800 }}>INVOICE</div>
            <div style={{ fontSize: 14, color: '#666', marginTop: 4 }}>{invoice.invoice_number}</div>
          </div>
        </div>

        {/* Meta */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 30, padding: 20, background: '#f8f9fa', borderRadius: 8 }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#999', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Bill To</div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{client.name}</div>
            {client.contact_name && <div style={{ fontSize: 12, color: '#666' }}>{client.contact_name}</div>}
            {client.billing_address_line1 && <div style={{ fontSize: 12, color: '#666' }}>{client.billing_address_line1}</div>}
            {client.billing_city && <div style={{ fontSize: 12, color: '#666' }}>{client.billing_city}, {client.billing_province_state} {client.billing_postal_zip}</div>}
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#999', textTransform: 'uppercase', letterSpacing: 1 }}>Issue Date</div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{invoice.issue_date}</div>
            </div>
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#999', textTransform: 'uppercase', letterSpacing: 1 }}>Due Date</div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{invoice.due_date}</div>
            </div>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#999', textTransform: 'uppercase', letterSpacing: 1 }}>Status</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: invoice.status === 'paid' ? '#00D4A0' : invoice.status === 'overdue' ? '#FF3B5C' : '#1a1a1a' }}>
                {invoice.status.toUpperCase()}
              </div>
            </div>
          </div>
        </div>

        {/* Line Items Table */}
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 30 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '12px 8px', fontSize: 10, fontWeight: 700, color: '#999', textTransform: 'uppercase', letterSpacing: 1, borderBottom: '2px solid #eee' }}>Description</th>
              <th style={{ textAlign: 'left', padding: '12px 8px', fontSize: 10, fontWeight: 700, color: '#999', textTransform: 'uppercase', letterSpacing: 1, borderBottom: '2px solid #eee' }}>Type</th>
              <th style={{ textAlign: 'right', padding: '12px 8px', fontSize: 10, fontWeight: 700, color: '#999', textTransform: 'uppercase', letterSpacing: 1, borderBottom: '2px solid #eee' }}>Qty</th>
              <th style={{ textAlign: 'right', padding: '12px 8px', fontSize: 10, fontWeight: 700, color: '#999', textTransform: 'uppercase', letterSpacing: 1, borderBottom: '2px solid #eee' }}>Price</th>
              <th style={{ textAlign: 'right', padding: '12px 8px', fontSize: 10, fontWeight: 700, color: '#999', textTransform: 'uppercase', letterSpacing: 1, borderBottom: '2px solid #eee' }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.map(l => (
              <tr key={l.id}>
                <td style={{ padding: '12px 8px', borderBottom: '1px solid #f0f0f0', fontSize: 13 }}>{l.description}</td>
                <td style={{ padding: '12px 8px', borderBottom: '1px solid #f0f0f0', fontSize: 12, color: '#666' }}>{l.line_type}</td>
                <td style={{ padding: '12px 8px', borderBottom: '1px solid #f0f0f0', fontSize: 13, textAlign: 'right' }}>{l.quantity} {l.unit}</td>
                <td style={{ padding: '12px 8px', borderBottom: '1px solid #f0f0f0', fontSize: 13, textAlign: 'right' }}>${parseFloat(l.unit_price).toFixed(2)}</td>
                <td style={{ padding: '12px 8px', borderBottom: '1px solid #f0f0f0', fontSize: 13, textAlign: 'right', fontWeight: 600 }}>${parseFloat(l.amount).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totals */}
        <div style={{ marginLeft: 'auto', width: 280 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 13, color: '#666' }}>
            <span>Subtotal</span><span>${parseFloat(invoice.subtotal).toFixed(2)}</span>
          </div>
          {invoice.tax1_label && (
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 13, color: '#666' }}>
              <span>{invoice.tax1_label} ({((invoice.tax1_rate || 0) * 100).toFixed(1)}%)</span>
              <span>${parseFloat(invoice.tax1_amount || 0).toFixed(2)}</span>
            </div>
          )}
          {invoice.tax2_label && invoice.tax2_rate && (
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 13, color: '#666' }}>
              <span>{invoice.tax2_label} ({((invoice.tax2_rate || 0) * 100).toFixed(1)}%)</span>
              <span>${parseFloat(invoice.tax2_amount || 0).toFixed(2)}</span>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 18, fontWeight: 800, color: '#1a1a1a', borderTop: '2px solid #1a1a1a', marginTop: 8, paddingTop: 10 }}>
            <span>Total</span><span>${parseFloat(invoice.total).toFixed(2)}</span>
          </div>
          {invoice.amount_due > 0 && invoice.amount_due !== parseFloat(invoice.total) && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, fontWeight: 700, color: '#FF3B5C', marginTop: 6 }}>
              <span>Amount Due</span><span>${parseFloat(invoice.amount_due).toFixed(2)}</span>
            </div>
          )}
        </div>

        {/* Notes */}
        {invoice.notes && (
          <div style={{ marginTop: 30, padding: 16, background: '#f8f9fa', borderRadius: 8, fontSize: 12, color: '#666', lineHeight: 1.6 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#999', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Notes</div>
            {invoice.notes}
          </div>
        )}

        {/* Footer */}
        <div style={{ marginTop: 40, textAlign: 'center', fontSize: 11, color: '#999' }}>
          Thank you for your business — {company.name}
        </div>
      </div>
    </div>
  )
}

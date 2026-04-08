import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useToast } from '../shared/Toast'
import Modal from '../shared/Modal'
import QuotePDF from './QuotePDF'
import { QUOTE_STATUSES } from '../../lib/constants'

const STATUS_LABELS = { draft: 'Draft', sent: 'Sent', viewed: 'Viewed', approved: 'Approved', declined: 'Declined', expired: 'Expired' }
const STATUS_COLORS = { draft: '#3D4A5C', sent: '#2196F3', viewed: '#8B5CF6', approved: '#00D4A0', declined: '#FF3B5C', expired: '#3D4A5C' }

export default function QuotesList({ onConvert }) {
  const { companyId } = useAuth()
  const showToast = useToast()
  const [quotes, setQuotes] = useState([])
  const [clients, setClients] = useState([])
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [lines, setLines] = useState([])
  const [companySettings, setCompanySettings] = useState(null)
  const [viewPdfId, setViewPdfId] = useState(null)

  const [form, setForm] = useState({
    client_id: '', job_id: '', status: 'draft', issue_date: '', expiry_date: '', notes: '', internal_notes: ''
  })

  useEffect(() => {
    if (companyId) { loadQuotes(); loadClients(); loadJobs(); loadSettings() }
  }, [companyId])

  async function loadQuotes() {
    const { data } = await supabase.from('quotes')
      .select('*, clients(name), jobs(name, job_number)')
      .eq('company_id', companyId).order('created_at', { ascending: false })
    setQuotes(data || [])
    setLoading(false)
  }

  async function loadClients() {
    const { data } = await supabase.from('clients').select('id, name')
      .eq('company_id', companyId).is('archived_at', null).order('name')
    setClients(data || [])
  }

  async function loadJobs() {
    const { data } = await supabase.from('jobs').select('id, name, job_number, client_id')
      .eq('company_id', companyId).is('archived_at', null).order('created_at', { ascending: false })
    setJobs(data || [])
  }

  async function loadSettings() {
    const { data } = await supabase.from('companies').select('settings').eq('id', companyId).single()
    setCompanySettings(data?.settings || {})
  }

  async function loadLines(quoteId) {
    const { data } = await supabase.from('invoice_lines')
      .select('*').eq('quote_id', quoteId).order('sort_order')
    setLines(data || [])
  }

  function openNew() {
    setEditing(null)
    const today = new Date().toISOString().split('T')[0]
    const expiry = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0]
    setForm({ client_id: '', job_id: '', status: 'draft', issue_date: today, expiry_date: expiry, notes: '', internal_notes: '' })
    setLines([{ id: 'n1', line_type: 'service', description: '', quantity: 1, unit: 'each', unit_price: '', taxable: true }])
    setShowModal(true)
  }

  async function openEdit(quote) {
    setEditing(quote)
    setForm({
      client_id: quote.client_id || '', job_id: quote.job_id || '', status: quote.status || 'draft',
      issue_date: quote.issue_date || '', expiry_date: quote.expiry_date || '',
      notes: quote.notes || '', internal_notes: quote.internal_notes || ''
    })
    await loadLines(quote.id)
    setShowModal(true)
  }

  function addLine() {
    setLines(prev => [...prev, { id: 'n' + Date.now(), line_type: 'service', description: '', quantity: 1, unit: 'each', unit_price: '', taxable: true }])
  }

  function updateLine(idx, field, value) {
    setLines(prev => prev.map((l, i) => i === idx ? { ...l, [field]: value } : l))
  }

  function removeLine(idx) { setLines(prev => prev.filter((_, i) => i !== idx)) }

  function calcTotals() {
    const subtotal = lines.reduce((s, l) => s + (parseFloat(l.quantity) || 0) * (parseFloat(l.unit_price) || 0), 0)
    const taxable = lines.filter(l => l.taxable).reduce((s, l) => s + (parseFloat(l.quantity) || 0) * (parseFloat(l.unit_price) || 0), 0)
    const r1 = companySettings?.tax_rate_1 || 0
    const r2 = companySettings?.tax_rate_2 || 0
    return { subtotal, tax1: taxable * r1, tax2: r2 ? taxable * r2 : 0, total: subtotal + taxable * r1 + (r2 ? taxable * r2 : 0) }
  }

  async function saveQuote() {
    if (!form.client_id) { showToast('Please select a client'); return }
    if (!lines.some(l => l.description.trim())) { showToast('Add at least one line item'); return }

    const { subtotal, tax1, tax2, total } = calcTotals()
    const payload = {
      client_id: form.client_id, job_id: form.job_id || null, status: form.status,
      issue_date: form.issue_date, expiry_date: form.expiry_date || null,
      notes: form.notes, internal_notes: form.internal_notes,
      subtotal, total,
      tax1_label: companySettings?.tax_label_1, tax1_rate: companySettings?.tax_rate_1, tax1_amount: tax1,
      tax2_label: companySettings?.tax_label_2, tax2_rate: companySettings?.tax_rate_2, tax2_amount: tax2,
      company_id: companyId, updated_at: new Date().toISOString()
    }

    let quoteId, error
    if (editing) {
      quoteId = editing.id;
      ({ error } = await supabase.from('quotes').update(payload).eq('id', editing.id))
    } else {
      const { data: numData } = await supabase.rpc('generate_quote_number', { p_company_id: companyId })
      payload.quote_number = numData || ('QT-' + Date.now())
      const { data: saved, error: e } = await supabase.from('quotes').insert(payload).select().single()
      error = e; if (saved) quoteId = saved.id
    }

    if (error) { showToast('Error saving quote'); console.error(error); return }

    // Save lines
    if (editing) await supabase.from('invoice_lines').delete().eq('quote_id', quoteId)
    const linePayloads = lines.filter(l => l.description.trim()).map((l, i) => ({
      quote_id: quoteId, company_id: companyId, sort_order: i,
      line_type: l.line_type, description: l.description.trim(),
      quantity: parseFloat(l.quantity) || 1, unit: l.unit,
      unit_price: parseFloat(l.unit_price) || 0,
      amount: (parseFloat(l.quantity) || 1) * (parseFloat(l.unit_price) || 0),
      taxable: l.taxable
    }))
    if (linePayloads.length) {
      const { error: le } = await supabase.from('invoice_lines').insert(linePayloads)
      if (le) { showToast('Error saving line items'); console.error(le); return }
    }

    showToast(editing ? 'Quote updated' : 'Quote created')
    setShowModal(false)
    loadQuotes()
  }

  async function convertToInvoice() {
    if (!editing) return
    // Create invoice from quote
    const { subtotal, tax1, tax2, total } = calcTotals()
    const dueDate = new Date(Date.now() + (companySettings?.default_payment_terms_days || 30) * 86400000).toISOString().split('T')[0]

    const { data: numData } = await supabase.rpc('generate_invoice_number', { p_company_id: companyId })
    const invoicePayload = {
      company_id: companyId, client_id: editing.client_id, job_id: editing.job_id,
      quote_id: editing.id, invoice_number: numData || ('INV-' + Date.now()),
      status: 'draft', issue_date: new Date().toISOString().split('T')[0], due_date: dueDate,
      currency: companySettings?.currency || 'CAD',
      subtotal, total, amount_due: total,
      tax1_label: companySettings?.tax_label_1, tax1_rate: companySettings?.tax_rate_1, tax1_amount: tax1,
      tax2_label: companySettings?.tax_label_2, tax2_rate: companySettings?.tax_rate_2, tax2_amount: tax2
    }

    const { data: inv, error } = await supabase.from('invoices').insert(invoicePayload).select().single()
    if (error) { showToast('Error creating invoice'); console.error(error); return }

    // Copy lines to invoice
    const invoiceLines = lines.filter(l => l.description.trim()).map((l, i) => ({
      invoice_id: inv.id, company_id: companyId, sort_order: i,
      line_type: l.line_type, description: l.description.trim(),
      quantity: parseFloat(l.quantity) || 1, unit: l.unit,
      unit_price: parseFloat(l.unit_price) || 0,
      amount: (parseFloat(l.quantity) || 1) * (parseFloat(l.unit_price) || 0),
      taxable: l.taxable
    }))
    if (invoiceLines.length) await supabase.from('invoice_lines').insert(invoiceLines)

    // Mark quote as approved
    await supabase.from('quotes').update({ status: 'approved', approved_at: new Date().toISOString() }).eq('id', editing.id)

    // Move job to active if linked
    if (editing.job_id) {
      await supabase.from('jobs').update({ stage: 'active', stage_changed_at: new Date().toISOString() }).eq('id', editing.job_id)
    }

    showToast('Invoice created from quote')
    setShowModal(false)
    loadQuotes()
    if (onConvert) onConvert()
  }

  function updateForm(f, v) { setForm(prev => ({ ...prev, [f]: v })) }
  const { subtotal, tax1, tax2, total } = calcTotals()

  if (loading) return <div className="loading-center"><div className="spinner" /></div>

  return (
    <div>
      <div className="sec">
        <div className="sec-hdr">
          <div className="sec-title">Quotes</div>
          <div style={{ fontSize: 12, color: 'var(--text2)' }}>{quotes.length} total</div>
        </div>

        {quotes.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">📝</div>
            <div className="empty-title">No quotes yet</div>
            <div className="empty-sub">Tap + to create an estimate</div>
          </div>
        ) : (
          quotes.map(q => (
            <div key={q.id} className="card" onClick={() => openEdit(q)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>{q.clients?.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>
                    {q.quote_number} {q.jobs ? '· ' + q.jobs.name : ''}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 18, fontWeight: 800 }}>
                    ${parseFloat(q.total || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="badge" style={{ background: STATUS_COLORS[q.status] + '18', color: STATUS_COLORS[q.status] }}>
                  {STATUS_LABELS[q.status]}
                </span>
                {q.expiry_date && (
                  <span style={{ fontSize: 11, color: 'var(--text3)' }}>Expires {q.expiry_date}</span>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {showModal && (
        <Modal title={editing ? `Edit ${editing.quote_number}` : 'New Quote'} onClose={() => setShowModal(false)}>
          <div className="form-row">
            <div className="form-field">
              <label className="form-label">Client *</label>
              <select className="form-input" value={form.client_id} onChange={e => updateForm('client_id', e.target.value)}>
                <option value="">Select client...</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="form-field">
              <label className="form-label">Job (optional)</label>
              <select className="form-input" value={form.job_id} onChange={e => updateForm('job_id', e.target.value)}>
                <option value="">No job</option>
                {jobs.filter(j => !form.client_id || j.client_id === form.client_id).map(j =>
                  <option key={j.id} value={j.id}>{j.job_number} — {j.name}</option>
                )}
              </select>
            </div>
          </div>

          <div className="form-row">
            <div className="form-field">
              <label className="form-label">Issue Date</label>
              <input className="form-input" type="date" value={form.issue_date} onChange={e => updateForm('issue_date', e.target.value)} />
            </div>
            <div className="form-field">
              <label className="form-label">Expiry Date</label>
              <input className="form-input" type="date" value={form.expiry_date} onChange={e => updateForm('expiry_date', e.target.value)} />
            </div>
          </div>

          <div className="form-field">
            <label className="form-label">Status</label>
            <select className="form-input" value={form.status} onChange={e => updateForm('status', e.target.value)}>
              {QUOTE_STATUSES.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
            </select>
          </div>

          {/* Line Items */}
          <div style={{ marginTop: 16, marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <label className="form-label" style={{ margin: 0 }}>LINE ITEMS</label>
              <button className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: 12 }} onClick={addLine}>+ Add Line</button>
            </div>
            {lines.map((line, idx) => (
              <div key={line.id || idx} className="line-item-row">
                <div className="form-row" style={{ marginBottom: 8 }}>
                  <div className="form-field" style={{ flex: 2, marginBottom: 0 }}>
                    <input className="form-input" placeholder="Description" style={{ fontSize: 13, padding: '10px 12px' }}
                      value={line.description} onChange={e => updateLine(idx, 'description', e.target.value)} />
                  </div>
                  <div className="form-field" style={{ flex: 0.5, marginBottom: 0 }}>
                    <input className="form-input" type="number" placeholder="Qty" style={{ fontSize: 13, padding: '10px 8px' }}
                      value={line.quantity} onChange={e => updateLine(idx, 'quantity', e.target.value)} />
                  </div>
                  <div className="form-field" style={{ flex: 0.7, marginBottom: 0 }}>
                    <input className="form-input" type="number" placeholder="Price" style={{ fontSize: 13, padding: '10px 8px' }}
                      value={line.unit_price} onChange={e => updateLine(idx, 'unit_price', e.target.value)} />
                  </div>
                  <button style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', fontSize: 18, padding: '0 4px', alignSelf: 'center' }}
                    onClick={() => removeLine(idx)}>×</button>
                </div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 12, paddingLeft: 4 }}>
                  <select style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, padding: '4px 8px', fontSize: 11, color: 'var(--text2)', outline: 'none' }}
                    value={line.line_type} onChange={e => updateLine(idx, 'line_type', e.target.value)}>
                    <option value="service">Service</option>
                    <option value="material">Material</option>
                    <option value="equipment">Equipment</option>
                  </select>
                  <select style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, padding: '4px 8px', fontSize: 11, color: 'var(--text2)', outline: 'none' }}
                    value={line.unit} onChange={e => updateLine(idx, 'unit', e.target.value)}>
                    <option value="each">Each</option><option value="hour">Hour</option>
                    <option value="sqft">Sq Ft</option><option value="lnft">Ln Ft</option><option value="day">Day</option>
                  </select>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text2)', cursor: 'pointer' }}>
                    <input type="checkbox" checked={line.taxable} onChange={e => updateLine(idx, 'taxable', e.target.checked)} /> Taxable
                  </label>
                  <span style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
                    ${((parseFloat(line.quantity) || 0) * (parseFloat(line.unit_price) || 0)).toFixed(2)}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Totals */}
          <div className="invoice-totals">
            <div className="total-row"><span>Subtotal</span><span>${subtotal.toFixed(2)}</span></div>
            {companySettings?.tax_label_1 && (
              <div className="total-row"><span>{companySettings.tax_label_1} ({((companySettings.tax_rate_1 || 0) * 100).toFixed(1)}%)</span><span>${tax1.toFixed(2)}</span></div>
            )}
            {companySettings?.tax_label_2 && companySettings?.tax_rate_2 && (
              <div className="total-row"><span>{companySettings.tax_label_2} ({((companySettings.tax_rate_2 || 0) * 100).toFixed(1)}%)</span><span>${tax2.toFixed(2)}</span></div>
            )}
            <div className="total-row total-final"><span>Total</span><span>${total.toFixed(2)}</span></div>
          </div>

          <div className="form-field">
            <label className="form-label">Notes (visible to client)</label>
            <textarea className="form-input" placeholder="Terms, conditions..."
              value={form.notes} onChange={e => updateForm('notes', e.target.value)} />
          </div>

          <button className="btn btn-primary btn-full" onClick={saveQuote}>
            {editing ? 'Update Quote' : 'Create Quote'}
          </button>

          {editing && editing.status !== 'approved' && (
            <button className="btn btn-full" style={{
              marginTop: 8, background: 'rgba(0,212,160,0.1)', border: '1px solid rgba(0,212,160,0.3)',
              color: 'var(--primary)', fontWeight: 800, padding: 13, borderRadius: 12, cursor: 'pointer',
              fontSize: 14, fontFamily: 'DM Sans'
            }} onClick={convertToInvoice}>
              Approve & Convert to Invoice
            </button>
          )}

          {editing && (
            <button className="btn btn-full" style={{
              marginTop: 8, background: 'rgba(33,150,243,0.1)', border: '1px solid rgba(33,150,243,0.3)',
              color: 'var(--blue)', fontWeight: 700, padding: 13, borderRadius: 12, cursor: 'pointer',
              fontSize: 14, fontFamily: 'DM Sans'
            }} onClick={() => { setShowModal(false); setViewPdfId(editing.id) }}>
              🖨 Preview / Print Quote
            </button>
          )}
          <button className="btn btn-secondary btn-full" style={{ marginTop: 8 }} onClick={() => setShowModal(false)}>
            Cancel
          </button>
        </Modal>
      )}

      {viewPdfId && <QuotePDF quoteId={viewPdfId} onClose={() => setViewPdfId(null)} />}
    </div>
  )
}

import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useToast } from '../shared/Toast'
import Modal from '../shared/Modal'
import QuotesList from './QuotesList'
import InvoicePDF from './InvoicePDF'
import { INVOICE_STATUSES, INVOICE_STATUS_LABELS, TAX_PRESETS } from '../../lib/constants'
import '../jobs/Jobs.css'
import './Billing.css'

const STATUS_COLORS = {
  draft: '#3D4A5C', sent: '#2196F3', viewed: '#8B5CF6',
  partial: '#FF6B35', paid: '#00D4A0', overdue: '#FF3B5C', void: '#3D4A5C'
}

export default function BillingScreen({ onNavigate }) {
  const { companyId, profile } = useAuth()
  const showToast = useToast()
  const [invoices, setInvoices] = useState([])
  const [clients, setClients] = useState([])
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [lines, setLines] = useState([])
  const [viewPdfId, setViewPdfId] = useState(null)
  const [billingView, setBillingView] = useState('invoices') // 'invoices' or 'quotes'
  const [tab, setTab] = useState('all') // all, draft, sent, paid, overdue

  const [form, setForm] = useState({
    client_id: '', job_id: '', status: 'draft', issue_date: '',
    due_date: '', notes: '', internal_notes: '', billing_email: '',
    tax_province: '' // '' = use company default
  })
  const [companyProvince, setCompanyProvince] = useState('')
  const [companySettings, setCompanySettings] = useState(null)
  const [qboConnected, setQboConnected] = useState(false)
  const [qboTokens, setQboTokens] = useState(null)
  const [qboSettings, setQboSettings] = useState({})
  const [pushingQbo, setPushingQbo] = useState(false)

  useEffect(() => {
    if (companyId) { loadInvoices(); loadClients(); loadJobs(); loadSettings() }
  }, [companyId])

  async function loadInvoices() {
    const { data } = await supabase
      .from('invoices')
      .select('*, clients(name), jobs(name, job_number)')
      .eq('company_id', companyId)
      .is('archived_at', null)
      .order('created_at', { ascending: false })
    setInvoices(data || [])
    setLoading(false)
  }

  async function loadClients() {
    const { data } = await supabase.from('clients').select('id, name, contact_email, billing_email')
      .eq('company_id', companyId).is('archived_at', null).order('name')
    setClients(data || [])
  }

  async function loadJobs() {
    const { data } = await supabase.from('jobs').select('id, name, job_number, client_id, billing_email, site_province_state')
      .eq('company_id', companyId).is('archived_at', null).order('created_at', { ascending: false })
    setJobs(data || [])
  }

  // Resolve billing email: job override > client billing > client contact
  function resolveBillingEmail(clientId, jobId) {
    const job = jobs.find(j => j.id === jobId)
    if (job?.billing_email) return job.billing_email
    const client = clients.find(c => c.id === clientId)
    return client?.billing_email || client?.contact_email || ''
  }

  async function loadSettings() {
    const { data } = await supabase
      .from('companies')
      .select('settings, qbo_tokens, qbo_settings, province_state, country')
      .eq('id', companyId)
      .single()

    let settings = data?.settings || {}

    // Auto-derive taxes from province if missing OR if it's the wrong default
    // (the old onboarding hardcoded ON/HST 13%; fix it for non-Ontario companies)
    const code = (data?.province_state || '').toUpperCase().slice(0, 2)
    const preset = TAX_PRESETS[code]
    const hasTax = settings.tax_rate_1 != null
    const looksLikeWrongDefault = hasTax &&
      settings.tax_label_1 === 'HST' && settings.tax_rate_1 === 0.13 &&
      code && code !== 'ON' && preset && preset.label1 !== 'HST'

    if ((!hasTax || looksLikeWrongDefault) && preset) {
      settings = {
        ...settings,
        tax_mode: preset.mode,
        tax_label_1: preset.label1,
        tax_rate_1: preset.rate1,
        tax_label_2: preset.label2,
        tax_rate_2: preset.rate2
      }
      // Persist so it stays fixed
      await supabase.from('companies').update({ settings }).eq('id', companyId)
    }

    setCompanySettings(settings)
    setCompanyProvince((data?.province_state || '').toUpperCase().slice(0, 2))
    setQboConnected(!!data?.qbo_tokens?.access_token)
    setQboTokens(data?.qbo_tokens || null)
    setQboSettings(data?.qbo_settings || {})
  }

  // Resolve the tax preset to actually use for this invoice:
  // explicit form.tax_province > job's site province > company province
  function resolveTaxPreset() {
    const job = jobs.find(j => j.id === form.job_id)
    const code = (form.tax_province ||
      (job?.site_province_state || '').toUpperCase().slice(0, 2) ||
      companyProvince)
    return TAX_PRESETS[code] || {
      label1: companySettings?.tax_label_1 || null,
      rate1: companySettings?.tax_rate_1 || 0,
      label2: companySettings?.tax_label_2 || null,
      rate2: companySettings?.tax_rate_2 || null
    }
  }

  async function syncAllPayments() {
    setPushingQbo(true)
    try {
      const res = await fetch('/.netlify/functions/qbo-poll-payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId })
      })
      const data = await res.json()
      if (data.error) {
        showToast('Sync failed: ' + data.error)
      } else {
        showToast(`${data.updated_invoices || 0} invoice(s) updated`)
        loadInvoices()
      }
    } catch (err) {
      showToast('Sync error: ' + err.message)
    }
    setPushingQbo(false)
  }

  async function refreshQboPayment() {
    if (!editing) return
    setPushingQbo(true)
    try {
      const res = await fetch('/.netlify/functions/qbo-poll-payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId, invoice_id: editing.id })
      })
      const data = await res.json()
      if (data.error) {
        showToast('Refresh failed: ' + data.error)
      } else {
        showToast(data.updated_invoices > 0 ? 'Payment status updated' : 'No changes')
        loadInvoices()
        const { data: refreshed } = await supabase.from('invoices').select('*').eq('id', editing.id).single()
        if (refreshed) setEditing(refreshed)
      }
    } catch (err) {
      showToast('Refresh error: ' + err.message)
    }
    setPushingQbo(false)
  }

  async function pushToQbo(sendNow = false) {
    if (!editing) return
    setPushingQbo(true)
    try {
      // Save first if there are unsaved changes
      const res = await fetch('/.netlify/functions/qbo-push-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: companyId,
          invoice_id: editing.id,
          send_now: sendNow
        })
      })
      const data = await res.json()
      if (data.error) {
        showToast('Push failed: ' + data.error)
      } else {
        showToast(
          data.sent
            ? `Sent from QBO to ${data.billing_email}`
            : 'Pushed to QuickBooks as draft'
        )
        loadInvoices()
        // Refresh editing record so the badge appears
        const { data: refreshed } = await supabase.from('invoices').select('*').eq('id', editing.id).single()
        if (refreshed) setEditing(refreshed)
      }
    } catch (err) {
      showToast('Push error: ' + err.message)
    }
    setPushingQbo(false)
  }

  async function loadLines(invoiceId) {
    const { data } = await supabase.from('invoice_lines')
      .select('*').eq('invoice_id', invoiceId).order('sort_order')
    setLines(data || [])
  }

  function openNew() {
    setEditing(null)
    const today = new Date().toISOString().split('T')[0]
    const dueDate = new Date(Date.now() + (companySettings?.default_payment_terms_days || 30) * 86400000)
      .toISOString().split('T')[0]
    setForm({
      client_id: '', job_id: '', status: 'draft',
      issue_date: today, due_date: dueDate, notes: '', internal_notes: '',
      billing_email: '', tax_province: ''
    })
    setLines([{ id: 'new-1', line_type: 'service', description: '', quantity: 1, unit: 'each', unit_price: '', taxable: true }])
    setShowModal(true)
  }

  async function openEdit(invoice) {
    setEditing(invoice)
    setForm({
      client_id: invoice.client_id || '',
      job_id: invoice.job_id || '',
      status: invoice.status || 'draft',
      issue_date: invoice.issue_date || '',
      due_date: invoice.due_date || '',
      notes: invoice.notes || '',
      internal_notes: invoice.internal_notes || '',
      billing_email: invoice.billing_email || '',
      tax_province: invoice.tax_province || ''
    })
    await loadLines(invoice.id)
    setShowModal(true)
  }

  function addLine() {
    setLines(prev => [...prev, {
      id: 'new-' + Date.now(), line_type: 'service', description: '',
      quantity: 1, unit: 'each', unit_price: '', taxable: true
    }])
  }

  function updateLine(idx, field, value) {
    setLines(prev => prev.map((l, i) => i === idx ? { ...l, [field]: value } : l))
  }

  function removeLine(idx) {
    setLines(prev => prev.filter((_, i) => i !== idx))
  }

  function calcTotals() {
    const subtotal = lines.reduce((s, l) => {
      const amt = (parseFloat(l.quantity) || 0) * (parseFloat(l.unit_price) || 0)
      return s + amt
    }, 0)

    const taxableSubtotal = lines.reduce((s, l) => {
      if (!l.taxable) return s
      return s + (parseFloat(l.quantity) || 0) * (parseFloat(l.unit_price) || 0)
    }, 0)

    const preset = resolveTaxPreset()
    const rate1 = preset?.rate1 || 0
    const rate2 = preset?.rate2 || 0
    const tax1 = taxableSubtotal * rate1
    const tax2 = rate2 ? taxableSubtotal * rate2 : 0
    const total = subtotal + tax1 + tax2

    return { subtotal, tax1, tax2, total, preset }
  }

  async function saveInvoice() {
    if (!form.client_id) { showToast('Please select a client'); return }
    if (lines.length === 0 || !lines.some(l => l.description.trim())) {
      showToast('Add at least one line item'); return
    }

    const { subtotal, tax1, tax2, total, preset } = calcTotals()

    const payload = {
      client_id: form.client_id,
      job_id: form.job_id || null,
      status: form.status,
      issue_date: form.issue_date,
      due_date: form.due_date,
      notes: form.notes,
      internal_notes: form.internal_notes,
      billing_email: form.billing_email || resolveBillingEmail(form.client_id, form.job_id) || null,
      tax_province: form.tax_province || null,
      subtotal,
      tax1_label: preset?.label1 || null,
      tax1_rate: preset?.rate1 || 0,
      tax1_amount: tax1,
      tax2_label: preset?.label2 || null,
      tax2_rate: preset?.rate2 || null,
      tax2_amount: tax2 || 0,
      total,
      amount_due: total - (editing?.amount_paid || 0) - (editing?.deposit_amount || 0),
      company_id: companyId,
      updated_at: new Date().toISOString()
    }

    let invoiceId
    let error

    if (editing) {
      invoiceId = editing.id;
      ({ error } = await supabase.from('invoices').update(payload).eq('id', editing.id))
    } else {
      const { data: numData } = await supabase.rpc('generate_invoice_number', { p_company_id: companyId })
      payload.invoice_number = numData || ('INV-' + Date.now());
      const { data: saved, error: insertErr } = await supabase.from('invoices').insert(payload).select().single()
      error = insertErr
      if (saved) invoiceId = saved.id
    }

    if (error) { showToast('Error saving invoice'); console.error(error); return }

    // Save line items
    if (editing) {
      await supabase.from('invoice_lines').delete().eq('invoice_id', invoiceId)
    }

    const linePayloads = lines
      .filter(l => l.description.trim())
      .map((l, i) => ({
        invoice_id: invoiceId,
        company_id: companyId,
        sort_order: i,
        line_type: l.line_type,
        description: l.description.trim(),
        quantity: parseFloat(l.quantity) || 1,
        unit: l.unit,
        unit_price: parseFloat(l.unit_price) || 0,
        amount: (parseFloat(l.quantity) || 1) * (parseFloat(l.unit_price) || 0),
        taxable: l.taxable
      }))

    if (linePayloads.length > 0) {
      const { error: lineErr } = await supabase.from('invoice_lines').insert(linePayloads)
      if (lineErr) { showToast('Error saving line items'); console.error(lineErr); return }
    }

    showToast(editing ? 'Invoice updated' : 'Invoice created')
    setShowModal(false)
    loadInvoices()
  }

  async function archiveInvoice() {
    if (!editing || !confirm('Archive this invoice?')) return
    await supabase.from('invoices').update({ archived_at: new Date().toISOString() }).eq('id', editing.id)
    showToast('Invoice archived')
    setShowModal(false)
    loadInvoices()
  }

  function updateForm(field, value) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  const filteredInvoices = tab === 'all' ? invoices : invoices.filter(i => i.status === tab)

  // Summary
  const collected = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + parseFloat(i.total || 0), 0)
  const pending = invoices.filter(i => ['draft', 'sent', 'viewed'].includes(i.status)).reduce((s, i) => s + parseFloat(i.amount_due || 0), 0)
  const overdue = invoices.filter(i => i.status === 'overdue').reduce((s, i) => s + parseFloat(i.amount_due || 0), 0)

  const { subtotal, tax1, tax2, total } = calcTotals()

  if (loading) return <div className="loading-center"><div className="spinner" /></div>

  // QBO derived stats
  const qboPushed = invoices.filter(i => i.qbo_invoice_id)
  const qboErrors = invoices.filter(i => i.qbo_sync_error)
  const qboUnpushed = invoices.filter(i => !i.qbo_invoice_id && i.status !== 'draft' && i.status !== 'void')
  const lastPushed = qboPushed
    .filter(i => i.qbo_pushed_at)
    .sort((a, b) => new Date(b.qbo_pushed_at) - new Date(a.qbo_pushed_at))[0]
  const recentQboActivity = invoices
    .filter(i => i.qbo_last_synced_at || i.qbo_pushed_at)
    .sort((a, b) =>
      new Date(b.qbo_last_synced_at || b.qbo_pushed_at) -
      new Date(a.qbo_last_synced_at || a.qbo_pushed_at)
    )
    .slice(0, 8)

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Billing</div>
          <div className="page-subtitle">{invoices.length} invoices</div>
        </div>
      </div>

      {/* QuickBooks panel */}
      {qboConnected ? (
        <div style={{ margin: '0 16px 12px', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 16 }}>📊</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 800 }}>QuickBooks Online</div>
                <div style={{ fontSize: 10, color: 'var(--text3)' }}>
                  {qboSettings.environment || 'sandbox'} • Realm {qboTokens?.realm_id?.slice(-6)}
                  {qboSettings.last_customer_sync_at && ` • Customers synced ${new Date(qboSettings.last_customer_sync_at).toLocaleDateString('en-CA')}`}
                </div>
              </div>
            </div>
            <button
              onClick={syncAllPayments}
              disabled={pushingQbo}
              style={{ padding: '6px 12px', borderRadius: 8, background: 'var(--primary)', border: 'none', color: '#000', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'DM Sans' }}
            >
              {pushingQbo ? '⏳' : '↻ Sync payments'}
            </button>
          </div>

          {/* Stats grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 10 }}>
            <div style={{ background: 'var(--bg2)', borderRadius: 10, padding: '10px 8px', textAlign: 'center' }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--primary)' }}>{qboPushed.length}</div>
              <div style={{ fontSize: 9, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 }}>Synced</div>
            </div>
            <div style={{ background: 'var(--bg2)', borderRadius: 10, padding: '10px 8px', textAlign: 'center' }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--yellow)' }}>{qboUnpushed.length}</div>
              <div style={{ fontSize: 9, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 }}>Unpushed</div>
            </div>
            <div style={{ background: 'var(--bg2)', borderRadius: 10, padding: '10px 8px', textAlign: 'center' }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: qboErrors.length ? 'var(--red)' : 'var(--text3)' }}>{qboErrors.length}</div>
              <div style={{ fontSize: 9, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 }}>Errors</div>
            </div>
            <div style={{ background: 'var(--bg2)', borderRadius: 10, padding: '10px 8px', textAlign: 'center' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text2)' }}>
                {lastPushed ? new Date(lastPushed.qbo_pushed_at).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }) : '—'}
              </div>
              <div style={{ fontSize: 9, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 }}>Last push</div>
            </div>
          </div>

          {/* Recent activity */}
          {recentQboActivity.length > 0 && (
            <div>
              <div style={{ fontSize: 9, fontWeight: 800, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
                Recent QuickBooks Activity
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 200, overflowY: 'auto' }}>
                {recentQboActivity.map(inv => {
                  const ts = inv.qbo_last_synced_at || inv.qbo_pushed_at
                  let action = '📤 Pushed'
                  let color = 'var(--primary)'
                  if (inv.qbo_sync_error) { action = '⚠ Error'; color = 'var(--red)' }
                  else if (inv.status === 'paid') { action = '💰 Paid'; color = 'var(--green)' }
                  else if (inv.status === 'partial') { action = '◑ Partial'; color = 'var(--yellow)' }
                  else if (inv.qbo_last_synced_at && inv.qbo_last_synced_at !== inv.qbo_pushed_at) { action = '↻ Synced'; color = 'var(--blue)' }
                  return (
                    <div
                      key={inv.id}
                      onClick={() => openEdit(inv)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '8px 10px', background: 'var(--bg2)', borderRadius: 8,
                        cursor: 'pointer', fontSize: 11
                      }}
                    >
                      <span style={{ color, fontWeight: 700, minWidth: 70 }}>{action}</span>
                      <span style={{ color: 'var(--text2)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <strong>{inv.invoice_number}</strong> · {inv.clients?.name || 'No client'} · ${parseFloat(inv.total || 0).toFixed(2)}
                      </span>
                      <span style={{ color: 'var(--text3)', fontSize: 10 }}>
                        {ts ? new Date(ts).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Errors callout */}
          {qboErrors.length > 0 && (
            <div style={{ marginTop: 8, padding: 10, background: 'rgba(255,59,92,0.06)', border: '1px solid rgba(255,59,92,0.2)', borderRadius: 8, fontSize: 11, color: 'var(--red)' }}>
              ⚠ {qboErrors.length} invoice{qboErrors.length > 1 ? 's' : ''} with sync errors. Open them to see details and re-push.
            </div>
          )}
        </div>
      ) : (
        <div style={{ margin: '0 16px 12px', padding: 12, background: 'var(--card)', border: '1px dashed var(--border)', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 18 }}>📊</span>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700 }}>QuickBooks not connected</div>
              <div style={{ fontSize: 10, color: 'var(--text3)' }}>Push invoices and sync payments automatically</div>
            </div>
          </div>
          <button
            onClick={() => onNavigate ? onNavigate('profile') : null}
            style={{ padding: '6px 12px', borderRadius: 6, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text2)', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'DM Sans' }}
          >
            Connect →
          </button>
        </div>
      )}

      {/* Quotes / Invoices Toggle */}
      <div className="view-toggle" style={{ margin: '0 16px 8px' }}>
        <button className={`view-toggle-btn ${billingView === 'invoices' ? 'active' : ''}`}
          onClick={() => setBillingView('invoices')}>Invoices</button>
        <button className={`view-toggle-btn ${billingView === 'quotes' ? 'active' : ''}`}
          onClick={() => setBillingView('quotes')}>Quotes</button>
      </div>

      {billingView === 'quotes' ? (
        <QuotesList onConvert={() => { setBillingView('invoices'); loadInvoices() }} />
      ) : (<>

      {/* Summary */}
      <div className="billing-summary">
        <div className="billing-stat-row">
          <div className="billing-stat-item">
            <div className="billing-stat-val" style={{ color: 'var(--green)' }}>${collected.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            <div className="billing-stat-lbl">Collected</div>
          </div>
          <div className="billing-stat-item">
            <div className="billing-stat-val" style={{ color: 'var(--yellow)' }}>${pending.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            <div className="billing-stat-lbl">Pending</div>
          </div>
          <div className="billing-stat-item">
            <div className="billing-stat-val" style={{ color: 'var(--red)' }}>${overdue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
            <div className="billing-stat-lbl">Overdue</div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="billing-tabs">
        {['all', 'draft', 'sent', 'paid', 'overdue'].map(t => (
          <div key={t} className={`billing-tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
            {t === 'all' ? 'All' : INVOICE_STATUS_LABELS[t]}
          </div>
        ))}
      </div>

      {/* Invoice List */}
      <div className="sec">
        {filteredInvoices.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">📄</div>
            <div className="empty-title">No invoices</div>
            <div className="empty-sub">Tap + to create your first invoice</div>
          </div>
        ) : (
          filteredInvoices.map(inv => (
            <div key={inv.id} className="card" onClick={() => openEdit(inv)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>{inv.clients?.name || 'No client'}</div>
                  <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>
                    {inv.invoice_number} {inv.jobs ? '· ' + inv.jobs.name : ''}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 18, fontWeight: 800 }}>
                    ${parseFloat(inv.total || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
                    Due {inv.due_date || '—'}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span className="badge" style={{ background: STATUS_COLORS[inv.status] + '18', color: STATUS_COLORS[inv.status] }}>
                    {INVOICE_STATUS_LABELS[inv.status]}
                  </span>
                  {inv.qbo_invoice_id && (
                    <span className="badge" style={{ background: 'rgba(0,212,160,0.12)', color: 'var(--primary)', fontSize: 9 }}>QBO</span>
                  )}
                  {inv.qbo_sync_error && (
                    <span className="badge" style={{ background: 'rgba(255,59,92,0.12)', color: 'var(--red)', fontSize: 9 }}>QBO ERR</span>
                  )}
                </div>
                {inv.amount_due > 0 && inv.status !== 'paid' && (
                  <span style={{ fontSize: 12, color: 'var(--text2)' }}>
                    Due: ${parseFloat(inv.amount_due).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      </>)}

      {billingView !== 'quotes' && <button className="fab" onClick={openNew}>+</button>}

      {/* Invoice Modal */}
      {showModal && (
        <Modal title={editing ? `Edit ${editing.invoice_number}` : 'New Invoice'} onClose={() => setShowModal(false)}>
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
              <input className="form-input" type="date" value={form.issue_date}
                onChange={e => updateForm('issue_date', e.target.value)} />
            </div>
            <div className="form-field">
              <label className="form-label">Due Date</label>
              <input className="form-input" type="date" value={form.due_date}
                onChange={e => updateForm('due_date', e.target.value)} />
            </div>
          </div>

          <div className="form-row">
            <div className="form-field">
              <label className="form-label">Status</label>
              <select className="form-input" value={form.status} onChange={e => updateForm('status', e.target.value)}>
                {INVOICE_STATUSES.map(s => <option key={s} value={s}>{INVOICE_STATUS_LABELS[s]}</option>)}
              </select>
            </div>
            <div className="form-field">
              <label className="form-label">
                Tax region
                <span style={{ color: 'var(--text3)', fontWeight: 400, marginLeft: 6 }}>
                  (where the work is performed)
                </span>
              </label>
              <select className="form-input" value={form.tax_province} onChange={e => updateForm('tax_province', e.target.value)}>
                <option value="">
                  Auto — {(() => {
                    const job = jobs.find(j => j.id === form.job_id)
                    const autoCode = (job?.site_province_state || '').toUpperCase().slice(0, 2) || companyProvince
                    const p = TAX_PRESETS[autoCode]
                    return p
                      ? `${autoCode} (${p.label1} ${(p.rate1 * 100).toFixed(2)}%${p.label2 ? ' + ' + p.label2 + ' ' + (p.rate2 * 100).toFixed(3) + '%' : ''})`
                      : 'company default'
                  })()}
                </option>
                <option value="ON">Ontario — HST 13%</option>
                <option value="QC">Quebec — GST 5% + QST 9.975%</option>
                <option value="BC">BC — GST 5% + PST 7%</option>
                <option value="AB">Alberta — GST 5%</option>
                <option value="SK">Saskatchewan — GST 5% + PST 6%</option>
                <option value="MB">Manitoba — GST 5% + PST 7%</option>
                <option value="NB">New Brunswick — HST 15%</option>
                <option value="NS">Nova Scotia — HST 15%</option>
                <option value="PE">PEI — HST 15%</option>
                <option value="NL">Newfoundland — HST 15%</option>
              </select>
            </div>
          </div>

          {/* Billing email — resolves from job > client > contact, but can be overridden here */}
          <div className="form-field">
            <label className="form-label">
              Billing Email
              <span style={{ color: 'var(--text3)', fontWeight: 400, marginLeft: 6 }}>
                (where this invoice gets sent — auto-filled from job/client)
              </span>
            </label>
            <input
              className="form-input"
              type="email"
              placeholder={resolveBillingEmail(form.client_id, form.job_id) || 'billing@client.com'}
              value={form.billing_email}
              onChange={e => updateForm('billing_email', e.target.value)}
            />
            {!form.billing_email && resolveBillingEmail(form.client_id, form.job_id) && (
              <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 4 }}>
                Will use: <strong>{resolveBillingEmail(form.client_id, form.job_id)}</strong>
              </div>
            )}
          </div>

          {/* Line Items */}
          <div style={{ marginTop: 16, marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <label className="form-label" style={{ margin: 0 }}>LINE ITEMS</label>
              <button className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: 12 }} onClick={addLine}>
                + Add Line
              </button>
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
                  <button style={{
                    background: 'none', border: 'none', color: 'var(--red)',
                    cursor: 'pointer', fontSize: 18, padding: '0 4px', alignSelf: 'center'
                  }} onClick={() => removeLine(idx)}>×</button>
                </div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 12, paddingLeft: 4 }}>
                  <select style={{
                    background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8,
                    padding: '4px 8px', fontSize: 11, color: 'var(--text2)', outline: 'none'
                  }} value={line.line_type} onChange={e => updateLine(idx, 'line_type', e.target.value)}>
                    <option value="service">Service</option>
                    <option value="material">Material</option>
                    <option value="equipment">Equipment</option>
                    <option value="expense">Expense</option>
                    <option value="discount">Discount</option>
                  </select>
                  <select style={{
                    background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8,
                    padding: '4px 8px', fontSize: 11, color: 'var(--text2)', outline: 'none'
                  }} value={line.unit} onChange={e => updateLine(idx, 'unit', e.target.value)}>
                    <option value="each">Each</option>
                    <option value="hour">Hour</option>
                    <option value="sqft">Sq Ft</option>
                    <option value="lnft">Ln Ft</option>
                    <option value="day">Day</option>
                  </select>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text2)', cursor: 'pointer' }}>
                    <input type="checkbox" checked={line.taxable} onChange={e => updateLine(idx, 'taxable', e.target.checked)} />
                    Taxable
                  </label>
                  <span style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
                    ${((parseFloat(line.quantity) || 0) * (parseFloat(line.unit_price) || 0)).toFixed(2)}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Totals */}
          {(() => {
            const preset = resolveTaxPreset()
            return (
          <div className="invoice-totals">
            <div className="total-row">
              <span>Subtotal</span>
              <span>${subtotal.toFixed(2)}</span>
            </div>
            {preset?.label1 && (
              <div className="total-row">
                <span>{preset.label1} ({((preset.rate1 || 0) * 100).toFixed(preset.rate1 >= 0.1 ? 1 : 3)}%)</span>
                <span>${tax1.toFixed(2)}</span>
              </div>
            )}
            {preset?.label2 && preset?.rate2 && (
              <div className="total-row">
                <span>{preset.label2} ({((preset.rate2 || 0) * 100).toFixed(3)}%)</span>
                <span>${tax2.toFixed(2)}</span>
              </div>
            )}
            <div className="total-row total-final">
              <span>Total</span>
              <span>${total.toFixed(2)}</span>
            </div>
          </div>
            )
          })()}

          <div className="form-field">
            <label className="form-label">Notes (visible to client)</label>
            <textarea className="form-input" placeholder="Payment terms, thank you note..."
              value={form.notes} onChange={e => updateForm('notes', e.target.value)} />
          </div>

          <button className="btn btn-primary btn-full" onClick={saveInvoice}>
            {editing ? 'Update Invoice' : 'Create Invoice'}
          </button>
          {editing && (
            <button className="btn btn-danger btn-full" style={{ marginTop: 8 }} onClick={archiveInvoice}>
              Archive Invoice
            </button>
          )}
          {editing && (
            <button className="btn btn-full" style={{
              marginTop: 8, background: 'rgba(33,150,243,0.1)', border: '1px solid rgba(33,150,243,0.3)',
              color: 'var(--blue)', fontWeight: 700, padding: 13, borderRadius: 12, cursor: 'pointer',
              fontSize: 14, fontFamily: 'DM Sans'
            }} onClick={() => { setShowModal(false); setViewPdfId(editing.id) }}>
              🖨 Preview / Print Invoice
            </button>
          )}

          {/* QuickBooks push */}
          {editing && qboConnected && (
            <div style={{ marginTop: 12, padding: 12, background: 'var(--bg2)', borderRadius: 12, border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
                📊 QuickBooks
              </div>
              {editing.qbo_invoice_id ? (
                <div style={{ fontSize: 12, color: 'var(--primary)', marginBottom: 8 }}>
                  ✓ Synced — QBO #{editing.qbo_invoice_id}
                  {editing.qbo_pushed_at && <span style={{ color: 'var(--text3)', marginLeft: 6 }}>({new Date(editing.qbo_pushed_at).toLocaleDateString('en-CA')})</span>}
                </div>
              ) : (
                <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 8 }}>
                  Not yet pushed to QuickBooks
                </div>
              )}
              {editing.qbo_sync_error && (
                <div style={{ fontSize: 11, color: 'var(--red)', marginBottom: 8, padding: 8, background: 'rgba(255,59,92,0.08)', borderRadius: 6 }}>
                  ⚠ {editing.qbo_sync_error}
                </div>
              )}
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  onClick={() => pushToQbo(false)}
                  disabled={pushingQbo}
                  style={{ flex: 1, padding: '10px 12px', borderRadius: 8, background: 'var(--primary)', border: 'none', color: '#000', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'DM Sans' }}
                >
                  {pushingQbo ? '⏳' : (editing.qbo_invoice_id ? '🔄 Re-push' : '📤 Push as Draft')}
                </button>
                <button
                  onClick={() => pushToQbo(true)}
                  disabled={pushingQbo}
                  style={{ flex: 1, padding: '10px 12px', borderRadius: 8, background: 'rgba(33,150,243,0.1)', border: '1px solid rgba(33,150,243,0.3)', color: 'var(--blue)', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'DM Sans' }}
                >
                  {pushingQbo ? '⏳' : '📧 Push & Send'}
                </button>
              </div>
              {editing.qbo_invoice_id && (
                <button
                  onClick={refreshQboPayment}
                  disabled={pushingQbo}
                  style={{ width: '100%', marginTop: 6, padding: '8px', borderRadius: 8, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text3)', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'DM Sans' }}
                >
                  {pushingQbo ? '⏳' : '↻ Check payment status now'}
                </button>
              )}
              <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 6 }}>
                Push as Draft = lands in QBO for review. Push & Send = QBO emails the invoice immediately. Payments auto-sync every 15 minutes.
              </div>
            </div>
          )}
          {editing && !qboConnected && (
            <div style={{ marginTop: 12, padding: 10, background: 'var(--bg2)', borderRadius: 8, fontSize: 11, color: 'var(--text3)' }}>
              💡 Connect QuickBooks in Settings to push invoices
            </div>
          )}
          <button className="btn btn-secondary btn-full" style={{ marginTop: 8 }} onClick={() => setShowModal(false)}>
            Cancel
          </button>
        </Modal>
      )}

      {viewPdfId && <InvoicePDF invoiceId={viewPdfId} onClose={() => setViewPdfId(null)} />}
    </div>
  )
}

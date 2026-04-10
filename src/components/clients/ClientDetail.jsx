import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useToast } from '../shared/Toast'
import Modal from '../shared/Modal'
import { STAGE_LABELS, STAGE_COLORS } from '../../lib/constants'

export default function ClientDetail({ clientId, onBack, onOpenJob }) {
  const { companyId } = useAuth()
  const showToast = useToast()
  const [client, setClient] = useState(null)
  const [jobs, setJobs] = useState([])
  const [invoices, setInvoices] = useState([])
  const [quotes, setQuotes] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('jobs')
  const [showEditModal, setShowEditModal] = useState(false)
  const [editForm, setEditForm] = useState({})

  useEffect(() => { if (clientId) loadAll() }, [clientId])

  async function loadAll() {
    const [clientRes, jobsRes, invRes, quoteRes] = await Promise.all([
      supabase.from('clients').select('*').eq('id', clientId).single(),
      supabase.from('jobs').select('*').eq('client_id', clientId).is('archived_at', null).order('created_at', { ascending: false }),
      supabase.from('invoices').select('*').eq('client_id', clientId).is('archived_at', null).order('created_at', { ascending: false }),
      supabase.from('quotes').select('*').eq('client_id', clientId).order('created_at', { ascending: false })
    ])
    setClient(clientRes.data)
    setJobs(jobsRes.data || [])
    setInvoices(invRes.data || [])
    setQuotes(quoteRes.data || [])
    setLoading(false)
  }

  function openEditClient() {
    setEditForm({
      name: client.name || '', type: client.type || 'commercial',
      contact_name: client.contact_name || '', contact_email: client.contact_email || '',
      contact_phone: client.contact_phone || '',
      billing_email: client.billing_email || '',
      billing_address_line1: client.billing_address_line1 || '',
      billing_city: client.billing_city || '',
      billing_province_state: client.billing_province_state || '',
      billing_postal_zip: client.billing_postal_zip || '',
      notes: client.notes || ''
    })
    setShowEditModal(true)
  }

  async function saveEditClient() {
    if (!editForm.name.trim()) { showToast('Client name required'); return }
    const { error } = await supabase.from('clients').update({
      ...editForm, updated_at: new Date().toISOString()
    }).eq('id', clientId)
    if (error) { showToast('Error saving'); console.error(error); return }
    showToast('Client updated')
    setShowEditModal(false)
    loadAll()
  }

  function updateEdit(f, v) { setEditForm(prev => ({ ...prev, [f]: v })) }

  async function generatePortalLink() {
    let token = client.portal_token
    if (!token) {
      token = crypto.randomUUID().replace(/-/g, '').slice(0, 20)
      await supabase.from('clients').update({ portal_token: token, portal_enabled: true }).eq('id', clientId)
      client.portal_token = token
    }
    const link = `${window.location.origin}/portal/${token}`
    navigator.clipboard.writeText(link).then(() => showToast('Portal link copied!'))
  }

  if (loading) return <div className="loading-center"><div className="spinner" /></div>
  if (!client) return <div className="empty-state"><div className="empty-title">Client not found</div></div>

  const totalRevenue = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + parseFloat(i.total || 0), 0)
  const outstanding = invoices.filter(i => ['sent', 'overdue', 'partial'].includes(i.status)).reduce((s, i) => s + parseFloat(i.amount_due || 0), 0)
  const activeJobs = jobs.filter(j => ['lead', 'quoted', 'active'].includes(j.stage)).length

  const tabs = [
    { id: 'jobs', label: `Jobs (${jobs.length})` },
    { id: 'invoices', label: `Invoices (${invoices.length})` },
    { id: 'quotes', label: `Quotes (${quotes.length})` },
    { id: 'info', label: 'Info' },
  ]

  return (
    <div>
      {/* Header */}
      <div style={{ padding: '16px 16px 0', display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={onBack} style={{
          background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10,
          width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', fontSize: 18, color: 'var(--text2)'
        }}>←</button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1 }}>
          <div style={{
            width: 48, height: 48, borderRadius: 15,
            background: 'linear-gradient(135deg, var(--primary), var(--primary2))',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 20, fontWeight: 800, color: '#000', flexShrink: 0
          }}>{client.name.charAt(0).toUpperCase()}</div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800 }}>{client.name}</div>
            {client.contact_name && <div style={{ fontSize: 12, color: 'var(--text2)' }}>{client.contact_name}</div>}
          </div>
        </div>
        <button onClick={openEditClient} style={{
          background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10,
          width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', fontSize: 16, color: 'var(--text2)'
        }}>✏️</button>
        <span className={`badge ${client.type === 'insurance' ? 'purple' : 'green'}`}>
          {client.type.toUpperCase()}
        </span>
      </div>

      {/* Quick Stats */}
      <div style={{ display: 'flex', gap: 8, padding: '12px 16px' }}>
        <div style={{ flex: 1, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 12, textAlign: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--primary)' }}>${totalRevenue.toLocaleString()}</div>
          <div style={{ fontSize: 9, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 }}>Revenue</div>
        </div>
        <div style={{ flex: 1, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 12, textAlign: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: outstanding > 0 ? 'var(--yellow)' : 'var(--green)' }}>${outstanding.toLocaleString()}</div>
          <div style={{ fontSize: 9, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 }}>Outstanding</div>
        </div>
        <div style={{ flex: 1, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 12, textAlign: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--blue)' }}>{activeJobs}</div>
          <div style={{ fontSize: 9, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 }}>Active Jobs</div>
        </div>
      </div>

      {/* Contact Actions */}
      {(client.contact_phone || client.contact_email) && (
        <div style={{ display: 'flex', gap: 8, padding: '0 16px 8px' }}>
          {client.contact_phone && (
            <a href={`tel:${client.contact_phone}`} className="btn btn-secondary" style={{ flex: 1, textDecoration: 'none' }}>
              📞 Call
            </a>
          )}
          {client.contact_email && (
            <a href={`mailto:${client.contact_email}`} className="btn btn-secondary" style={{ flex: 1, textDecoration: 'none' }}>
              ✉️ Email
            </a>
          )}
          {client.contact_phone && (
            <a href={`https://wa.me/${client.contact_phone.replace(/[^0-9]/g, '')}`} target="_blank" rel="noopener"
              className="btn btn-secondary" style={{ flex: 1, textDecoration: 'none', background: 'rgba(37,211,102,0.08)', borderColor: 'rgba(37,211,102,0.2)', color: '#25D366' }}>
              💬 WhatsApp
            </a>
          )}
        </div>
      )}

      {/* Portal Link */}
      <div style={{ padding: '0 16px 8px' }}>
        <button onClick={() => generatePortalLink()} style={{
          width: '100%', padding: 12, borderRadius: 12,
          background: 'rgba(0,212,160,0.06)', border: '1px solid rgba(0,212,160,0.15)',
          cursor: 'pointer', fontSize: 12, fontWeight: 700, color: 'var(--primary)',
          fontFamily: 'DM Sans', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6
        }}>
          🔗 {client.portal_token ? 'Copy Portal Link' : 'Generate Client Portal Link'}
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 6, padding: '4px 16px', overflowX: 'auto', scrollbarWidth: 'none' }}>
        {tabs.map(t => (
          <div key={t.id} onClick={() => setTab(t.id)} style={{
            padding: '6px 12px', borderRadius: 10, fontSize: 11, fontWeight: 700,
            cursor: 'pointer', whiteSpace: 'nowrap',
            border: `1px solid ${tab === t.id ? 'rgba(0,212,160,0.3)' : 'var(--border)'}`,
            background: tab === t.id ? 'rgba(0,212,160,0.1)' : 'var(--card)',
            color: tab === t.id ? 'var(--primary)' : 'var(--text2)'
          }}>{t.label}</div>
        ))}
      </div>

      <div className="sec" style={{ marginTop: 4 }}>
        {/* JOBS */}
        {tab === 'jobs' && (
          jobs.length === 0 ? (
            <div style={{ color: 'var(--text3)', fontSize: 13, padding: 16, textAlign: 'center' }}>No jobs for this client</div>
          ) : jobs.map(j => (
            <div key={j.id} className="card" onClick={() => onOpenJob && onOpenJob(j.id)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>{j.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>{j.job_number} {j.site_address ? '· ' + j.site_address : ''}</div>
                </div>
                <span className="badge" style={{ background: STAGE_COLORS[j.stage] + '18', color: STAGE_COLORS[j.stage] }}>
                  {STAGE_LABELS[j.stage]}
                </span>
              </div>
              {j.estimated_value && (
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--primary)', marginTop: 6 }}>
                  ${parseFloat(j.estimated_value).toLocaleString()}
                </div>
              )}
            </div>
          ))
        )}

        {/* INVOICES */}
        {tab === 'invoices' && (
          invoices.length === 0 ? (
            <div style={{ color: 'var(--text3)', fontSize: 13, padding: 16, textAlign: 'center' }}>No invoices for this client</div>
          ) : invoices.map(inv => (
            <div key={inv.id} className="card" style={{ cursor: 'default' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>{inv.invoice_number}</div>
                  <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>Due {inv.due_date || '—'}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 16, fontWeight: 800 }}>${parseFloat(inv.total || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                  <span className="badge" style={{
                    background: (inv.status === 'paid' ? 'var(--green)' : inv.status === 'overdue' ? 'var(--red)' : 'var(--blue)') + '18',
                    color: inv.status === 'paid' ? 'var(--green)' : inv.status === 'overdue' ? 'var(--red)' : 'var(--blue)',
                    marginTop: 4, display: 'inline-flex'
                  }}>{inv.status.toUpperCase()}</span>
                </div>
              </div>
            </div>
          ))
        )}

        {/* QUOTES */}
        {tab === 'quotes' && (
          quotes.length === 0 ? (
            <div style={{ color: 'var(--text3)', fontSize: 13, padding: 16, textAlign: 'center' }}>No quotes for this client</div>
          ) : quotes.map(q => (
            <div key={q.id} className="card" style={{ cursor: 'default' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>{q.quote_number}</div>
                  <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>{q.issue_date}</div>
                </div>
                <div style={{ fontSize: 16, fontWeight: 800 }}>${parseFloat(q.total || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
              </div>
            </div>
          ))
        )}

        {/* INFO */}
        {tab === 'info' && (
          <div>
            {client.billing_address_line1 && (
              <div className="card" style={{ cursor: 'default' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 }}>Billing Address</div>
                <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.6 }}>
                  {client.billing_address_line1}<br />
                  {client.billing_city}{client.billing_province_state ? ', ' + client.billing_province_state : ''} {client.billing_postal_zip}
                </div>
              </div>
            )}
            {client.notes && (
              <div className="card" style={{ cursor: 'default' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 }}>Notes</div>
                <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{client.notes}</div>
              </div>
            )}
            <div className="card" style={{ cursor: 'default' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 }}>Since</div>
              <div style={{ fontSize: 13, color: 'var(--text2)' }}>
                {new Date(client.created_at).toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Edit Client Modal */}
      {showEditModal && (
        <Modal title="Edit Client" onClose={() => setShowEditModal(false)}>
          <div className="form-field">
            <label className="form-label">Client Name *</label>
            <input className="form-input" value={editForm.name} onChange={e => updateEdit('name', e.target.value)} />
          </div>
          <div className="form-field">
            <label className="form-label">Type</label>
            <select className="form-input" value={editForm.type} onChange={e => updateEdit('type', e.target.value)}>
              <option value="commercial">Commercial</option>
              <option value="residential">Residential</option>
              <option value="insurance">Insurance</option>
              <option value="government">Government</option>
            </select>
          </div>
          <div className="form-row">
            <div className="form-field">
              <label className="form-label">Contact Name</label>
              <input className="form-input" value={editForm.contact_name} onChange={e => updateEdit('contact_name', e.target.value)} />
            </div>
            <div className="form-field">
              <label className="form-label">Phone</label>
              <input className="form-input" value={editForm.contact_phone} onChange={e => updateEdit('contact_phone', e.target.value)} />
            </div>
          </div>
          <div className="form-field">
            <label className="form-label">Email</label>
            <input className="form-input" value={editForm.contact_email} onChange={e => updateEdit('contact_email', e.target.value)} />
          </div>
          <div className="form-field">
            <label className="form-label">Billing Email <span style={{ color: 'var(--text3)', fontWeight: 400 }}>(where invoices are sent — defaults to contact email if blank)</span></label>
            <input className="form-input" type="email" placeholder="billing@client.com" value={editForm.billing_email} onChange={e => updateEdit('billing_email', e.target.value)} />
          </div>
          <div className="form-field">
            <label className="form-label">Address</label>
            <input className="form-input" value={editForm.billing_address_line1} onChange={e => updateEdit('billing_address_line1', e.target.value)} />
          </div>
          <div className="form-row">
            <div className="form-field">
              <label className="form-label">City</label>
              <input className="form-input" value={editForm.billing_city} onChange={e => updateEdit('billing_city', e.target.value)} />
            </div>
            <div className="form-field">
              <label className="form-label">Province</label>
              <input className="form-input" value={editForm.billing_province_state} onChange={e => updateEdit('billing_province_state', e.target.value)} />
            </div>
          </div>
          <div className="form-field">
            <label className="form-label">Notes</label>
            <textarea className="form-input" value={editForm.notes} onChange={e => updateEdit('notes', e.target.value)} />
          </div>
          <button className="btn btn-primary btn-full" onClick={saveEditClient}>Update Client</button>
          <button className="btn btn-secondary btn-full" style={{ marginTop: 8 }} onClick={() => setShowEditModal(false)}>Cancel</button>
        </Modal>
      )}
    </div>
  )
}

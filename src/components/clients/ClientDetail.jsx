import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useToast } from '../shared/Toast'
import Modal from '../shared/Modal'
import { STAGE_LABELS, STAGE_COLORS } from '../../lib/constants'

export default function ClientDetail({ clientId, onBack, onOpenJob }) {
  const { companyId, profile } = useAuth()
  const showToast = useToast()
  const [client, setClient] = useState(null)
  const [jobs, setJobs] = useState([])
  const [invoices, setInvoices] = useState([])
  const [quotes, setQuotes] = useState([])
  const [contacts, setContacts] = useState([])
  const [managedProperties, setManagedProperties] = useState([]) // buildings this client manages
  const [manager, setManager] = useState(null) // if this client is managed by another
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('jobs')
  const [showEditModal, setShowEditModal] = useState(false)
  const [editForm, setEditForm] = useState({})
  // Contact modal state
  const [showContactModal, setShowContactModal] = useState(false)
  const [editingContact, setEditingContact] = useState(null)
  const [contactForm, setContactForm] = useState({
    name: '', title: '', email: '', phone: '',
    is_primary: false, receives_invoices: false, employer_client_id: ''
  })
  const [allClients, setAllClients] = useState([]) // for managed-by + employer dropdowns

  useEffect(() => { if (clientId) loadAll() }, [clientId])

  async function loadAll() {
    const [clientRes, jobsRes, invRes, quoteRes, contactsRes, allClientsRes] = await Promise.all([
      supabase.from('clients').select('*').eq('id', clientId).single(),
      supabase.from('jobs').select('*').eq('client_id', clientId).is('archived_at', null).order('created_at', { ascending: false }),
      supabase.from('invoices').select('*').eq('client_id', clientId).is('archived_at', null).order('created_at', { ascending: false }),
      supabase.from('quotes').select('*').eq('client_id', clientId).order('created_at', { ascending: false }),
      supabase.from('contacts')
        .select('id, name, title, email, phone, is_primary, receives_invoices, employer_client_id, archived_at')
        .eq('client_id', clientId)
        .is('archived_at', null)
        .order('is_primary', { ascending: false })
        .order('name', { ascending: true }),
      supabase.from('clients').select('id, name').eq('company_id', companyId).is('archived_at', null).order('name')
    ])
    setClient(clientRes.data)
    setJobs(jobsRes.data || [])
    setInvoices(invRes.data || [])
    setQuotes(quoteRes.data || [])
    setContacts(contactsRes.data || [])
    setAllClients(allClientsRes.data || [])

    // Properties this client manages (other clients pointing to this one as managed_by_client_id)
    const { data: managed } = await supabase
      .from('clients')
      .select('id, name, billing_city')
      .eq('company_id', companyId)
      .eq('managed_by_client_id', clientId)
      .is('archived_at', null)
      .order('name')
    setManagedProperties(managed || [])

    // If this client is managed by another, fetch the manager
    if (clientRes.data?.managed_by_client_id) {
      const { data: mgr } = await supabase
        .from('clients')
        .select('id, name')
        .eq('id', clientRes.data.managed_by_client_id)
        .single()
      setManager(mgr)
    } else {
      setManager(null)
    }

    setLoading(false)
  }

  // ─── Contact handlers ───────────────────────────
  function openNewContact() {
    setEditingContact(null)
    setContactForm({
      name: '', title: '', email: '', phone: '',
      is_primary: contacts.length === 0,
      receives_invoices: false,
      employer_client_id: ''
    })
    setShowContactModal(true)
  }

  function openEditContact(c) {
    setEditingContact(c)
    setContactForm({
      name: c.name || '',
      title: c.title || '',
      email: c.email || '',
      phone: c.phone || '',
      is_primary: !!c.is_primary,
      receives_invoices: !!c.receives_invoices,
      employer_client_id: c.employer_client_id || ''
    })
    setShowContactModal(true)
  }

  async function saveContact() {
    if (!contactForm.name.trim()) { showToast('Contact name required'); return }
    const payload = {
      company_id: companyId,
      client_id: clientId,
      name: contactForm.name.trim(),
      title: contactForm.title?.trim() || null,
      email: contactForm.email?.trim() || null,
      phone: contactForm.phone?.trim() || null,
      is_primary: !!contactForm.is_primary,
      receives_invoices: !!contactForm.receives_invoices,
      employer_client_id: contactForm.employer_client_id || null
    }

    // If setting this one as primary, unset any other primary first (partial unique index would error otherwise)
    if (payload.is_primary) {
      await supabase.from('contacts')
        .update({ is_primary: false })
        .eq('client_id', clientId)
        .eq('is_primary', true)
    }

    let error
    if (editingContact) {
      ({ error } = await supabase.from('contacts').update(payload).eq('id', editingContact.id))
    } else {
      ({ error } = await supabase.from('contacts').insert(payload))
    }

    if (error) { showToast('Error saving contact: ' + error.message); return }
    showToast(editingContact ? 'Contact updated' : 'Contact added')
    setShowContactModal(false)
    loadAll()
  }

  async function archiveContact(contactId) {
    if (!confirm('Remove this contact?')) return
    await supabase.from('contacts')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', contactId)
    showToast('Contact removed')
    loadAll()
  }

  async function setPrimaryContact(contactId) {
    // Clear existing primary + set new one in two calls to dodge the unique index
    await supabase.from('contacts')
      .update({ is_primary: false })
      .eq('client_id', clientId)
      .eq('is_primary', true)
    await supabase.from('contacts')
      .update({ is_primary: true })
      .eq('id', contactId)
    showToast('Primary contact updated')
    loadAll()
  }

  function updateContactForm(f, v) { setContactForm(prev => ({ ...prev, [f]: v })) }

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
    { id: 'contacts', label: `Contacts (${contacts.length})` },
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

        {/* CONTACTS */}
        {tab === 'contacts' && (
          <div>
            {contacts.length === 0 ? (
              <div style={{ color: 'var(--text3)', fontSize: 13, padding: 16, textAlign: 'center' }}>
                No contacts yet
              </div>
            ) : contacts.map(c => {
              const employer = c.employer_client_id ? allClients.find(cl => cl.id === c.employer_client_id) : null
              return (
                <div key={c.id} className="card" style={{ cursor: 'default' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 3 }}>
                        <span style={{ fontSize: 14, fontWeight: 700 }}>{c.name}</span>
                        {c.is_primary && <span style={{ fontSize: 10, color: 'var(--yellow)', fontWeight: 800 }}>★ PRIMARY</span>}
                        {c.receives_invoices && <span className="badge green" style={{ fontSize: 9 }}>BILLING CC</span>}
                      </div>
                      {c.title && <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 3 }}>{c.title}{employer ? ` · ${employer.name}` : ''}</div>}
                      {c.email && <div style={{ fontSize: 12, color: 'var(--text2)' }}>✉️ {c.email}</div>}
                      {c.phone && <div style={{ fontSize: 12, color: 'var(--text2)' }}>📞 {c.phone}</div>}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {!c.is_primary && (
                        <button onClick={() => setPrimaryContact(c.id)} style={{ padding: '4px 8px', fontSize: 10, background: 'transparent', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text3)', cursor: 'pointer', fontFamily: 'DM Sans' }} title="Make primary">★</button>
                      )}
                      <button onClick={() => openEditContact(c)} style={{ padding: '4px 8px', fontSize: 10, background: 'transparent', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text3)', cursor: 'pointer', fontFamily: 'DM Sans' }}>✏️</button>
                      <button onClick={() => archiveContact(c.id)} style={{ padding: '4px 8px', fontSize: 10, background: 'transparent', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--red)', cursor: 'pointer', fontFamily: 'DM Sans' }}>✕</button>
                    </div>
                  </div>
                </div>
              )
            })}
            <button onClick={openNewContact} className="btn btn-secondary btn-full" style={{ marginTop: 8 }}>
              + Add Contact
            </button>
          </div>
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
            {manager && (
              <div className="card" style={{ cursor: 'default' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 }}>Managed by</div>
                <div style={{ fontSize: 13, color: 'var(--text)', fontWeight: 600 }}>🏢 {manager.name}</div>
              </div>
            )}
            {managedProperties.length > 0 && (
              <div className="card" style={{ cursor: 'default' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 }}>Manages {managedProperties.length} {managedProperties.length === 1 ? 'property' : 'properties'}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {managedProperties.map(p => (
                    <div key={p.id} style={{ fontSize: 12, color: 'var(--text2)' }}>
                      🏢 {p.name}{p.billing_city ? ` · ${p.billing_city}` : ''}
                    </div>
                  ))}
                </div>
              </div>
            )}
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

      {/* Contact Modal */}
      {showContactModal && (
        <Modal title={editingContact ? 'Edit Contact' : 'Add Contact'} onClose={() => setShowContactModal(false)}>
          <div className="form-field">
            <label className="form-label">Name *</label>
            <input className="form-input" placeholder="Chantal Monette" value={contactForm.name} onChange={e => updateContactForm('name', e.target.value)} />
          </div>
          <div className="form-field">
            <label className="form-label">Title</label>
            <input className="form-input" placeholder="Property Manager" value={contactForm.title} onChange={e => updateContactForm('title', e.target.value)} />
          </div>
          <div className="form-row">
            <div className="form-field">
              <label className="form-label">Email</label>
              <input className="form-input" type="email" placeholder="name@company.com" value={contactForm.email} onChange={e => updateContactForm('email', e.target.value)} />
            </div>
            <div className="form-field">
              <label className="form-label">Phone</label>
              <input className="form-input" placeholder="(514) 555-1234" value={contactForm.phone} onChange={e => updateContactForm('phone', e.target.value)} />
            </div>
          </div>
          <div className="form-field">
            <label className="form-label">
              Works for
              <span style={{ fontSize: 10, color: 'var(--text3)', marginLeft: 6, fontWeight: 400 }}>
                (employer company, if different from this client)
              </span>
            </label>
            <select className="form-input" value={contactForm.employer_client_id} onChange={e => updateContactForm('employer_client_id', e.target.value)}>
              <option value="">— Same as client —</option>
              {allClients.filter(c => c.id !== clientId).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12, marginBottom: 16 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text2)', cursor: 'pointer' }}>
              <input type="checkbox" checked={contactForm.is_primary} onChange={e => updateContactForm('is_primary', e.target.checked)} />
              ★ Primary contact for this client
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text2)', cursor: 'pointer' }}>
              <input type="checkbox" checked={contactForm.receives_invoices} onChange={e => updateContactForm('receives_invoices', e.target.checked)} />
              CC on invoices
            </label>
          </div>
          <button className="btn btn-primary btn-full" onClick={saveContact}>
            {editingContact ? 'Update Contact' : 'Add Contact'}
          </button>
          <button className="btn btn-secondary btn-full" style={{ marginTop: 8 }} onClick={() => setShowContactModal(false)}>Cancel</button>
        </Modal>
      )}
    </div>
  )
}

import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useToast } from '../shared/Toast'
import Modal from '../shared/Modal'
import { CLIENT_TYPES } from '../../lib/constants'
import ClientDetail from './ClientDetail'

export default function ClientsList() {
  const { companyId } = useAuth()
  const showToast = useToast()
  const [clients, setClients] = useState([])
  const [filtered, setFiltered] = useState([])
  const [detailClientId, setDetailClientId] = useState(null)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)

  // Form state
  const [form, setForm] = useState({
    name: '', type: 'commercial', contact_name: '', contact_email: '',
    contact_phone: '', billing_address_line1: '', billing_city: '',
    billing_province_state: '', billing_postal_zip: '', notes: '', is_large: false
  })

  useEffect(() => { if (companyId) loadClients() }, [companyId])

  useEffect(() => {
    if (!search.trim()) { setFiltered(clients); return }
    const q = search.toLowerCase()
    setFiltered(clients.filter(c =>
      c.name.toLowerCase().includes(q) ||
      (c.contact_name || '').toLowerCase().includes(q) ||
      (c.contact_email || '').toLowerCase().includes(q)
    ))
  }, [search, clients])

  async function loadClients() {
    const { data } = await supabase
      .from('clients')
      .select('*')
      .eq('company_id', companyId)
      .is('archived_at', null)
      .order('name')
    setClients(data || [])
    setLoading(false)
  }

  function openNew() {
    setEditing(null)
    setForm({
      name: '', type: 'commercial', contact_name: '', contact_email: '',
      contact_phone: '', billing_address_line1: '', billing_city: '',
      billing_province_state: '', billing_postal_zip: '', notes: ''
    })
    setShowModal(true)
  }

  function openEdit(client) {
    setEditing(client)
    setForm({
      name: client.name || '',
      type: client.type || 'commercial',
      contact_name: client.contact_name || '',
      contact_email: client.contact_email || '',
      contact_phone: client.contact_phone || '',
      billing_address_line1: client.billing_address_line1 || '',
      billing_city: client.billing_city || '',
      billing_province_state: client.billing_province_state || '',
      billing_postal_zip: client.billing_postal_zip || '',
      notes: client.notes || '',
      is_large: (client.tags || []).includes('large')
    })
    setShowModal(true)
  }

  async function saveClient() {
    if (!form.name.trim()) { showToast('Please enter a client name'); return }

    const { is_large, ...formData } = form
    const payload = { ...formData, tags: is_large ? ['large'] : [], company_id: companyId }
    let error

    if (editing) {
      ({ error } = await supabase.from('clients').update(payload).eq('id', editing.id))
    } else {
      ({ error } = await supabase.from('clients').insert(payload))
    }

    if (error) { showToast('Error saving client'); console.error(error); return }
    showToast(editing ? 'Client updated' : 'Client added')
    setShowModal(false)
    loadClients()
  }

  async function archiveClient() {
    if (!editing || !confirm('Archive this client?')) return
    const { error } = await supabase.from('clients')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', editing.id)
    if (error) { showToast('Error archiving client'); return }
    showToast('Client archived')
    setShowModal(false)
    loadClients()
  }

  function updateForm(field, value) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  if (detailClientId) {
    return <ClientDetail clientId={detailClientId} onBack={() => { setDetailClientId(null); loadClients() }} />
  }

  if (loading) return <div className="loading-center"><div className="spinner" /></div>

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Clients</div>
          <div className="page-subtitle">{clients.length} total</div>
        </div>
      </div>

      <div className="search-bar">
        <span className="search-icon">🔍</span>
        <input
          placeholder="Search clients..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      <div className="sec">
        {filtered.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">👥</div>
            <div className="empty-title">{search ? 'No matches' : 'No clients yet'}</div>
            <div className="empty-sub">
              {search ? 'Try a different search term' : 'Add your first client to get started'}
            </div>
          </div>
        ) : (
          filtered.map(client => (
            <div key={client.id} className="card" onClick={() => setDetailClientId(client.id)}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{
                  width: 46, height: 46, borderRadius: 15, flexShrink: 0,
                  background: 'linear-gradient(135deg, var(--primary), var(--primary2))',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 17, fontWeight: 800, color: '#000'
                }}>
                  {client.name.charAt(0).toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>{client.name}</div>
                  {client.contact_name && (
                    <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>
                      {client.contact_name}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                    <span className={`badge ${client.type === 'insurance' ? 'purple' : client.type === 'residential' ? 'blue' : 'green'}`}>
                      {client.type.toUpperCase()}
                    </span>
                    {(client.tags || []).includes('large') && (
                      <span className="badge yellow">⭐ LARGE</span>
                    )}
                    {client.contact_phone && (
                      <span style={{ fontSize: 11, color: 'var(--text3)' }}>{client.contact_phone}</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* FAB */}
      <button className="fab" onClick={openNew}>+</button>

      {/* Modal */}
      {showModal && (
        <Modal title={editing ? 'Edit Client' : 'New Client'} onClose={() => setShowModal(false)}>
          <div className="form-field">
            <label className="form-label">Client Name *</label>
            <input className="form-input" placeholder="e.g. Maple Leaf Properties"
              value={form.name} onChange={e => updateForm('name', e.target.value)} />
          </div>

          <div className="form-field">
            <label className="form-label">Type</label>
            <select className="form-input" value={form.type}
              onChange={e => updateForm('type', e.target.value)}>
              <option value="commercial">Commercial</option>
              <option value="residential">Residential</option>
              <option value="insurance">Insurance</option>
              <option value="government">Government</option>
            </select>
          </div>

          {/* Client tag */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
            background: form.is_large ? 'rgba(255,184,0,0.06)' : 'var(--bg2)',
            border: `1px solid ${form.is_large ? 'rgba(255,184,0,0.2)' : 'var(--border)'}`,
            borderRadius: 12, marginBottom: 16, cursor: 'pointer'
          }} onClick={() => updateForm('is_large', !form.is_large)}>
            <input type="checkbox" checked={form.is_large || false} readOnly />
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: form.is_large ? 'var(--yellow)' : 'var(--text2)' }}>⭐ Large Client</div>
              <div style={{ fontSize: 10, color: 'var(--text3)' }}>Property management, multiple locations, high volume</div>
            </div>
          </div>

          <div className="form-row">
            <div className="form-field">
              <label className="form-label">Contact Name</label>
              <input className="form-input" placeholder="Primary contact"
                value={form.contact_name} onChange={e => updateForm('contact_name', e.target.value)} />
            </div>
            <div className="form-field">
              <label className="form-label">Phone</label>
              <input className="form-input" placeholder="(514) 000-0000"
                value={form.contact_phone} onChange={e => updateForm('contact_phone', e.target.value)} />
            </div>
          </div>

          <div className="form-field">
            <label className="form-label">Email</label>
            <input className="form-input" type="email" placeholder="contact@company.com"
              value={form.contact_email} onChange={e => updateForm('contact_email', e.target.value)} />
          </div>

          <div className="form-field">
            <label className="form-label">Address</label>
            <input className="form-input" placeholder="Street address"
              value={form.billing_address_line1} onChange={e => updateForm('billing_address_line1', e.target.value)} />
          </div>

          <div className="form-row">
            <div className="form-field">
              <label className="form-label">City</label>
              <input className="form-input" placeholder="City"
                value={form.billing_city} onChange={e => updateForm('billing_city', e.target.value)} />
            </div>
            <div className="form-field">
              <label className="form-label">Province / State</label>
              <input className="form-input" placeholder="ON"
                value={form.billing_province_state} onChange={e => updateForm('billing_province_state', e.target.value)} />
            </div>
          </div>

          <div className="form-field">
            <label className="form-label">Notes</label>
            <textarea className="form-input" placeholder="Any details..."
              value={form.notes} onChange={e => updateForm('notes', e.target.value)} />
          </div>

          <button className="btn btn-primary btn-full" onClick={saveClient}>
            {editing ? 'Update Client' : 'Add Client'}
          </button>

          {editing && (
            <button className="btn btn-danger btn-full" style={{ marginTop: 8 }} onClick={archiveClient}>
              Archive Client
            </button>
          )}

          <button className="btn btn-secondary btn-full" style={{ marginTop: 8 }} onClick={() => setShowModal(false)}>
            Cancel
          </button>
        </Modal>
      )}
    </div>
  )
}

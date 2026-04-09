import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useToast } from '../shared/Toast'
import Modal from '../shared/Modal'
import { WORKER_ROLES } from '../../lib/constants'

export default function WorkersList({ hideHeader }) {
  const { companyId } = useAuth()
  const showToast = useToast()
  const [workers, setWorkers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [search, setSearch] = useState('')

  const [form, setForm] = useState({
    first_name: '', last_name: '', email: '', phone: '',
    role: 'technician', hourly_rate: '', employment_type: 'employee',
    certifications: '', hire_date: '', notes: ''
  })

  useEffect(() => { if (companyId) loadWorkers() }, [companyId])

  async function loadWorkers() {
    const { data } = await supabase
      .from('workers')
      .select('*')
      .eq('company_id', companyId)
      .is('archived_at', null)
      .order('first_name')
    setWorkers(data || [])
    setLoading(false)
  }

  function openNew() {
    setEditing(null)
    setForm({
      first_name: '', last_name: '', email: '', phone: '',
      role: 'technician', hourly_rate: '', employment_type: 'employee',
      certifications: '', hire_date: '', notes: ''
    })
    setShowModal(true)
  }

  function openEdit(worker) {
    setEditing(worker)
    setForm({
      first_name: worker.first_name || '',
      last_name: worker.last_name || '',
      email: worker.email || '',
      phone: worker.phone || '',
      role: worker.role || 'technician',
      hourly_rate: worker.hourly_rate || '',
      employment_type: worker.employment_type || 'employee',
      certifications: (worker.certifications || []).join(', '),
      hire_date: worker.hire_date || '',
      notes: worker.notes || ''
    })
    setShowModal(true)
  }

  async function saveWorker() {
    if (!form.first_name.trim() || !form.last_name.trim()) {
      showToast('Please enter first and last name'); return
    }

    const payload = {
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      role: form.role,
      hourly_rate: form.hourly_rate ? parseFloat(form.hourly_rate) : null,
      employment_type: form.employment_type,
      certifications: form.certifications ? form.certifications.split(',').map(s => s.trim()).filter(Boolean) : [],
      hire_date: form.hire_date || null,
      notes: form.notes.trim(),
      company_id: companyId
    }

    let error
    if (editing) {
      ({ error } = await supabase.from('workers').update(payload).eq('id', editing.id))
    } else {
      ({ error } = await supabase.from('workers').insert(payload))
    }

    if (error) { showToast('Error saving worker'); console.error(error); return }
    showToast(editing ? 'Worker updated' : 'Worker added')
    setShowModal(false)
    loadWorkers()
  }

  async function archiveWorker() {
    if (!editing || !confirm('Archive this worker?')) return
    const { error } = await supabase.from('workers')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', editing.id)
    if (error) { showToast('Error archiving worker'); return }
    showToast('Worker archived')
    setShowModal(false)
    loadWorkers()
  }

  function updateForm(field, value) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  const filtered = search.trim()
    ? workers.filter(w =>
        (w.first_name + ' ' + w.last_name).toLowerCase().includes(search.toLowerCase()) ||
        (w.email || '').toLowerCase().includes(search.toLowerCase())
      )
    : workers

  const statusColors = { active: 'var(--green)', on_leave: 'var(--yellow)', terminated: 'var(--text3)' }

  if (loading) return <div className="loading-center"><div className="spinner" /></div>

  return (
    <div>
      {!hideHeader && (
        <div className="page-header">
          <div>
            <div className="page-title">Team</div>
            <div className="page-subtitle">{workers.length} workers</div>
          </div>
        </div>
      )}

      <div className="search-bar">
        <span className="search-icon">🔍</span>
        <input placeholder="Search workers..." value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      <div className="sec">
        {filtered.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">👷</div>
            <div className="empty-title">{search ? 'No matches' : 'No workers yet'}</div>
            <div className="empty-sub">Tap + to add your first team member</div>
          </div>
        ) : (
          filtered.map(w => (
            <div key={w.id} className="card" onClick={() => openEdit(w)}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{
                  width: 46, height: 46, borderRadius: 15, flexShrink: 0,
                  background: 'linear-gradient(135deg, var(--primary), var(--primary2))',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 17, fontWeight: 800, color: '#000'
                }}>
                  {w.first_name.charAt(0)}{w.last_name.charAt(0)}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>{w.first_name} {w.last_name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>{w.role}</div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 6, alignItems: 'center' }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: statusColors[w.status] || 'var(--text3)' }} />
                    <span style={{ fontSize: 11, color: 'var(--text2)' }}>{w.status.replace('_', ' ')}</span>
                    {w.hourly_rate && (
                      <span style={{ fontSize: 11, color: 'var(--primary)', fontWeight: 700 }}>
                        ${w.hourly_rate}/hr
                      </span>
                    )}
                    {w.phone && (
                      <a href={`https://wa.me/${w.phone.replace(/[^0-9]/g, '')}`} target="_blank" rel="noopener"
                        onClick={e => e.stopPropagation()}
                        style={{ fontSize: 10, color: '#25D366', fontWeight: 700, textDecoration: 'none' }}>
                        💬
                      </a>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <button className="fab" onClick={openNew}>+</button>

      {showModal && (
        <Modal title={editing ? 'Edit Worker' : 'New Worker'} onClose={() => setShowModal(false)}>
          <div className="form-row">
            <div className="form-field">
              <label className="form-label">First Name *</label>
              <input className="form-input" placeholder="First"
                value={form.first_name} onChange={e => updateForm('first_name', e.target.value)} />
            </div>
            <div className="form-field">
              <label className="form-label">Last Name *</label>
              <input className="form-input" placeholder="Last"
                value={form.last_name} onChange={e => updateForm('last_name', e.target.value)} />
            </div>
          </div>

          <div className="form-row">
            <div className="form-field">
              <label className="form-label">Email</label>
              <input className="form-input" type="email" placeholder="email@example.com"
                value={form.email} onChange={e => updateForm('email', e.target.value)} />
            </div>
            <div className="form-field">
              <label className="form-label">Phone</label>
              <input className="form-input" placeholder="(514) 000-0000"
                value={form.phone} onChange={e => updateForm('phone', e.target.value)} />
            </div>
          </div>

          <div className="form-row">
            <div className="form-field">
              <label className="form-label">Role</label>
              <select className="form-input" value={form.role} onChange={e => updateForm('role', e.target.value)}>
                {WORKER_ROLES.map(r => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
              </select>
            </div>
            <div className="form-field">
              <label className="form-label">Hourly Rate ($)</label>
              <input className="form-input" type="number" placeholder="0.00"
                value={form.hourly_rate} onChange={e => updateForm('hourly_rate', e.target.value)} />
            </div>
          </div>

          <div className="form-row">
            <div className="form-field">
              <label className="form-label">Employment Type</label>
              <select className="form-input" value={form.employment_type} onChange={e => updateForm('employment_type', e.target.value)}>
                <option value="employee">Employee</option>
                <option value="subcontractor">Subcontractor</option>
              </select>
            </div>
            <div className="form-field">
              <label className="form-label">Hire Date</label>
              <input className="form-input" type="date"
                value={form.hire_date} onChange={e => updateForm('hire_date', e.target.value)} />
            </div>
          </div>

          <div className="form-field">
            <label className="form-label">Certifications</label>
            <input className="form-input" placeholder="e.g. IICRC WRT, First Aid, Asbestos"
              value={form.certifications} onChange={e => updateForm('certifications', e.target.value)} />
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>Comma-separated</div>
          </div>

          <div className="form-field">
            <label className="form-label">Notes</label>
            <textarea className="form-input" placeholder="Any details..."
              value={form.notes} onChange={e => updateForm('notes', e.target.value)} />
          </div>

          <button className="btn btn-primary btn-full" onClick={saveWorker}>
            {editing ? 'Update Worker' : 'Add Worker'}
          </button>
          {editing && (
            <button className="btn btn-danger btn-full" style={{ marginTop: 8 }} onClick={archiveWorker}>
              Archive Worker
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

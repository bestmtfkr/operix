import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useToast } from '../shared/Toast'
import Modal from '../shared/Modal'

const STATUS_COLORS = { available: '#00D4A0', deployed: '#2196F3', maintenance: '#FFB800', retired: '#3D4A5C' }
const STATUS_LABELS = { available: 'Available', deployed: 'Deployed', maintenance: 'Maintenance', retired: 'Retired' }

export default function EquipmentList() {
  const { companyId } = useAuth()
  const showToast = useToast()
  const [equipment, setEquipment] = useState([])
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)

  const [form, setForm] = useState({
    name: '', type: '', serial_number: '', daily_rate: '',
    status: 'available', current_job_id: '', notes: ''
  })

  useEffect(() => { if (companyId) { loadEquipment(); loadJobs() } }, [companyId])

  async function loadEquipment() {
    const { data } = await supabase.from('equipment')
      .select('*, jobs:current_job_id(name, job_number)')
      .eq('company_id', companyId).is('archived_at', null).order('name')
    setEquipment(data || [])
    setLoading(false)
  }

  async function loadJobs() {
    const { data } = await supabase.from('jobs').select('id, name, job_number')
      .eq('company_id', companyId).is('archived_at', null)
      .in('stage', ['active', 'lead', 'quoted', 'completed'])
    setJobs(data || [])
  }

  function openNew() {
    setEditing(null)
    setForm({ name: '', type: '', serial_number: '', daily_rate: '', status: 'available', current_job_id: '', notes: '' })
    setShowModal(true)
  }

  function openEdit(eq) {
    setEditing(eq)
    setForm({
      name: eq.name || '', type: eq.type || '', serial_number: eq.serial_number || '',
      daily_rate: eq.daily_rate || '', status: eq.status || 'available',
      current_job_id: eq.current_job_id || '', notes: eq.notes || ''
    })
    setShowModal(true)
  }

  async function saveEquipment() {
    if (!form.name.trim()) { showToast('Please enter equipment name'); return }
    const payload = {
      name: form.name.trim(), type: form.type.trim(), serial_number: form.serial_number.trim(),
      daily_rate: form.daily_rate ? parseFloat(form.daily_rate) : null,
      status: form.status, current_job_id: form.current_job_id || null,
      notes: form.notes.trim(), company_id: companyId
    }
    let error
    if (editing) {
      ({ error } = await supabase.from('equipment').update(payload).eq('id', editing.id))
    } else {
      ({ error } = await supabase.from('equipment').insert(payload))
    }
    if (error) { showToast('Error saving'); console.error(error); return }
    showToast(editing ? 'Equipment updated' : 'Equipment added')
    setShowModal(false); loadEquipment()
  }

  async function archiveEquipment() {
    if (!editing || !confirm('Archive this equipment?')) return
    await supabase.from('equipment').update({ archived_at: new Date().toISOString() }).eq('id', editing.id)
    showToast('Equipment archived'); setShowModal(false); loadEquipment()
  }

  function updateForm(f, v) { setForm(prev => ({ ...prev, [f]: v })) }

  const deployed = equipment.filter(e => e.status === 'deployed').length
  const available = equipment.filter(e => e.status === 'available').length

  if (loading) return <div className="loading-center"><div className="spinner" /></div>

  return (
    <div>
      {/* Summary */}
      <div style={{ display: 'flex', gap: 10, padding: '12px 16px' }}>
        <div className="stat-card c-green" style={{ flex: 1 }}>
          <div className="stat-label">Available</div>
          <div className="stat-val" style={{ color: 'var(--green)', fontSize: 28 }}>{available}</div>
        </div>
        <div className="stat-card c-blue" style={{ flex: 1 }}>
          <div className="stat-label">Deployed</div>
          <div className="stat-val" style={{ color: 'var(--blue)', fontSize: 28 }}>{deployed}</div>
        </div>
      </div>

      <div className="sec">
        <div className="sec-hdr">
          <div className="sec-title">Equipment</div>
          <div style={{ fontSize: 12, color: 'var(--text2)' }}>{equipment.length} total</div>
        </div>

        {equipment.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">🔧</div>
            <div className="empty-title">No equipment</div>
            <div className="empty-sub">Track dehumidifiers, air movers, tools</div>
          </div>
        ) : equipment.map(eq => (
          <div key={eq.id} className="card" onClick={() => openEdit(eq)}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700 }}>{eq.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>
                  {eq.type || 'No type'} {eq.serial_number ? '· SN: ' + eq.serial_number : ''}
                </div>
                {eq.jobs && (
                  <div style={{ fontSize: 11, color: 'var(--blue)', marginTop: 4 }}>
                    📍 {eq.jobs.job_number} — {eq.jobs.name}
                  </div>
                )}
              </div>
              <div style={{ textAlign: 'right' }}>
                <span className="badge" style={{
                  background: STATUS_COLORS[eq.status] + '18', color: STATUS_COLORS[eq.status]
                }}>{STATUS_LABELS[eq.status]}</span>
                {eq.daily_rate && (
                  <div style={{ fontSize: 12, color: 'var(--primary)', fontWeight: 700, marginTop: 4 }}>
                    ${eq.daily_rate}/day
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <button className="fab" onClick={openNew}>+</button>

      {showModal && (
        <Modal title={editing ? 'Edit Equipment' : 'New Equipment'} onClose={() => setShowModal(false)}>
          <div className="form-field">
            <label className="form-label">Name *</label>
            <input className="form-input" placeholder="e.g. Dri-Eaz LGR 3500i"
              value={form.name} onChange={e => updateForm('name', e.target.value)} />
          </div>
          <div className="form-row">
            <div className="form-field">
              <label className="form-label">Type</label>
              <input className="form-input" placeholder="e.g. Dehumidifier"
                value={form.type} onChange={e => updateForm('type', e.target.value)} />
            </div>
            <div className="form-field">
              <label className="form-label">Serial #</label>
              <input className="form-input" placeholder="SN"
                value={form.serial_number} onChange={e => updateForm('serial_number', e.target.value)} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-field">
              <label className="form-label">Daily Rate ($)</label>
              <input className="form-input" type="number" placeholder="0.00"
                value={form.daily_rate} onChange={e => updateForm('daily_rate', e.target.value)} />
            </div>
            <div className="form-field">
              <label className="form-label">Status</label>
              <select className="form-input" value={form.status} onChange={e => updateForm('status', e.target.value)}>
                <option value="available">Available</option>
                <option value="deployed">Deployed</option>
                <option value="maintenance">Maintenance</option>
                <option value="retired">Retired</option>
              </select>
            </div>
          </div>
          {form.status === 'deployed' && (
            <div className="form-field">
              <label className="form-label">Deployed to Job</label>
              <select className="form-input" value={form.current_job_id} onChange={e => updateForm('current_job_id', e.target.value)}>
                <option value="">Select job...</option>
                {jobs.map(j => <option key={j.id} value={j.id}>{j.job_number} — {j.name}</option>)}
              </select>
            </div>
          )}
          <div className="form-field">
            <label className="form-label">Notes</label>
            <textarea className="form-input" placeholder="Maintenance history, condition..."
              value={form.notes} onChange={e => updateForm('notes', e.target.value)} />
          </div>
          <button className="btn btn-primary btn-full" onClick={saveEquipment}>
            {editing ? 'Update' : 'Add Equipment'}
          </button>
          {editing && (
            <button className="btn btn-danger btn-full" style={{ marginTop: 8 }} onClick={archiveEquipment}>Archive</button>
          )}
          <button className="btn btn-secondary btn-full" style={{ marginTop: 8 }} onClick={() => setShowModal(false)}>Cancel</button>
        </Modal>
      )}
    </div>
  )
}

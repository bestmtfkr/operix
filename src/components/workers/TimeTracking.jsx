import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useToast } from '../shared/Toast'
import Modal from '../shared/Modal'

export default function TimeTracking() {
  const { companyId } = useAuth()
  const showToast = useToast()
  const [entries, setEntries] = useState([])
  const [workers, setWorkers] = useState([])
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)

  const [form, setForm] = useState({
    worker_id: '', job_id: '', date: '', start_time: '', end_time: '',
    break_minutes: '0', total_hours: '', description: ''
  })

  useEffect(() => {
    if (companyId) { loadEntries(); loadWorkers(); loadJobs() }
  }, [companyId])

  async function loadEntries() {
    const { data } = await supabase.from('time_entries')
      .select('*, workers(first_name, last_name), jobs(name, job_number)')
      .eq('company_id', companyId)
      .order('date', { ascending: false })
      .order('start_time', { ascending: false })
      .limit(50)
    setEntries(data || [])
    setLoading(false)
  }

  async function loadWorkers() {
    const { data } = await supabase.from('workers').select('id, first_name, last_name, hourly_rate')
      .eq('company_id', companyId).is('archived_at', null).order('first_name')
    setWorkers(data || [])
  }

  async function loadJobs() {
    const { data } = await supabase.from('jobs').select('id, name, job_number')
      .eq('company_id', companyId).is('archived_at', null)
      .in('stage', ['active', 'lead', 'quoted', 'completed'])
      .order('created_at', { ascending: false })
    setJobs(data || [])
  }

  function openNew() {
    setEditing(null)
    const today = new Date().toISOString().split('T')[0]
    setForm({
      worker_id: '', job_id: '', date: today, start_time: '08:00',
      end_time: '16:00', break_minutes: '30', total_hours: '', description: ''
    })
    setShowModal(true)
  }

  function openEdit(entry) {
    setEditing(entry)
    setForm({
      worker_id: entry.worker_id || '',
      job_id: entry.job_id || '',
      date: entry.date || '',
      start_time: entry.start_time ? new Date(entry.start_time).toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit', hour12: false }) : '',
      end_time: entry.end_time ? new Date(entry.end_time).toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit', hour12: false }) : '',
      break_minutes: entry.break_minutes?.toString() || '0',
      total_hours: entry.total_hours?.toString() || '',
      description: entry.description || ''
    })
    setShowModal(true)
  }

  function calcHours() {
    if (!form.start_time || !form.end_time) return null
    const [sh, sm] = form.start_time.split(':').map(Number)
    const [eh, em] = form.end_time.split(':').map(Number)
    const totalMin = (eh * 60 + em) - (sh * 60 + sm) - (parseInt(form.break_minutes) || 0)
    return Math.max(0, totalMin / 60)
  }

  async function saveEntry() {
    if (!form.worker_id || !form.job_id || !form.date) {
      showToast('Please fill in worker, job, and date'); return
    }

    const hours = form.total_hours ? parseFloat(form.total_hours) : calcHours()
    const worker = workers.find(w => w.id === form.worker_id)

    const payload = {
      worker_id: form.worker_id,
      job_id: form.job_id,
      date: form.date,
      start_time: form.start_time ? `${form.date}T${form.start_time}:00` : null,
      end_time: form.end_time ? `${form.date}T${form.end_time}:00` : null,
      break_minutes: parseInt(form.break_minutes) || 0,
      total_hours: hours,
      hourly_rate_at_time: worker?.hourly_rate || null,
      description: form.description.trim(),
      company_id: companyId,
      updated_at: new Date().toISOString()
    }

    let error
    if (editing) {
      ({ error } = await supabase.from('time_entries').update(payload).eq('id', editing.id))
    } else {
      ({ error } = await supabase.from('time_entries').insert(payload))
    }

    if (error) { showToast('Error saving time entry'); console.error(error); return }
    showToast(editing ? 'Time entry updated' : 'Time entry logged')
    setShowModal(false)
    loadEntries()
  }

  async function deleteEntry() {
    if (!editing || !confirm('Delete this time entry?')) return
    await supabase.from('time_entries').delete().eq('id', editing.id)
    showToast('Time entry deleted')
    setShowModal(false)
    loadEntries()
  }

  async function approveEntry(id) {
    await supabase.from('time_entries').update({ is_approved: true, approved_at: new Date().toISOString() }).eq('id', id)
    showToast('Approved')
    loadEntries()
  }

  function updateForm(f, v) { setForm(prev => ({ ...prev, [f]: v })) }

  const totalHoursThisWeek = entries
    .filter(e => {
      const d = new Date(e.date)
      const now = new Date()
      const weekAgo = new Date(now - 7 * 86400000)
      return d >= weekAgo
    })
    .reduce((s, e) => s + (parseFloat(e.total_hours) || 0), 0)

  const pendingApproval = entries.filter(e => !e.is_approved).length

  if (loading) return <div className="loading-center"><div className="spinner" /></div>

  return (
    <div>
      {/* Summary */}
      <div style={{ display: 'flex', gap: 10, padding: '12px 16px' }}>
        <div className="stat-card c-green" style={{ flex: 1 }}>
          <div className="stat-label">Hours This Week</div>
          <div className="stat-val" style={{ color: 'var(--green)', fontSize: 28 }}>{totalHoursThisWeek.toFixed(1)}</div>
        </div>
        <div className="stat-card c-yellow" style={{ flex: 1 }}>
          <div className="stat-label">Pending Approval</div>
          <div className="stat-val" style={{ color: 'var(--yellow)', fontSize: 28 }}>{pendingApproval}</div>
        </div>
      </div>

      <div className="sec">
        <div className="sec-hdr">
          <div className="sec-title">Recent Time Entries</div>
        </div>

        {entries.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">⏱</div>
            <div className="empty-title">No time entries</div>
            <div className="empty-sub">Tap + to log hours</div>
          </div>
        ) : (
          entries.map(e => (
            <div key={e.id} className="card" onClick={() => openEdit(e)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>
                    {e.workers?.first_name} {e.workers?.last_name}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>
                    {e.jobs?.job_number} — {e.jobs?.name}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
                    {e.date}
                    {e.start_time && e.end_time && ` · ${new Date(e.start_time).toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit' })} - ${new Date(e.end_time).toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit' })}`}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--primary)' }}>
                    {parseFloat(e.total_hours || 0).toFixed(1)}h
                  </div>
                  {e.hourly_rate_at_time && (
                    <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
                      ${(parseFloat(e.total_hours || 0) * parseFloat(e.hourly_rate_at_time)).toFixed(2)}
                    </div>
                  )}
                  <div style={{ marginTop: 4 }}>
                    {e.is_approved ? (
                      <span className="badge green">APPROVED</span>
                    ) : (
                      <span className="badge yellow" style={{ cursor: 'pointer' }}
                        onClick={ev => { ev.stopPropagation(); approveEntry(e.id) }}>
                        TAP TO APPROVE
                      </span>
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
        <Modal title={editing ? 'Edit Time Entry' : 'Log Time'} onClose={() => setShowModal(false)}>
          <div className="form-field">
            <label className="form-label">Worker *</label>
            <select className="form-input" value={form.worker_id} onChange={e => updateForm('worker_id', e.target.value)}>
              <option value="">Select worker...</option>
              {workers.map(w => <option key={w.id} value={w.id}>{w.first_name} {w.last_name} {w.hourly_rate ? `($${w.hourly_rate}/hr)` : ''}</option>)}
            </select>
          </div>

          <div className="form-field">
            <label className="form-label">Job *</label>
            <select className="form-input" value={form.job_id} onChange={e => updateForm('job_id', e.target.value)}>
              <option value="">Select job...</option>
              {jobs.map(j => <option key={j.id} value={j.id}>{j.job_number} — {j.name}</option>)}
            </select>
          </div>

          <div className="form-field">
            <label className="form-label">Date *</label>
            <input className="form-input" type="date" value={form.date} onChange={e => updateForm('date', e.target.value)} />
          </div>

          <div className="form-row">
            <div className="form-field">
              <label className="form-label">Start Time</label>
              <input className="form-input" type="time" value={form.start_time} onChange={e => updateForm('start_time', e.target.value)} />
            </div>
            <div className="form-field">
              <label className="form-label">End Time</label>
              <input className="form-input" type="time" value={form.end_time} onChange={e => updateForm('end_time', e.target.value)} />
            </div>
          </div>

          <div className="form-row">
            <div className="form-field">
              <label className="form-label">Break (minutes)</label>
              <input className="form-input" type="number" value={form.break_minutes} onChange={e => updateForm('break_minutes', e.target.value)} />
            </div>
            <div className="form-field">
              <label className="form-label">Total Hours {calcHours() !== null ? `(calc: ${calcHours().toFixed(1)})` : ''}</label>
              <input className="form-input" type="number" step="0.1" placeholder={calcHours()?.toFixed(1) || 'Auto'}
                value={form.total_hours} onChange={e => updateForm('total_hours', e.target.value)} />
            </div>
          </div>

          <div className="form-field">
            <label className="form-label">Description</label>
            <textarea className="form-input" placeholder="What was done..."
              value={form.description} onChange={e => updateForm('description', e.target.value)} />
          </div>

          <button className="btn btn-primary btn-full" onClick={saveEntry}>
            {editing ? 'Update Entry' : 'Log Time'}
          </button>
          {editing && (
            <button className="btn btn-danger btn-full" style={{ marginTop: 8 }} onClick={deleteEntry}>
              Delete Entry
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

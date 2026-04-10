import { useEffect, useState, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useToast } from '../shared/Toast'
import Modal from '../shared/Modal'
import { STAGE_COLORS } from '../../lib/constants'

const HOURS = ['7:00','8:00','9:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00']

export default function ScheduleView({ onJobClick }) {
  const { companyId } = useAuth()
  const showToast = useToast()
  const [allJobs, setAllJobs] = useState([])
  const [entries, setEntries] = useState([])
  const [workers, setWorkers] = useState([])
  const [loading, setLoading] = useState(true)
  const [monthOffset, setMonthOffset] = useState(0)
  const [selectedDate, setSelectedDate] = useState(null)

  // Assign mode — click a job, then click a time slot
  const [assignJob, setAssignJob] = useState(null)
  const [showAssignModal, setShowAssignModal] = useState(false)
  const [assignForm, setAssignForm] = useState({ worker_id: '', start: '08:00', end: '17:00', fullDay: true })

  useEffect(() => { if (companyId) loadData() }, [companyId, monthOffset, selectedDate])

  async function loadData() {
    const now = new Date()
    const start = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1)
    const end = new Date(now.getFullYear(), now.getMonth() + monthOffset + 2, 0)

    const [jobsRes, entriesRes, workersRes] = await Promise.all([
      supabase.from('jobs').select('id, name, job_number, stage, job_type, priority, site_address, clients(name)')
        .eq('company_id', companyId).is('archived_at', null),
      supabase.from('schedule_entries').select('*, workers(first_name, last_name, phone), jobs(name, job_number, stage, priority, site_address, clients(name))')
        .eq('company_id', companyId)
        .gte('date', start.toISOString().split('T')[0])
        .lte('date', end.toISOString().split('T')[0]),
      supabase.from('workers').select('id, first_name, last_name, role, phone')
        .eq('company_id', companyId).is('archived_at', null).eq('status', 'active').order('first_name')
    ])

    setAllJobs(jobsRes.data || [])
    setEntries(entriesRes.data || [])
    setWorkers(workersRes.data || [])
    setLoading(false)
  }

  const today = new Date().toISOString().split('T')[0]
  const activeJobs = allJobs.filter(j => ['lead', 'quoted', 'active'].includes(j.stage))

  function getMonthLabel() {
    const d = new Date(); d.setMonth(d.getMonth() + monthOffset)
    return d.toLocaleDateString('en-CA', { month: 'long', year: 'numeric' })
  }

  function getMonthGrid() {
    const now = new Date()
    const first = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1)
    let pad = first.getDay() - 1; if (pad < 0) pad = 6
    const days = []
    const s = new Date(first); s.setDate(s.getDate() - pad)
    for (let i = 0; i < 42; i++) { const d = new Date(s); d.setDate(d.getDate() + i); days.push(d) }
    return days
  }

  function getEntriesForDate(dateStr) {
    return entries.filter(e => e.date === dateStr)
  }

  // Start assigning a job — user picks the job, then we show modal to pick worker + time
  function startAssign(job, date) {
    setAssignJob(job)
    setAssignForm({ worker_id: workers[0]?.id || '', start: '08:00', end: '17:00', fullDay: true })
    if (date) setSelectedDate(date)
    setShowAssignModal(true)
  }

  async function confirmAssign() {
    if (!assignJob || !assignForm.worker_id) { showToast('Select a worker'); return }
    const date = selectedDate || today

    const startTime = assignForm.fullDay ? '07:00' : assignForm.start
    const endTime = assignForm.fullDay ? '17:00' : assignForm.end

    const { error } = await supabase.from('schedule_entries').insert({
      company_id: companyId, job_id: assignJob.id, worker_id: assignForm.worker_id,
      date, start_time: startTime, end_time: endTime
    })
    if (error) { showToast('Error scheduling'); return }

    // Assign worker to job
    const { data: existing } = await supabase.from('job_workers')
      .select('id').eq('job_id', assignJob.id).eq('worker_id', assignForm.worker_id).is('removed_at', null)
    if (!existing?.length) {
      await supabase.from('job_workers').insert({ company_id: companyId, job_id: assignJob.id, worker_id: assignForm.worker_id, role_on_job: 'crew' })
    }

    if (assignJob.stage === 'lead') {
      await supabase.from('jobs').update({ stage: 'active', stage_changed_at: new Date().toISOString() }).eq('id', assignJob.id)
    }

    showToast(`Scheduled ${assignJob.name}`)
    setShowAssignModal(false)
    setAssignJob(null)
    loadData()
  }

  async function removeEntry(entryId) {
    await supabase.from('schedule_entries').delete().eq('id', entryId)
    showToast('Removed')
    loadData()
  }

  async function editEntry(entry) {
    setAssignForm({
      worker_id: entry.worker_id || '',
      start: entry.start_time || '08:00',
      end: entry.end_time || '17:00',
      fullDay: entry.start_time === '07:00' && entry.end_time === '17:00'
    })
    setAssignJob({ id: entry.job_id, name: entry.jobs?.name, _entryId: entry.id })
    setShowAssignModal(true)
  }

  async function updateEntry() {
    if (!assignJob?._entryId) return
    const startTime = assignForm.fullDay ? '07:00' : assignForm.start
    const endTime = assignForm.fullDay ? '17:00' : assignForm.end

    await supabase.from('schedule_entries').update({
      start_time: startTime, end_time: endTime, worker_id: assignForm.worker_id
    }).eq('id', assignJob._entryId)

    showToast('Updated')
    setShowAssignModal(false)
    setAssignJob(null)
    loadData()
  }

  function sendWhatsApp(phone, entry) {
    const job = entry.jobs || {}
    const dateLabel = new Date(entry.date + 'T12:00:00').toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' })
    const msg = encodeURIComponent(`📋 *Job Assignment*\n\n*${job.name || ''}*\n📅 ${dateLabel} at ${entry.start_time || ''}\n📍 ${job.site_address || 'TBD'}\n👤 Client: ${job.clients?.name || 'TBD'}\n🏷 ${job.job_number || ''}\n\nPlease confirm when you're on your way.`)
    window.open(`https://api.whatsapp.com/send?phone=${phone.replace(/[^0-9]/g, '')}&text=${msg}`, '_blank')
  }

  if (loading) return <div className="loading-center"><div className="spinner" /></div>

  // DAY VIEW
  if (selectedDate) {
    const dayEntries = getEntriesForDate(selectedDate)
    const dayLabel = new Date(selectedDate + 'T12:00:00').toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' })

    return (
      <div>
        {/* Day header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
          <button onClick={() => setSelectedDate(null)} style={{
            width: 30, height: 30, borderRadius: 8, background: 'var(--card)',
            border: '1px solid var(--border)', cursor: 'pointer', fontSize: 14,
            display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text2)'
          }}>←</button>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>{dayLabel}</div>
            <div style={{ fontSize: 11, color: 'var(--text3)' }}>{dayEntries.length} scheduled</div>
          </div>
        </div>

        {/* Scheduled entries for this day */}
        <div className="sec" style={{ marginTop: 8 }}>
          {dayEntries.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 24, color: 'var(--text3)', fontSize: 13 }}>
              No jobs scheduled for this day
            </div>
          ) : dayEntries.map(e => (
            <div key={e.id} className="card" onClick={() => editEntry(e)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>{e.jobs?.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2 }}>
                    {e.workers?.first_name} {e.workers?.last_name} · {e.start_time} - {e.end_time}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>{e.jobs?.site_address || ''}</div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {e.workers?.phone && (
                    <button onClick={ev => { ev.stopPropagation(); sendWhatsApp(e.workers.phone, e) }} style={{
                      padding: '4px 8px', borderRadius: 6, fontSize: 10, fontWeight: 700,
                      background: 'rgba(37,211,102,0.1)', border: '1px solid rgba(37,211,102,0.2)',
                      color: '#25D366', cursor: 'pointer', fontFamily: 'DM Sans'
                    }}>💬</button>
                  )}
                  <button onClick={ev => { ev.stopPropagation(); removeEntry(e.id) }} style={{
                    padding: '4px 8px', borderRadius: 6, fontSize: 10, fontWeight: 700,
                    background: 'rgba(255,59,92,0.08)', border: '1px solid rgba(255,59,92,0.2)',
                    color: 'var(--red)', cursor: 'pointer', fontFamily: 'DM Sans'
                  }}>×</button>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Add job to this day */}
        <div className="sec" style={{ marginTop: 8 }}>
          <div className="sec-hdr"><div className="sec-title">Add Job to This Day</div></div>
          {activeJobs.map(job => (
            <div key={job.id} className="card" onClick={() => startAssign(job, selectedDate)} style={{
              borderLeft: `3px solid ${job.priority === 'emergency' ? 'var(--red)' : job.priority === 'urgent' ? 'var(--orange)' : 'var(--primary)'}`
            }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{job.name}</div>
              <div style={{ fontSize: 11, color: 'var(--text3)' }}>{job.clients?.name} {job.site_address ? '· ' + job.site_address : ''}</div>
            </div>
          ))}
          {activeJobs.length === 0 && (
            <div style={{ textAlign: 'center', padding: 16, color: 'var(--text3)', fontSize: 12 }}>No active jobs to schedule</div>
          )}
        </div>

        {/* Assign Modal */}
        {showAssignModal && assignJob && (
          <Modal title={assignJob._entryId ? 'Edit Schedule' : 'Schedule Job'} onClose={() => { setShowAssignModal(false); setAssignJob(null) }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{assignJob.name}</div>
            <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 14 }}>
              {new Date(selectedDate + 'T12:00:00').toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' })}
            </div>

            <div className="form-field">
              <label className="form-label">Worker *</label>
              <select className="form-input" value={assignForm.worker_id}
                onChange={e => setAssignForm(f => ({ ...f, worker_id: e.target.value }))}>
                <option value="">Select worker...</option>
                {workers.map(w => <option key={w.id} value={w.id}>{w.first_name} {w.last_name}</option>)}
              </select>
            </div>

            <label style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px',
              background: assignForm.fullDay ? 'rgba(0,212,160,0.06)' : 'var(--bg2)',
              border: `1px solid ${assignForm.fullDay ? 'rgba(0,212,160,0.2)' : 'var(--border)'}`,
              borderRadius: 12, marginBottom: 12, cursor: 'pointer'
            }}>
              <input type="checkbox" checked={assignForm.fullDay}
                onChange={e => setAssignForm(f => ({ ...f, fullDay: e.target.checked }))}
                style={{ width: 18, height: 18, accentColor: 'var(--primary)' }} />
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: assignForm.fullDay ? 'var(--primary)' : 'var(--text)' }}>Full Day</div>
                <div style={{ fontSize: 11, color: 'var(--text3)' }}>7:00 AM — 5:00 PM</div>
              </div>
            </label>

            {!assignForm.fullDay && (
              <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
                <div style={{ flex: 1 }}>
                  <label className="form-label">Start</label>
                  <input type="time" className="form-input" value={assignForm.start}
                    onChange={e => setAssignForm(f => ({ ...f, start: e.target.value }))} />
                </div>
                <div style={{ flex: 1 }}>
                  <label className="form-label">End</label>
                  <input type="time" className="form-input" value={assignForm.end}
                    onChange={e => setAssignForm(f => ({ ...f, end: e.target.value }))} />
                </div>
              </div>
            )}

            <button onClick={assignJob._entryId ? updateEntry : confirmAssign} className="btn btn-primary btn-full" style={{ padding: 14 }}>
              {assignJob._entryId ? 'Update' : 'Schedule'}
            </button>
            {assignJob._entryId && (
              <button onClick={() => { removeEntry(assignJob._entryId); setShowAssignModal(false); setAssignJob(null) }}
                className="btn btn-danger btn-full" style={{ marginTop: 8 }}>Remove from Schedule</button>
            )}
            <button onClick={() => { setShowAssignModal(false); setAssignJob(null) }}
              className="btn btn-secondary btn-full" style={{ marginTop: 8 }}>Cancel</button>
          </Modal>
        )}
      </div>
    )
  }

  // MONTH VIEW
  const monthGrid = getMonthGrid()
  const currentMonth = new Date(new Date().getFullYear(), new Date().getMonth() + monthOffset, 1).getMonth()

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
        <button onClick={() => setMonthOffset(o => o - 1)} style={{
          width: 30, height: 30, borderRadius: 8, background: 'var(--card)',
          border: '1px solid var(--border)', cursor: 'pointer', fontSize: 16,
          display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text2)'
        }}>‹</button>
        <div style={{ flex: 1, fontSize: 15, fontWeight: 700 }}>{getMonthLabel()}</div>
        <button onClick={() => setMonthOffset(o => o + 1)} style={{
          width: 30, height: 30, borderRadius: 8, background: 'var(--card)',
          border: '1px solid var(--border)', cursor: 'pointer', fontSize: 16,
          display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text2)'
        }}>›</button>
        {monthOffset !== 0 && (
          <button onClick={() => setMonthOffset(0)} style={{
            padding: '5px 10px', borderRadius: 8, fontSize: 11, fontWeight: 700,
            background: 'rgba(0,212,160,0.1)', border: '1px solid rgba(0,212,160,0.2)',
            color: 'var(--primary)', cursor: 'pointer', fontFamily: 'DM Sans'
          }}>Today</button>
        )}
      </div>

      <div style={{ padding: '8px 16px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, marginBottom: 4 }}>
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => (
            <div key={d} style={{ textAlign: 'center', fontSize: 10, fontWeight: 700, color: 'var(--text3)', padding: 4 }}>{d}</div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 3 }}>
          {monthGrid.map((day, i) => {
            const dateStr = day.toISOString().split('T')[0]
            const dayEntries = getEntriesForDate(dateStr)
            const isToday = dateStr === today
            const isCurrentMonth = day.getMonth() === currentMonth

            return (
              <div key={i} onClick={() => setSelectedDate(dateStr)} style={{
                minHeight: 75, padding: 5, cursor: 'pointer',
                background: isToday ? 'rgba(0,212,160,0.06)' : 'var(--card)',
                border: `1px solid ${isToday ? 'rgba(0,212,160,0.3)' : 'var(--border)'}`,
                borderRadius: 8, opacity: isCurrentMonth ? 1 : 0.3
              }}>
                <div style={{ fontSize: 12, fontWeight: isToday ? 800 : 500, color: isToday ? 'var(--primary)' : 'var(--text2)', marginBottom: 3 }}>
                  {day.getDate()}
                </div>
                {dayEntries.slice(0, 3).map(e => (
                  <div key={e.id} style={{
                    fontSize: 9, fontWeight: 600, padding: '2px 4px', marginBottom: 2,
                    borderRadius: 4, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                    background: STAGE_COLORS[e.jobs?.stage] + '18', color: STAGE_COLORS[e.jobs?.stage]
                  }}>{e.jobs?.name}</div>
                ))}
                {dayEntries.length > 3 && <div style={{ fontSize: 8, color: 'var(--text3)' }}>+{dayEntries.length - 3}</div>}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

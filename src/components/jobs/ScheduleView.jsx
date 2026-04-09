import { useEffect, useState, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useToast } from '../shared/Toast'
import { STAGE_COLORS, JOB_TYPE_LABELS } from '../../lib/constants'

const HOURS = ['7:00','8:00','9:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00']

export default function ScheduleView({ onJobClick }) {
  const { companyId } = useAuth()
  const showToast = useToast()
  const [allJobs, setAllJobs] = useState([])
  const [entries, setEntries] = useState([])
  const [workers, setWorkers] = useState([])
  const [unscheduled, setUnscheduled] = useState([])
  const [loading, setLoading] = useState(true)
  const [monthOffset, setMonthOffset] = useState(0)
  const [selectedDate, setSelectedDate] = useState(null)
  const [dragJob, setDragJob] = useState(null)
  const dragJobRef = useRef(null)
  const [showTimeModal, setShowTimeModal] = useState(null)
  const [timeForm, setTimeForm] = useState({ start: '08:00', end: '17:00', fullDay: false })

  useEffect(() => { if (companyId) loadData() }, [companyId, monthOffset])

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

    const jobs = jobsRes.data || []
    setAllJobs(jobs)
    setEntries(entriesRes.data || [])
    setWorkers(workersRes.data || [])

    // Unscheduled = active jobs with no schedule entries
    const scheduledJobIds = new Set((entriesRes.data || []).map(e => e.job_id))
    setUnscheduled(jobs.filter(j => ['lead', 'quoted', 'active'].includes(j.stage) && !scheduledJobIds.has(j.id)))
    setLoading(false)
  }

  const today = new Date().toISOString().split('T')[0]

  function getMonthLabel() {
    const d = new Date(); d.setMonth(d.getMonth() + monthOffset)
    return d.toLocaleDateString('en-CA', { month: 'long', year: 'numeric' })
  }

  function getMonthGrid() {
    const now = new Date()
    const first = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1)
    let startPad = first.getDay() - 1; if (startPad < 0) startPad = 6
    const days = []
    const padStart = new Date(first); padStart.setDate(padStart.getDate() - startPad)
    for (let i = 0; i < 42; i++) { const d = new Date(padStart); d.setDate(d.getDate() + i); days.push(d) }
    return days
  }

  function getEntriesForDate(dateStr) {
    return entries.filter(e => e.date === dateStr)
  }

  // Drop job onto worker time slot — show time picker
  function handleDrop(workerId, hour) {
    const job = dragJobRef.current
    if (!job || !selectedDate) return
    setTimeForm({ start: `${String(hour).padStart(2, '0')}:00`, end: `${String(Math.min(hour + 2, 17)).padStart(2, '0')}:00`, fullDay: false })
    setShowTimeModal({ jobId: job.id, jobName: job.name, workerId, hour })
    setDragJob(null)
    dragJobRef.current = null
  }

  async function confirmSchedule() {
    if (!showTimeModal || !selectedDate) return
    const { jobId, workerId } = showTimeModal

    const startTime = timeForm.fullDay ? '07:00' : timeForm.start
    const endTime = timeForm.fullDay ? '17:00' : timeForm.end

    const { error } = await supabase.from('schedule_entries').insert({
      company_id: companyId, job_id: jobId, worker_id: workerId,
      date: selectedDate, start_time: startTime, end_time: endTime
    })

    if (error) { showToast('Error scheduling'); console.error(error); return }

    // Assign worker
    const { data: existing } = await supabase.from('job_workers')
      .select('id').eq('job_id', jobId).eq('worker_id', workerId).is('removed_at', null)
    if (!existing?.length) {
      await supabase.from('job_workers').insert({ company_id: companyId, job_id: jobId, worker_id: workerId, role_on_job: 'crew' })
    }

    // Move to active if lead
    const job = allJobs.find(j => j.id === jobId)
    if (job?.stage === 'lead') {
      await supabase.from('jobs').update({ stage: 'active', stage_changed_at: new Date().toISOString() }).eq('id', jobId)
    }

    showToast(`Scheduled ${showTimeModal.jobName}`)
    setShowTimeModal(null)
    loadData()
  }

  // Remove schedule entry
  async function removeEntry(entryId) {
    await supabase.from('schedule_entries').delete().eq('id', entryId)
    showToast('Removed from schedule')
    loadData()
  }

  function generateWhatsAppMessage(entry) {
    const job = entry.jobs || {}
    const dateLabel = new Date(entry.date + 'T12:00:00').toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' })
    return `📋 *Job Assignment*\n\n*${job.name || ''}*\n📅 ${dateLabel} at ${entry.start_time || ''}\n📍 ${job.site_address || 'TBD'}\n👤 Client: ${job.clients?.name || 'TBD'}\n🏷 ${job.job_number || ''}\n\nPlease confirm when you're on your way.`
  }

  function sendWhatsApp(phone, entry) {
    const msg = encodeURIComponent(generateWhatsAppMessage(entry))
    window.open(`https://wa.me/${phone.replace(/[^0-9]/g, '')}?text=${msg}`, '_blank')
  }

  if (loading) return <div className="loading-center"><div className="spinner" /></div>

  // DAY DISPATCH VIEW
  if (selectedDate) {
    const dayEntries = getEntriesForDate(selectedDate)
    const dayLabel = new Date(selectedDate + 'T12:00:00').toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' })

    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <button onClick={() => setSelectedDate(null)} style={{
            width: 30, height: 30, borderRadius: 8, background: 'var(--card)',
            border: '1px solid var(--border)', cursor: 'pointer', fontSize: 14,
            display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text2)'
          }}>←</button>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>{dayLabel}</div>
            <div style={{ fontSize: 11, color: 'var(--text3)' }}>{dayEntries.length} scheduled · {unscheduled.length} pending</div>
          </div>
        </div>

        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {/* Sidebar — unscheduled + already scheduled today (can drag again for another day) */}
          <div style={{ width: 180, flexShrink: 0, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '8px 10px', fontSize: 10, fontWeight: 700, color: 'var(--text3)', borderBottom: '1px solid var(--border)' }}>
              DRAG TO SCHEDULE
            </div>
            <div style={{ flex: 1, overflow: 'auto', padding: 6 }}>
              {/* All active jobs — not just unscheduled, since same job can go on multiple days */}
              {allJobs.filter(j => ['lead', 'quoted', 'active'].includes(j.stage)).map(job => (
                <div key={job.id} draggable onDragStart={() => { setDragJob(job); dragJobRef.current = job }} onDragEnd={() => setDragJob(null)}
                  onClick={() => onJobClick && onJobClick(job.id)}
                  style={{
                    background: 'var(--card)', border: '1px solid var(--border)',
                    borderLeft: `3px solid ${job.priority === 'emergency' ? 'var(--red)' : job.priority === 'urgent' ? 'var(--orange)' : 'var(--primary)'}`,
                    borderRadius: 8, padding: 8, marginBottom: 4, cursor: 'grab', userSelect: 'none'
                  }}>
                  <div style={{ fontSize: 11, fontWeight: 600 }}>{job.name}</div>
                  <div style={{ fontSize: 9, color: 'var(--text3)' }}>{job.clients?.name}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Time grid */}
          <div style={{ flex: 1, overflow: 'auto' }}>
            <div style={{ minWidth: Math.max(workers.length * 120 + 50, 400) }}>
              <div style={{ display: 'grid', gridTemplateColumns: `50px repeat(${workers.length}, 1fr)`, position: 'sticky', top: 0, zIndex: 5, background: 'var(--bg)' }}>
                <div style={{ padding: 6 }} />
                {workers.map(w => (
                  <div key={w.id} style={{ padding: '8px 4px', textAlign: 'center', borderLeft: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ fontSize: 11, fontWeight: 600 }}>{w.first_name} {w.last_name?.charAt(0)}.</div>
                  </div>
                ))}
              </div>

              {HOURS.map(time => {
                const hour = parseInt(time)
                return (
                  <div key={time} style={{ display: 'grid', gridTemplateColumns: `50px repeat(${workers.length}, 1fr)` }}>
                    <div style={{ padding: '4px 6px', borderBottom: '1px solid var(--border)', fontSize: 9, color: 'var(--text3)' }}>{time}</div>
                    {workers.map(w => {
                      const entry = dayEntries.find(e => e.worker_id === w.id && e.start_time && parseInt(e.start_time) === hour)
                      return (
                        <div key={w.id} style={{
                          borderLeft: '1px solid var(--border)', borderBottom: '1px solid var(--border)',
                          minHeight: 44, position: 'relative'
                        }}
                          onDragOver={e => { e.preventDefault(); e.currentTarget.style.background = 'rgba(0,212,160,0.08)' }}
                          onDragLeave={e => { e.currentTarget.style.background = '' }}
                          onDrop={e => { e.preventDefault(); e.currentTarget.style.background = ''; handleDrop(w.id, hour) }}
                        >
                          {entry && (
                            <div style={{
                              position: 'absolute', left: 2, right: 2, top: 2, borderRadius: 6, padding: '4px 6px',
                              fontSize: 10, cursor: 'pointer', overflow: 'hidden',
                              background: 'rgba(0,212,160,0.1)', border: '1px solid rgba(0,212,160,0.2)',
                              height: (() => { const s = parseInt(entry.start_time); const e = parseInt(entry.end_time || s + 2); return Math.max((e - s) * 44 - 4, 36) })(),
                              zIndex: 2
                            }} onClick={() => onJobClick && onJobClick(entry.job_id)}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>
                                  {entry.jobs?.name}
                                </div>
                                <button onClick={ev => { ev.stopPropagation(); removeEntry(entry.id) }} style={{
                                  background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', fontSize: 12, padding: 0, flexShrink: 0
                                }}>×</button>
                              </div>
                              <div style={{ fontSize: 9, color: 'var(--text2)' }}>{entry.jobs?.clients?.name}</div>
                              {w.phone && (
                                <div onClick={ev => { ev.stopPropagation(); sendWhatsApp(w.phone, entry) }} style={{
                                  fontSize: 8, color: '#25D366', fontWeight: 700, marginTop: 2, cursor: 'pointer'
                                }}>💬 Send</div>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
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

        {unscheduled.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)', marginBottom: 8 }}>
              Pending — {unscheduled.length} jobs need scheduling
            </div>
            <div style={{ display: 'flex', gap: 6, overflowX: 'auto', scrollbarWidth: 'none', paddingBottom: 8 }}>
              {unscheduled.slice(0, 10).map(job => (
                <div key={job.id} onClick={() => onJobClick && onJobClick(job.id)} style={{
                  minWidth: 140, flexShrink: 0, background: 'var(--card)', border: '1px solid var(--border)',
                  borderLeft: `3px solid ${job.priority === 'emergency' ? 'var(--red)' : 'var(--primary)'}`,
                  borderRadius: 10, padding: '8px 10px', cursor: 'pointer'
                }}>
                  <div style={{ fontSize: 11, fontWeight: 600 }}>{job.name}</div>
                  <div style={{ fontSize: 9, color: 'var(--text3)', marginTop: 2 }}>{job.clients?.name}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Time picker modal */}
      {showTimeModal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16
        }} onClick={() => setShowTimeModal(null)}>
          <div onClick={e => e.stopPropagation()} style={{
            background: 'var(--card)', border: '1px solid var(--border2)',
            borderRadius: 20, padding: 24, width: '100%', maxWidth: 340
          }}>
            <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 4 }}>Schedule Job</div>
            <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 16 }}>{showTimeModal.jobName}</div>

            {/* Full day toggle */}
            <label style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px',
              background: timeForm.fullDay ? 'rgba(0,212,160,0.06)' : 'var(--bg2)',
              border: `1px solid ${timeForm.fullDay ? 'rgba(0,212,160,0.2)' : 'var(--border)'}`,
              borderRadius: 12, marginBottom: 12, cursor: 'pointer'
            }}>
              <input type="checkbox" checked={timeForm.fullDay}
                onChange={e => setTimeForm(f => ({ ...f, fullDay: e.target.checked }))}
                style={{ width: 18, height: 18, accentColor: 'var(--primary)' }} />
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: timeForm.fullDay ? 'var(--primary)' : 'var(--text)' }}>Full Day</div>
                <div style={{ fontSize: 11, color: 'var(--text3)' }}>7:00 AM — 5:00 PM</div>
              </div>
            </label>

            {!timeForm.fullDay && (
              <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
                <div style={{ flex: 1 }}>
                  <label className="form-label">Start Time</label>
                  <input type="time" className="form-input" value={timeForm.start}
                    onChange={e => setTimeForm(f => ({ ...f, start: e.target.value }))} />
                </div>
                <div style={{ flex: 1 }}>
                  <label className="form-label">End Time</label>
                  <input type="time" className="form-input" value={timeForm.end}
                    onChange={e => setTimeForm(f => ({ ...f, end: e.target.value }))} />
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={confirmSchedule} className="btn btn-primary" style={{ flex: 1, padding: 13 }}>
                Schedule
              </button>
              <button onClick={() => setShowTimeModal(null)} className="btn btn-secondary" style={{ padding: '13px 16px' }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

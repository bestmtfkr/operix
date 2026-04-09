import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useToast } from '../shared/Toast'
import { STAGE_COLORS, STAGE_LABELS, JOB_TYPE_LABELS } from '../../lib/constants'

const HOURS = ['7:00','8:00','9:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00']

export default function ScheduleView({ onJobClick }) {
  const { companyId } = useAuth()
  const showToast = useToast()
  const [allJobs, setAllJobs] = useState([])
  const [workers, setWorkers] = useState([])
  const [teams, setTeams] = useState([])
  const [unscheduled, setUnscheduled] = useState([])
  const [loading, setLoading] = useState(true)
  const [monthOffset, setMonthOffset] = useState(0)
  const [selectedDate, setSelectedDate] = useState(null) // null = month view, date string = day dispatch
  const [dragJob, setDragJob] = useState(null)
  const [showWhatsApp, setShowWhatsApp] = useState(null) // job to send

  useEffect(() => { if (companyId) loadData() }, [companyId, monthOffset])

  async function loadData() {
    const now = new Date()
    const start = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1)
    const end = new Date(now.getFullYear(), now.getMonth() + monthOffset + 1, 0, 23, 59, 59)

    const [jobsRes, workersRes, teamsRes] = await Promise.all([
      supabase.from('jobs').select('id, name, job_number, stage, job_type, priority, scheduled_start, scheduled_end, site_address, clients(name)')
        .eq('company_id', companyId).is('archived_at', null).order('scheduled_start'),
      supabase.from('workers').select('id, first_name, last_name, role, phone')
        .eq('company_id', companyId).is('archived_at', null).eq('status', 'active').order('first_name'),
      supabase.from('teams').select('*').eq('company_id', companyId)
    ])

    setAllJobs(jobsRes.data || [])
    setWorkers(workersRes.data || [])
    setTeams(teamsRes.data || [])
    setUnscheduled((jobsRes.data || []).filter(j => ['lead', 'quoted', 'active'].includes(j.stage) && !j.scheduled_start))
    setLoading(false)
  }

  const today = new Date().toISOString().split('T')[0]

  function getMonthLabel() {
    const d = new Date()
    d.setMonth(d.getMonth() + monthOffset)
    return d.toLocaleDateString('en-CA', { month: 'long', year: 'numeric' })
  }

  function getMonthGrid() {
    const now = new Date()
    const first = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1)
    const last = new Date(now.getFullYear(), now.getMonth() + monthOffset + 1, 0)
    let startPad = first.getDay() - 1; if (startPad < 0) startPad = 6
    const days = []
    const padStart = new Date(first); padStart.setDate(padStart.getDate() - startPad)
    for (let i = 0; i < 42; i++) {
      const d = new Date(padStart); d.setDate(d.getDate() + i); days.push(d)
    }
    return days
  }

  function getJobsForDate(dateStr) {
    return allJobs.filter(j => j.scheduled_start && j.scheduled_start.startsWith(dateStr))
  }

  // DAY DISPATCH
  async function handleDrop(workerId, hour) {
    if (!dragJob || !selectedDate) return
    const startTime = new Date(selectedDate + 'T' + String(hour).padStart(2, '0') + ':00:00')
    const endTime = new Date(startTime.getTime() + 2 * 3600000)

    await supabase.from('jobs').update({
      scheduled_start: startTime.toISOString(), scheduled_end: endTime.toISOString(),
      stage: dragJob.stage === 'lead' ? 'active' : dragJob.stage,
      stage_changed_at: new Date().toISOString(), updated_at: new Date().toISOString()
    }).eq('id', dragJob.id)

    // Assign worker
    const { data: existing } = await supabase.from('job_workers')
      .select('id').eq('job_id', dragJob.id).eq('worker_id', workerId).is('removed_at', null)
    if (!existing?.length) {
      await supabase.from('job_workers').insert({ company_id: companyId, job_id: dragJob.id, worker_id: workerId, role_on_job: 'crew' })
    }

    showToast(`Scheduled ${dragJob.name}`)
    setDragJob(null)
    loadData()
  }

  function generateWhatsAppMessage(job) {
    const time = job.scheduled_start ? new Date(job.scheduled_start).toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit' }) : ''
    const date = job.scheduled_start ? new Date(job.scheduled_start).toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' }) : ''
    return `📋 *Job Assignment*\n\n` +
      `*${job.name}*\n` +
      `📅 ${date} at ${time}\n` +
      `📍 ${job.site_address || 'TBD'}\n` +
      `👤 Client: ${job.clients?.name || 'TBD'}\n` +
      `🏷 ${job.job_number || ''}\n\n` +
      `Please confirm when you're on your way.`
  }

  function sendWhatsApp(phone, job) {
    const msg = encodeURIComponent(generateWhatsAppMessage(job))
    window.open(`https://wa.me/${phone.replace(/[^0-9]/g, '')}?text=${msg}`, '_blank')
  }

  if (loading) return <div className="loading-center"><div className="spinner" /></div>

  // DAY DISPATCH VIEW
  if (selectedDate) {
    const dayJobs = getJobsForDate(selectedDate)
    const dayLabel = new Date(selectedDate + 'T12:00:00').toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' })

    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* Day header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <button onClick={() => setSelectedDate(null)} style={{
            width: 30, height: 30, borderRadius: 8, background: 'var(--card)',
            border: '1px solid var(--border)', cursor: 'pointer', fontSize: 14,
            display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text2)'
          }}>←</button>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>{dayLabel}</div>
            <div style={{ fontSize: 11, color: 'var(--text3)' }}>{dayJobs.length} scheduled · {unscheduled.length} pending</div>
          </div>
        </div>

        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {/* Unscheduled sidebar */}
          <div style={{ width: 180, flexShrink: 0, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '8px 10px', fontSize: 10, fontWeight: 700, color: 'var(--text3)', letterSpacing: 0.5, borderBottom: '1px solid var(--border)' }}>
              PENDING ({unscheduled.length})
            </div>
            <div style={{ flex: 1, overflow: 'auto', padding: 6 }}>
              {unscheduled.map(job => (
                <div key={job.id} draggable onDragStart={() => setDragJob(job)} onDragEnd={() => setDragJob(null)}
                  onClick={() => onJobClick && onJobClick(job.id)}
                  style={{
                    background: 'var(--card)', border: '1px solid var(--border)',
                    borderLeft: `3px solid ${job.priority === 'emergency' ? 'var(--red)' : job.priority === 'urgent' ? 'var(--orange)' : 'var(--primary)'}`,
                    borderRadius: 8, padding: '8px', marginBottom: 4, cursor: 'grab', userSelect: 'none'
                  }}>
                  <div style={{ fontSize: 11, fontWeight: 600 }}>{job.name}</div>
                  <div style={{ fontSize: 9, color: 'var(--text3)' }}>{job.clients?.name}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Time grid */}
          <div style={{ flex: 1, overflow: 'auto' }}>
            <div style={{ minWidth: Math.max(workers.length * 120 + 50, 500) }}>
              {/* Worker headers */}
              <div style={{ display: 'grid', gridTemplateColumns: `50px repeat(${workers.length}, 1fr)`, position: 'sticky', top: 0, zIndex: 5, background: 'var(--bg)' }}>
                <div style={{ padding: 6 }} />
                {workers.map(w => (
                  <div key={w.id} style={{ padding: '8px 4px', textAlign: 'center', borderLeft: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ fontSize: 11, fontWeight: 600 }}>{w.first_name} {w.last_name?.charAt(0)}.</div>
                    <div style={{ fontSize: 9, color: 'var(--text3)' }}>{w.role}</div>
                  </div>
                ))}
              </div>

              {/* Time rows */}
              {HOURS.map(time => {
                const hour = parseInt(time)
                return (
                  <div key={time} style={{ display: 'grid', gridTemplateColumns: `50px repeat(${workers.length}, 1fr)` }}>
                    <div style={{ padding: '4px 6px', borderBottom: '1px solid var(--border)', fontSize: 9, color: 'var(--text3)' }}>{time}</div>
                    {workers.map(w => {
                      const job = dayJobs.find(j => j.scheduled_start && new Date(j.scheduled_start).getHours() === hour)
                      return (
                        <div key={w.id} style={{
                          borderLeft: '1px solid var(--border)', borderBottom: '1px solid var(--border)',
                          minHeight: 44, position: 'relative'
                        }}
                          onDragOver={e => { e.preventDefault(); e.currentTarget.style.background = 'rgba(0,212,160,0.08)' }}
                          onDragLeave={e => { e.currentTarget.style.background = '' }}
                          onDrop={e => { e.preventDefault(); e.currentTarget.style.background = ''; handleDrop(w.id, hour) }}
                        >
                          {job && new Date(job.scheduled_start).getHours() === hour && (
                            <div style={{
                              position: 'absolute', left: 2, right: 2, top: 2, borderRadius: 6, padding: '4px 6px',
                              fontSize: 10, cursor: 'pointer', overflow: 'hidden',
                              background: 'rgba(0,212,160,0.1)', border: '1px solid rgba(0,212,160,0.2)',
                              height: (() => { const dur = job.scheduled_end ? new Date(job.scheduled_end).getHours() - new Date(job.scheduled_start).getHours() : 2; return Math.max(dur * 44 - 4, 36) })(),
                              zIndex: 2
                            }} onClick={() => onJobClick && onJobClick(job.id)}>
                              <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{job.name}</div>
                              <div style={{ fontSize: 9, color: 'var(--text2)' }}>{job.clients?.name}</div>
                              {/* WhatsApp send */}
                              {w.phone && (
                                <div onClick={e => { e.stopPropagation(); sendWhatsApp(w.phone, job) }} style={{
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
  const now = new Date()
  const currentMonth = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1).getMonth()

  return (
    <div>
      {/* Month header */}
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
        {/* Day headers */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, marginBottom: 4 }}>
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => (
            <div key={d} style={{ textAlign: 'center', fontSize: 10, fontWeight: 700, color: 'var(--text3)', padding: 4 }}>{d}</div>
          ))}
        </div>

        {/* Day cells */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 3 }}>
          {monthGrid.map((day, i) => {
            const dateStr = day.toISOString().split('T')[0]
            const dayJobs = getJobsForDate(dateStr)
            const isToday = dateStr === today
            const isCurrentMonth = day.getMonth() === currentMonth

            return (
              <div key={i} onClick={() => setSelectedDate(dateStr)} style={{
                minHeight: 75, padding: 5, cursor: 'pointer',
                background: isToday ? 'rgba(0,212,160,0.06)' : 'var(--card)',
                border: `1px solid ${isToday ? 'rgba(0,212,160,0.3)' : 'var(--border)'}`,
                borderRadius: 8, opacity: isCurrentMonth ? 1 : 0.3,
                transition: 'border-color 0.15s'
              }}>
                <div style={{
                  fontSize: 12, fontWeight: isToday ? 800 : 500,
                  color: isToday ? 'var(--primary)' : 'var(--text2)', marginBottom: 3
                }}>{day.getDate()}</div>

                {dayJobs.slice(0, 3).map(job => (
                  <div key={job.id} style={{
                    fontSize: 9, fontWeight: 600, padding: '2px 4px', marginBottom: 2,
                    borderRadius: 4, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                    background: STAGE_COLORS[job.stage] + '18', color: STAGE_COLORS[job.stage]
                  }}>{job.name}</div>
                ))}
                {dayJobs.length > 3 && (
                  <div style={{ fontSize: 8, color: 'var(--text3)' }}>+{dayJobs.length - 3}</div>
                )}
                {dayJobs.length === 0 && isCurrentMonth && (
                  <div style={{ fontSize: 8, color: 'var(--text3)', marginTop: 4 }}>—</div>
                )}
              </div>
            )
          })}
        </div>

        {/* Unscheduled jobs */}
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
    </div>
  )
}

import { useEffect, useState, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useToast } from '../shared/Toast'
import { STAGE_COLORS, STAGE_LABELS, JOB_TYPE_LABELS } from '../../lib/constants'

const HOURS = ['7:00','8:00','9:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00']

export default function DispatchBoard({ onJobClick }) {
  const { companyId } = useAuth()
  const showToast = useToast()
  const [workers, setWorkers] = useState([])
  const [jobs, setJobs] = useState([])
  const [unscheduled, setUnscheduled] = useState([])
  const [dayOffset, setDayOffset] = useState(0)
  const [loading, setLoading] = useState(true)
  const [dragJob, setDragJob] = useState(null)

  useEffect(() => { if (companyId) loadData() }, [companyId, dayOffset])

  async function loadData() {
    const [workersRes, jobsRes] = await Promise.all([
      supabase.from('workers').select('id, first_name, last_name, role')
        .eq('company_id', companyId).is('archived_at', null).eq('status', 'active').order('first_name'),
      supabase.from('jobs').select('id, name, job_number, stage, job_type, priority, scheduled_start, scheduled_end, site_address, clients(name)')
        .eq('company_id', companyId).is('archived_at', null).order('created_at', { ascending: false })
    ])

    setWorkers(workersRes.data || [])

    const allJobs = jobsRes.data || []
    const targetDate = getTargetDate()
    const dateStr = targetDate.toISOString().split('T')[0]

    // Jobs scheduled for this day
    const scheduled = allJobs.filter(j => j.scheduled_start && j.scheduled_start.startsWith(dateStr))

    // Unscheduled active jobs
    const unsched = allJobs.filter(j =>
      ['lead', 'quoted', 'active'].includes(j.stage) &&
      !j.scheduled_start
    )

    setJobs(scheduled)
    setUnscheduled(unsched)
    setLoading(false)
  }

  function getTargetDate() {
    const d = new Date()
    d.setDate(d.getDate() + dayOffset)
    return d
  }

  function getDateLabel() {
    const d = getTargetDate()
    const today = new Date().toISOString().split('T')[0]
    const target = d.toISOString().split('T')[0]
    const label = d.toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric' })
    if (target === today) return 'Today — ' + label
    return label
  }

  // Get assigned workers for a job
  function getJobWorkers(jobId) {
    // For now use job_workers table if loaded, otherwise empty
    return []
  }

  // Find job at specific worker + hour
  function getJobAt(workerId, hour) {
    return jobs.find(j => {
      if (!j.scheduled_start) return false
      const startH = new Date(j.scheduled_start).getHours()
      const endH = j.scheduled_end ? new Date(j.scheduled_end).getHours() : startH + 2
      return startH <= hour && hour < endH
      // TODO: filter by worker assignment
    })
  }

  // Handle drop
  async function handleDrop(workerId, hour) {
    if (!dragJob) return

    const targetDate = getTargetDate()
    const startTime = new Date(targetDate)
    startTime.setHours(hour, 0, 0, 0)
    const endTime = new Date(startTime)
    endTime.setHours(hour + 2, 0, 0, 0)

    // Update job schedule
    const { error } = await supabase.from('jobs').update({
      scheduled_start: startTime.toISOString(),
      scheduled_end: endTime.toISOString(),
      stage: dragJob.stage === 'lead' ? 'active' : dragJob.stage,
      stage_changed_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }).eq('id', dragJob.id)

    if (error) { showToast('Error scheduling'); return }

    // Assign worker to job
    const { data: existing } = await supabase.from('job_workers')
      .select('id').eq('job_id', dragJob.id).eq('worker_id', workerId).is('removed_at', null)

    if (!existing?.length) {
      await supabase.from('job_workers').insert({
        company_id: companyId, job_id: dragJob.id, worker_id: workerId, role_on_job: 'crew'
      })
    }

    showToast(`Scheduled ${dragJob.name} at ${hour}:00`)
    setDragJob(null)
    loadData()
  }

  async function unscheduleJob(jobId) {
    await supabase.from('jobs').update({
      scheduled_start: null, scheduled_end: null, updated_at: new Date().toISOString()
    }).eq('id', jobId)
    showToast('Job unscheduled')
    loadData()
  }

  if (loading) return <div className="loading-center"><div className="spinner" /></div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px',
        borderBottom: '1px solid var(--border)', flexShrink: 0
      }}>
        <button onClick={() => setDayOffset(d => d - 1)} style={{
          width: 30, height: 30, borderRadius: 8, background: 'var(--card)',
          border: '1px solid var(--border)', cursor: 'pointer', fontSize: 16,
          display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text2)'
        }}>‹</button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{getDateLabel()}</div>
          <div style={{ fontSize: 11, color: 'var(--text3)' }}>
            {jobs.length} scheduled · {unscheduled.length} pending
          </div>
        </div>
        <button onClick={() => setDayOffset(d => d + 1)} style={{
          width: 30, height: 30, borderRadius: 8, background: 'var(--card)',
          border: '1px solid var(--border)', cursor: 'pointer', fontSize: 16,
          display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text2)'
        }}>›</button>
        {dayOffset !== 0 && (
          <button onClick={() => setDayOffset(0)} style={{
            padding: '5px 10px', borderRadius: 8, fontSize: 11, fontWeight: 700,
            background: 'rgba(0,212,160,0.1)', border: '1px solid rgba(0,212,160,0.2)',
            color: 'var(--primary)', cursor: 'pointer', fontFamily: 'DM Sans'
          }}>Today</button>
        )}
      </div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Unscheduled sidebar */}
        <div style={{
          width: 200, flexShrink: 0, borderRight: '1px solid var(--border)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden'
        }}>
          <div style={{
            padding: '10px 12px', fontSize: 11, fontWeight: 700, color: 'var(--text3)',
            letterSpacing: 0.5, borderBottom: '1px solid var(--border)', flexShrink: 0
          }}>
            PENDING ({unscheduled.length})
          </div>
          <div style={{ flex: 1, overflow: 'auto', padding: 8 }}>
            {unscheduled.length === 0 ? (
              <div style={{ padding: 16, textAlign: 'center', fontSize: 11, color: 'var(--text3)' }}>
                All jobs scheduled
              </div>
            ) : unscheduled.map(job => (
              <div key={job.id}
                draggable
                onDragStart={() => setDragJob(job)}
                onDragEnd={() => setDragJob(null)}
                onClick={() => onJobClick && onJobClick(job.id)}
                style={{
                  background: 'var(--card)', border: '1px solid var(--border)',
                  borderLeft: `3px solid ${job.priority === 'emergency' ? 'var(--red)' : job.priority === 'urgent' ? 'var(--orange)' : 'var(--primary)'}`,
                  borderRadius: 10, padding: '10px 10px', marginBottom: 6,
                  cursor: 'grab', userSelect: 'none'
                }}>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 2 }}>
                  {job.name}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text3)' }}>
                  {job.clients?.name} {job.site_address ? '· ' + job.site_address : ''}
                </div>
                {job.job_type && (
                  <div style={{ fontSize: 10, color: 'var(--text2)', marginTop: 3 }}>
                    {JOB_TYPE_LABELS[job.job_type] || job.job_type}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Schedule Grid */}
        <div style={{ flex: 1, overflow: 'auto' }}>
          <div style={{ minWidth: Math.max(workers.length * 140 + 60, 600) }}>
            {/* Worker headers */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: `60px repeat(${workers.length}, 1fr)`,
              position: 'sticky', top: 0, zIndex: 5, background: 'var(--bg)'
            }}>
              <div style={{ padding: 8 }} />
              {workers.map(w => {
                const workerJobs = jobs.filter(j => j.scheduled_start) // TODO: filter by assignment
                return (
                  <div key={w.id} style={{
                    padding: '10px 8px', textAlign: 'center',
                    borderLeft: '1px solid var(--border)',
                    borderBottom: '1px solid var(--border)'
                  }}>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>
                      {w.first_name} {w.last_name?.charAt(0)}.
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text3)' }}>{w.role}</div>
                  </div>
                )
              })}
            </div>

            {/* Time rows */}
            {HOURS.map(time => {
              const hour = parseInt(time)
              return (
                <div key={time} style={{
                  display: 'grid',
                  gridTemplateColumns: `60px repeat(${workers.length}, 1fr)`,
                }}>
                  <div style={{
                    padding: '6px 8px', borderBottom: '1px solid var(--border)',
                    fontSize: 10, color: 'var(--text3)'
                  }}>{time}</div>
                  {workers.map(w => {
                    // Find if a job starts at this hour for this worker
                    const job = jobs.find(j => {
                      if (!j.scheduled_start) return false
                      const startH = new Date(j.scheduled_start).getHours()
                      return startH === hour
                    })

                    return (
                      <div key={w.id} style={{
                        borderLeft: '1px solid var(--border)',
                        borderBottom: '1px solid var(--border)',
                        minHeight: 50, position: 'relative',
                        background: dragJob ? 'rgba(0,212,160,0.02)' : 'transparent'
                      }}
                        onDragOver={e => { e.preventDefault(); e.currentTarget.style.background = 'rgba(0,212,160,0.08)' }}
                        onDragLeave={e => { e.currentTarget.style.background = '' }}
                        onDrop={e => { e.preventDefault(); e.currentTarget.style.background = ''; handleDrop(w.id, hour) }}
                      >
                        {job && new Date(job.scheduled_start).getHours() === hour && (
                          <div onClick={() => onJobClick && onJobClick(job.id)} style={{
                            position: 'absolute', left: 3, right: 3, top: 3,
                            borderRadius: 8, padding: '6px 8px', cursor: 'pointer',
                            fontSize: 11, overflow: 'hidden',
                            background: job.priority === 'emergency' ? 'rgba(255,59,92,0.12)' :
                              job.priority === 'urgent' ? 'rgba(255,107,53,0.12)' :
                              'rgba(0,212,160,0.1)',
                            border: `1px solid ${job.priority === 'emergency' ? 'rgba(255,59,92,0.3)' :
                              job.priority === 'urgent' ? 'rgba(255,107,53,0.3)' :
                              'rgba(0,212,160,0.2)'}`,
                            height: (() => {
                              const dur = job.scheduled_end ? (new Date(job.scheduled_end).getHours() - new Date(job.scheduled_start).getHours()) : 2
                              return Math.max(dur * 50 - 6, 40)
                            })(),
                            zIndex: 2
                          }}>
                            <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {job.name}
                            </div>
                            <div style={{ fontSize: 10, color: 'var(--text2)', marginTop: 1 }}>
                              {job.clients?.name}
                            </div>
                            <div style={{ fontSize: 9, color: 'var(--text3)', marginTop: 1 }}>
                              {job.job_number}
                            </div>
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

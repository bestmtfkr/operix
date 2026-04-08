import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { STAGE_COLORS, STAGE_LABELS } from '../../lib/constants'

export default function CalendarView({ onJobClick }) {
  const { companyId } = useAuth()
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [weekOffset, setWeekOffset] = useState(0)

  useEffect(() => { if (companyId) loadJobs() }, [companyId, weekOffset])

  async function loadJobs() {
    const startOfWeek = getWeekStart(weekOffset)
    const endOfWeek = new Date(startOfWeek)
    endOfWeek.setDate(endOfWeek.getDate() + 7)

    const { data } = await supabase.from('jobs')
      .select('id, name, job_number, stage, scheduled_start, scheduled_end, site_address, clients(name)')
      .eq('company_id', companyId)
      .is('archived_at', null)
      .gte('scheduled_start', startOfWeek.toISOString())
      .lt('scheduled_start', endOfWeek.toISOString())
      .order('scheduled_start')

    setJobs(data || [])
    setLoading(false)
  }

  function getWeekStart(offset) {
    const d = new Date()
    d.setDate(d.getDate() - d.getDay() + 1 + offset * 7) // Monday
    d.setHours(0, 0, 0, 0)
    return d
  }

  const weekStart = getWeekStart(weekOffset)
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart)
    d.setDate(d.getDate() + i)
    return d
  })

  const today = new Date().toISOString().split('T')[0]
  const weekLabel = weekStart.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }) + ' — ' +
    days[6].toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })

  function getJobsForDay(date) {
    const dateStr = date.toISOString().split('T')[0]
    return jobs.filter(j => j.scheduled_start && j.scheduled_start.startsWith(dateStr))
  }

  return (
    <div>
      {/* Week Navigation */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 16px'
      }}>
        <button onClick={() => setWeekOffset(w => w - 1)} style={{
          background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10,
          width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', fontSize: 16, color: 'var(--text2)'
        }}>←</button>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{weekLabel}</div>
          {weekOffset !== 0 && (
            <div style={{ fontSize: 11, color: 'var(--primary)', cursor: 'pointer', marginTop: 2 }}
              onClick={() => setWeekOffset(0)}>Back to this week</div>
          )}
        </div>
        <button onClick={() => setWeekOffset(w => w + 1)} style={{
          background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10,
          width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', fontSize: 16, color: 'var(--text2)'
        }}>→</button>
      </div>

      {/* Day Columns */}
      {loading ? (
        <div className="loading-center"><div className="spinner" /></div>
      ) : (
        <div style={{ padding: '0 16px' }}>
          {days.map(day => {
            const dateStr = day.toISOString().split('T')[0]
            const dayJobs = getJobsForDay(day)
            const isToday = dateStr === today
            const dayName = day.toLocaleDateString('en-CA', { weekday: 'short' })
            const dayNum = day.getDate()

            return (
              <div key={dateStr} style={{ marginBottom: 8 }}>
                {/* Day Header */}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0',
                  borderBottom: '1px solid var(--border)'
                }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: 10,
                    background: isToday ? 'var(--primary)' : 'var(--card)',
                    border: isToday ? 'none' : '1px solid var(--border)',
                    color: isToday ? '#000' : 'var(--text)',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    fontSize: 14, fontWeight: 800, lineHeight: 1
                  }}>
                    {dayNum}
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: isToday ? 'var(--primary)' : 'var(--text)' }}>{dayName}</div>
                    <div style={{ fontSize: 11, color: 'var(--text3)' }}>{dayJobs.length} job{dayJobs.length !== 1 ? 's' : ''}</div>
                  </div>
                </div>

                {/* Jobs */}
                {dayJobs.length === 0 ? (
                  <div style={{ padding: '8px 0 4px 46px', fontSize: 12, color: 'var(--text3)' }}>No jobs scheduled</div>
                ) : (
                  dayJobs.map(job => {
                    const time = new Date(job.scheduled_start).toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit' })
                    return (
                      <div key={job.id} style={{
                        marginLeft: 46, marginTop: 6, padding: '10px 14px',
                        background: 'var(--card)', border: '1px solid var(--border)',
                        borderLeft: `3px solid ${STAGE_COLORS[job.stage]}`,
                        borderRadius: '0 12px 12px 0', cursor: 'pointer'
                      }} onClick={() => onJobClick && onJobClick(job.id)}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 700 }}>{job.name}</div>
                            <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2 }}>
                              {job.clients?.name} {job.site_address ? '· ' + job.site_address : ''}
                            </div>
                          </div>
                          <div style={{ textAlign: 'right', flexShrink: 0 }}>
                            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--primary)' }}>{time}</div>
                            <div style={{ fontSize: 10, color: STAGE_COLORS[job.stage] }}>{STAGE_LABELS[job.stage]}</div>
                          </div>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { STAGE_COLORS, STAGE_LABELS } from '../../lib/constants'

export default function CalendarView({ onJobClick }) {
  const { companyId } = useAuth()
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [offset, setOffset] = useState(0)
  const [mode, setMode] = useState(localStorage.getItem('operix_cal_mode') || 'week')

  function switchMode(m) {
    setMode(m)
    localStorage.setItem('operix_cal_mode', m)
    setOffset(0)
  }

  useEffect(() => { if (companyId) loadJobs() }, [companyId, offset, mode])

  async function loadJobs() {
    const { start, end } = getDateRange()
    const { data } = await supabase.from('jobs')
      .select('id, name, job_number, stage, scheduled_start, scheduled_end, site_address, priority, clients(name)')
      .eq('company_id', companyId).is('archived_at', null)
      .gte('scheduled_start', start.toISOString())
      .lt('scheduled_start', end.toISOString())
      .order('scheduled_start')
    setJobs(data || [])
    setLoading(false)
  }

  function getDateRange() {
    if (mode === 'week') {
      const d = new Date()
      d.setDate(d.getDate() - d.getDay() + 1 + offset * 7)
      d.setHours(0, 0, 0, 0)
      const end = new Date(d)
      end.setDate(end.getDate() + 7)
      return { start: d, end }
    } else {
      const now = new Date()
      const start = new Date(now.getFullYear(), now.getMonth() + offset, 1)
      const end = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0, 23, 59, 59)
      return { start, end }
    }
  }

  function getLabel() {
    const { start, end } = getDateRange()
    if (mode === 'week') {
      const endDate = new Date(end)
      endDate.setDate(endDate.getDate() - 1)
      return start.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }) + ' — ' +
        endDate.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })
    }
    return start.toLocaleDateString('en-CA', { month: 'long', year: 'numeric' })
  }

  function getJobsForDate(dateStr) {
    return jobs.filter(j => j.scheduled_start && j.scheduled_start.startsWith(dateStr))
  }

  const today = new Date().toISOString().split('T')[0]

  // Generate days
  function getDays() {
    const { start, end } = getDateRange()
    const days = []
    const d = new Date(start)
    while (d < end) {
      days.push(new Date(d))
      d.setDate(d.getDate() + 1)
    }
    return days
  }

  // For month view, pad to start on Monday
  function getMonthGrid() {
    const { start } = getDateRange()
    const firstDay = new Date(start.getFullYear(), start.getMonth(), 1)
    const lastDay = new Date(start.getFullYear(), start.getMonth() + 1, 0)

    // Pad start to Monday
    let startPad = firstDay.getDay() - 1
    if (startPad < 0) startPad = 6

    const days = []
    const padStart = new Date(firstDay)
    padStart.setDate(padStart.getDate() - startPad)

    for (let i = 0; i < 42; i++) {
      const d = new Date(padStart)
      d.setDate(d.getDate() + i)
      days.push(d)
      if (i >= 28 && d.getMonth() !== start.getMonth() && d.getDay() === 1) break
    }
    // Ensure we have full weeks
    while (days.length % 7 !== 0) {
      const last = new Date(days[days.length - 1])
      last.setDate(last.getDate() + 1)
      days.push(last)
    }
    return days
  }

  if (loading) return <div className="loading-center"><div className="spinner" /></div>

  return (
    <div>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px',
        borderBottom: '1px solid var(--border)'
      }}>
        <button onClick={() => setOffset(o => o - 1)} style={{
          width: 30, height: 30, borderRadius: 8, background: 'var(--card)',
          border: '1px solid var(--border)', cursor: 'pointer', fontSize: 16,
          display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text2)'
        }}>‹</button>
        <div style={{ flex: 1, fontSize: 14, fontWeight: 700 }}>{getLabel()}</div>
        <button onClick={() => setOffset(o => o + 1)} style={{
          width: 30, height: 30, borderRadius: 8, background: 'var(--card)',
          border: '1px solid var(--border)', cursor: 'pointer', fontSize: 16,
          display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text2)'
        }}>›</button>
        {offset !== 0 && (
          <button onClick={() => setOffset(0)} style={{
            padding: '5px 10px', borderRadius: 8, fontSize: 11, fontWeight: 700,
            background: 'rgba(0,212,160,0.1)', border: '1px solid rgba(0,212,160,0.2)',
            color: 'var(--primary)', cursor: 'pointer', fontFamily: 'DM Sans'
          }}>Today</button>
        )}
        {/* Mode toggle */}
        <div style={{ display: 'flex', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
          <button onClick={() => switchMode('week')} style={{
            padding: '5px 10px', fontSize: 10, fontWeight: 700, border: 'none', cursor: 'pointer', fontFamily: 'DM Sans',
            background: mode === 'week' ? 'rgba(0,212,160,0.1)' : 'transparent',
            color: mode === 'week' ? 'var(--primary)' : 'var(--text3)'
          }}>Week</button>
          <button onClick={() => switchMode('month')} style={{
            padding: '5px 10px', fontSize: 10, fontWeight: 700, border: 'none', cursor: 'pointer', fontFamily: 'DM Sans',
            background: mode === 'month' ? 'rgba(0,212,160,0.1)' : 'transparent',
            color: mode === 'month' ? 'var(--primary)' : 'var(--text3)'
          }}>Month</button>
        </div>
      </div>

      {mode === 'week' ? (
        /* WEEK VIEW */
        <div style={{ padding: '0 16px' }}>
          {getDays().map(day => {
            const dateStr = day.toISOString().split('T')[0]
            const dayJobs = getJobsForDate(dateStr)
            const isToday = dateStr === today

            return (
              <div key={dateStr} style={{ marginBottom: 6 }}>
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
                    {day.getDate()}
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: isToday ? 'var(--primary)' : 'var(--text)' }}>
                      {day.toLocaleDateString('en-CA', { weekday: 'short' })}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text3)' }}>{dayJobs.length} job{dayJobs.length !== 1 ? 's' : ''}</div>
                  </div>
                </div>

                {dayJobs.length === 0 ? (
                  <div style={{ padding: '8px 0 4px 46px', fontSize: 12, color: 'var(--text3)' }}>No jobs</div>
                ) : dayJobs.map(job => {
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
                })}
              </div>
            )
          })}
        </div>
      ) : (
        /* MONTH VIEW — Grid */
        <div style={{ padding: '8px 16px' }}>
          {/* Day headers */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, marginBottom: 4 }}>
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => (
              <div key={d} style={{ textAlign: 'center', fontSize: 10, fontWeight: 700, color: 'var(--text3)', padding: 4 }}>{d}</div>
            ))}
          </div>

          {/* Day cells */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
            {getMonthGrid().map((day, i) => {
              const dateStr = day.toISOString().split('T')[0]
              const dayJobs = getJobsForDate(dateStr)
              const isToday = dateStr === today
              const { start } = getDateRange()
              const isCurrentMonth = day.getMonth() === start.getMonth()

              return (
                <div key={i} style={{
                  minHeight: 70, padding: 4,
                  background: isToday ? 'rgba(0,212,160,0.06)' : 'var(--card)',
                  border: `1px solid ${isToday ? 'rgba(0,212,160,0.2)' : 'var(--border)'}`,
                  borderRadius: 8,
                  opacity: isCurrentMonth ? 1 : 0.35
                }}>
                  <div style={{
                    fontSize: 11, fontWeight: isToday ? 800 : 500,
                    color: isToday ? 'var(--primary)' : 'var(--text2)',
                    marginBottom: 3
                  }}>{day.getDate()}</div>

                  {dayJobs.slice(0, 3).map(job => (
                    <div key={job.id} onClick={() => onJobClick && onJobClick(job.id)} style={{
                      fontSize: 9, fontWeight: 600, padding: '2px 4px', marginBottom: 2,
                      borderRadius: 4, cursor: 'pointer', overflow: 'hidden',
                      whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                      background: STAGE_COLORS[job.stage] + '18',
                      color: STAGE_COLORS[job.stage]
                    }}>{job.name}</div>
                  ))}
                  {dayJobs.length > 3 && (
                    <div style={{ fontSize: 9, color: 'var(--text3)', padding: '0 4px' }}>+{dayJobs.length - 3} more</div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { STAGE_LABELS, STAGE_COLORS, JOB_STAGES } from '../../lib/constants'

export default function Dashboard({ onNavigate }) {
  const { companyId } = useAuth()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => { if (companyId) loadDashboard() }, [companyId])

  async function loadDashboard() {
    const [jobsRes, clientsRes, invoicesRes, workersRes, tasksRes, timeRes, activityRes] = await Promise.all([
      supabase.from('jobs').select('id, name, stage, estimated_value, client_id, created_at, clients(name)')
        .eq('company_id', companyId).is('archived_at', null).order('created_at', { ascending: false }),
      supabase.from('clients').select('id').eq('company_id', companyId).is('archived_at', null),
      supabase.from('invoices').select('id, status, total, amount_due, amount_paid, created_at')
        .eq('company_id', companyId).is('archived_at', null),
      supabase.from('workers').select('id, status, first_name, last_name')
        .eq('company_id', companyId).is('archived_at', null),
      supabase.from('tasks').select('id, title, due_date, status, priority')
        .eq('company_id', companyId).in('status', ['todo', 'in_progress']).order('due_date'),
      supabase.from('time_entries').select('id, total_hours, hourly_rate_at_time, date')
        .eq('company_id', companyId).order('date', { ascending: false }).limit(100),
      supabase.from('job_activity').select('id, type, content, created_at, jobs(name, job_number)')
        .eq('company_id', companyId).order('created_at', { ascending: false }).limit(10)
    ])

    const jobs = jobsRes.data || []
    const invoices = invoicesRes.data || []
    const workers = workersRes.data || []
    const tasks = tasksRes.data || []
    const timeEntries = timeRes.data || []
    const today = new Date().toISOString().split('T')[0]

    // Revenue calculations
    const totalRevenue = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + parseFloat(i.total || 0), 0)
    const totalPending = invoices.filter(i => ['sent', 'viewed', 'partial', 'draft'].includes(i.status)).reduce((s, i) => s + parseFloat(i.amount_due || 0), 0)
    const totalOverdue = invoices.filter(i => i.status === 'overdue').reduce((s, i) => s + parseFloat(i.amount_due || 0), 0)

    // Pipeline
    const pipelineJobs = jobs.filter(j => !['closed', 'invoiced'].includes(j.stage))
    const pipelineValue = pipelineJobs.reduce((s, j) => s + (parseFloat(j.estimated_value) || 0), 0)

    // Pipeline breakdown by stage
    const stageBreakdown = JOB_STAGES.map(s => ({
      stage: s, count: jobs.filter(j => j.stage === s).length,
      value: jobs.filter(j => j.stage === s).reduce((sum, j) => sum + (parseFloat(j.estimated_value) || 0), 0)
    }))

    // Time this week
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0]
    const weekEntries = timeEntries.filter(e => e.date >= weekAgo)
    const hoursThisWeek = weekEntries.reduce((s, e) => s + (parseFloat(e.total_hours) || 0), 0)
    const laborCostThisWeek = weekEntries.reduce((s, e) => s + ((parseFloat(e.total_hours) || 0) * (parseFloat(e.hourly_rate_at_time) || 0)), 0)

    // Tasks due
    const tasksDueToday = tasks.filter(t => t.due_date && t.due_date <= today)
    const urgentTasks = tasks.filter(t => t.priority === 'urgent')

    setData({
      jobs, invoices, workers, tasks, timeEntries,
      totalRevenue, totalPending, totalOverdue,
      pipelineValue, pipelineJobs, stageBreakdown,
      hoursThisWeek, laborCostThisWeek,
      tasksDueToday, urgentTasks,
      totalClients: (clientsRes.data || []).length,
      recentActivity: activityRes.data || []
    })
    setLoading(false)
  }

  function fmt(n) {
    if (n >= 1000000) return '$' + (n / 1000000).toFixed(1) + 'M'
    if (n >= 1000) return '$' + (n / 1000).toFixed(1) + 'K'
    return '$' + Math.round(n)
  }

  if (loading) return <div className="loading-center"><div className="spinner" /></div>
  if (!data) return null

  const maxStageVal = Math.max(...data.stageBreakdown.map(s => s.value), 1)

  return (
    <div>
      {/* Revenue Cards */}
      <div className="stat-grid">
        <div className="stat-card c-green">
          <div className="stat-label">Revenue</div>
          <div className="stat-val" style={{ color: 'var(--green)' }}>{fmt(data.totalRevenue)}</div>
          <div className="stat-sub">Collected</div>
        </div>
        <div className="stat-card c-blue">
          <div className="stat-label">Pipeline</div>
          <div className="stat-val" style={{ color: 'var(--blue)' }}>{fmt(data.pipelineValue)}</div>
          <div className="stat-sub">{data.pipelineJobs.length} active jobs</div>
        </div>
        <div className="stat-card c-yellow">
          <div className="stat-label">Pending</div>
          <div className="stat-val" style={{ color: 'var(--yellow)' }}>{fmt(data.totalPending)}</div>
          <div className="stat-sub">Awaiting payment</div>
        </div>
        <div className="stat-card c-red">
          <div className="stat-label">Overdue</div>
          <div className="stat-val" style={{ color: 'var(--red)' }}>{fmt(data.totalOverdue)}</div>
          <div className="stat-sub">{data.invoices.filter(i => i.status === 'overdue').length} invoices</div>
        </div>
      </div>

      {/* Pipeline Breakdown */}
      <div className="sec">
        <div className="sec-hdr">
          <div className="sec-title">Pipeline Breakdown</div>
          <div className="sec-more" onClick={() => onNavigate('jobs')}>View pipeline</div>
        </div>
        <div className="card" style={{ cursor: 'default' }}>
          {data.stageBreakdown.filter(s => s.count > 0).map(s => (
            <div key={s.stage} style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: STAGE_COLORS[s.stage] }} />
                  <span style={{ fontSize: 12, fontWeight: 700 }}>{STAGE_LABELS[s.stage]}</span>
                  <span style={{ fontSize: 11, color: 'var(--text3)' }}>({s.count})</span>
                </div>
                <span style={{ fontSize: 12, fontWeight: 700, color: STAGE_COLORS[s.stage] }}>{fmt(s.value)}</span>
              </div>
              <div style={{ height: 4, background: 'var(--bg2)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{
                  height: '100%', borderRadius: 2, background: STAGE_COLORS[s.stage],
                  width: `${Math.max((s.value / maxStageVal) * 100, 2)}%`, transition: 'width 0.5s'
                }} />
              </div>
            </div>
          ))}
          {data.stageBreakdown.every(s => s.count === 0) && (
            <div style={{ color: 'var(--text3)', fontSize: 13, textAlign: 'center', padding: 8 }}>No jobs yet</div>
          )}
        </div>
      </div>

      {/* This Week */}
      <div className="sec">
        <div className="sec-hdr"><div className="sec-title">This Week</div></div>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 14, textAlign: 'center' }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--primary)' }}>{data.hoursThisWeek.toFixed(1)}h</div>
            <div style={{ fontSize: 9, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 }}>Hours Logged</div>
          </div>
          <div style={{ flex: 1, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 14, textAlign: 'center' }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--blue)' }}>{fmt(data.laborCostThisWeek)}</div>
            <div style={{ fontSize: 9, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 }}>Labor Cost</div>
          </div>
          <div style={{ flex: 1, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 14, textAlign: 'center' }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--yellow)' }}>{data.totalClients}</div>
            <div style={{ fontSize: 9, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 }}>Clients</div>
          </div>
        </div>
      </div>

      {/* Urgent Tasks */}
      {(data.tasksDueToday.length > 0 || data.urgentTasks.length > 0) && (
        <div className="sec">
          <div className="sec-hdr">
            <div className="sec-title">⚡ Needs Attention</div>
            <div className="sec-more" onClick={() => onNavigate('jobs')}>See tasks</div>
          </div>
          {[...data.urgentTasks, ...data.tasksDueToday.filter(t => t.priority !== 'urgent')].slice(0, 4).map(t => (
            <div key={t.id} style={{
              background: t.priority === 'urgent' ? 'rgba(255,59,92,0.04)' : 'rgba(255,184,0,0.04)',
              border: `1px solid ${t.priority === 'urgent' ? 'rgba(255,59,92,0.15)' : 'rgba(255,184,0,0.15)'}`,
              borderRadius: 14, padding: '12px 16px', marginBottom: 8,
              display: 'flex', alignItems: 'center', gap: 12
            }}>
              <span style={{ fontSize: 20 }}>{t.priority === 'urgent' ? '🔴' : '📅'}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{t.title}</div>
                {t.due_date && <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>Due: {t.due_date}</div>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Recent Jobs */}
      <div className="sec">
        <div className="sec-hdr">
          <div className="sec-title">Recent Jobs</div>
          <div className="sec-more" onClick={() => onNavigate('jobs')}>See all</div>
        </div>
        {data.jobs.length === 0 ? (
          <div style={{ color: 'var(--text3)', fontSize: 13, padding: '8px 0' }}>
            No jobs yet. Create your first job to get started.
          </div>
        ) : (
          data.jobs.slice(0, 5).map(job => (
            <div key={job.id} className="card" onClick={() => onNavigate('jobs')}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>{job.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>{job.clients?.name}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {job.estimated_value && <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--primary)' }}>{fmt(parseFloat(job.estimated_value))}</span>}
                  <span className="badge" style={{ background: STAGE_COLORS[job.stage] + '18', color: STAGE_COLORS[job.stage] }}>
                    {STAGE_LABELS[job.stage]}
                  </span>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Recent Activity */}
      {data.recentActivity.length > 0 && (
        <div className="sec">
          <div className="sec-hdr"><div className="sec-title">Recent Activity</div></div>
          {data.recentActivity.map(a => (
            <div key={a.id} style={{
              padding: '10px 0', borderBottom: '1px solid var(--border)',
              display: 'flex', gap: 10, alignItems: 'flex-start'
            }}>
              <span style={{ fontSize: 16 }}>
                {a.type === 'status_change' ? '🔄' : a.type === 'photo' ? '📷' : '📝'}
              </span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.5 }}>{a.content}</div>
                <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>
                  {a.jobs?.job_number ? a.jobs.job_number + ' · ' : ''}
                  {new Date(a.created_at).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

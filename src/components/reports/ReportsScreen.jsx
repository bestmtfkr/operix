import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { STAGE_LABELS, STAGE_COLORS, JOB_STAGES } from '../../lib/constants'

export default function ReportsScreen() {
  const { companyId } = useAuth()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState('all') // all, month, week

  useEffect(() => { if (companyId) loadReports() }, [companyId, period])

  async function loadReports() {
    setLoading(true)
    const [jobsRes, invoicesRes, clientsRes, workersRes, timeRes] = await Promise.all([
      supabase.from('jobs').select('id, name, stage, estimated_value, job_type, client_id, created_at, clients(name)')
        .eq('company_id', companyId).is('archived_at', null),
      supabase.from('invoices').select('id, invoice_number, status, total, amount_due, amount_paid, created_at, client_id, clients(name)')
        .eq('company_id', companyId).is('archived_at', null),
      supabase.from('clients').select('id, name, created_at')
        .eq('company_id', companyId).is('archived_at', null),
      supabase.from('workers').select('id, first_name, last_name, hourly_rate, status')
        .eq('company_id', companyId).is('archived_at', null),
      supabase.from('time_entries').select('id, worker_id, job_id, total_hours, hourly_rate_at_time, date, workers(first_name, last_name), jobs(name)')
        .eq('company_id', companyId)
    ])

    const jobs = jobsRes.data || []
    const invoices = invoicesRes.data || []
    const clients = clientsRes.data || []
    const workers = workersRes.data || []
    const timeEntries = timeRes.data || []

    // Filter by period
    let filterDate = null
    if (period === 'month') filterDate = new Date(Date.now() - 30 * 86400000).toISOString()
    if (period === 'week') filterDate = new Date(Date.now() - 7 * 86400000).toISOString()

    const filteredInvoices = filterDate ? invoices.filter(i => i.created_at >= filterDate) : invoices
    const filteredTime = filterDate ? timeEntries.filter(t => t.date >= filterDate.split('T')[0]) : timeEntries
    const filteredJobs = filterDate ? jobs.filter(j => j.created_at >= filterDate) : jobs

    // Revenue
    const totalRevenue = filteredInvoices.filter(i => i.status === 'paid').reduce((s, i) => s + parseFloat(i.total || 0), 0)
    const totalPending = filteredInvoices.filter(i => ['sent', 'viewed', 'partial', 'draft'].includes(i.status)).reduce((s, i) => s + parseFloat(i.amount_due || 0), 0)
    const totalOverdue = filteredInvoices.filter(i => i.status === 'overdue').reduce((s, i) => s + parseFloat(i.amount_due || 0), 0)

    // Revenue by client
    const revenueByClient = {}
    invoices.filter(i => i.status === 'paid').forEach(i => {
      const name = i.clients?.name || 'Unknown'
      revenueByClient[name] = (revenueByClient[name] || 0) + parseFloat(i.total || 0)
    })
    const topClients = Object.entries(revenueByClient)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)

    // Jobs by type
    const jobsByType = {}
    jobs.forEach(j => {
      const t = j.job_type || 'unset'
      jobsByType[t] = (jobsByType[t] || 0) + 1
    })

    // Worker productivity
    const workerHours = {}
    filteredTime.forEach(e => {
      const name = e.workers ? `${e.workers.first_name} ${e.workers.last_name}` : 'Unknown'
      if (!workerHours[name]) workerHours[name] = { hours: 0, cost: 0 }
      workerHours[name].hours += parseFloat(e.total_hours || 0)
      workerHours[name].cost += (parseFloat(e.total_hours || 0) * (parseFloat(e.hourly_rate_at_time) || 0))
    })
    const topWorkers = Object.entries(workerHours)
      .sort((a, b) => b[1].hours - a[1].hours)
      .slice(0, 8)

    // Total hours and cost
    const totalHours = filteredTime.reduce((s, e) => s + (parseFloat(e.total_hours) || 0), 0)
    const totalLaborCost = filteredTime.reduce((s, e) => s + ((parseFloat(e.total_hours) || 0) * (parseFloat(e.hourly_rate_at_time) || 0)), 0)

    // Pipeline value by stage
    const pipelineByStage = JOB_STAGES.map(s => ({
      stage: s,
      count: jobs.filter(j => j.stage === s).length,
      value: jobs.filter(j => j.stage === s).reduce((sum, j) => sum + (parseFloat(j.estimated_value) || 0), 0)
    }))

    // Invoice aging
    const aging = {
      current: invoices.filter(i => ['sent', 'viewed'].includes(i.status)).reduce((s, i) => s + parseFloat(i.amount_due || 0), 0),
      thirtyDays: 0, sixtyDays: 0, ninetyPlus: 0
    }
    const now = Date.now()
    invoices.filter(i => i.status === 'overdue').forEach(i => {
      const dueDate = new Date(i.due_date || i.created_at).getTime()
      const daysOverdue = Math.floor((now - dueDate) / 86400000)
      const amt = parseFloat(i.amount_due || 0)
      if (daysOverdue <= 30) aging.thirtyDays += amt
      else if (daysOverdue <= 60) aging.sixtyDays += amt
      else aging.ninetyPlus += amt
    })

    setData({
      totalRevenue, totalPending, totalOverdue, totalHours, totalLaborCost,
      topClients, topWorkers, jobsByType, pipelineByStage, aging,
      jobCount: filteredJobs.length, invoiceCount: filteredInvoices.length,
      clientCount: clients.length, workerCount: workers.length,
      profitMargin: totalRevenue > 0 ? ((totalRevenue - totalLaborCost) / totalRevenue * 100) : 0
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

  const maxClientRev = Math.max(...data.topClients.map(c => c[1]), 1)
  const maxWorkerHrs = Math.max(...data.topWorkers.map(w => w[1].hours), 1)

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Reports</div>
          <div className="page-subtitle">Business analytics</div>
        </div>
      </div>

      {/* Period Toggle */}
      <div style={{ display: 'flex', gap: 8, padding: '0 16px 8px' }}>
        {[{ id: 'week', label: 'This Week' }, { id: 'month', label: 'This Month' }, { id: 'all', label: 'All Time' }].map(p => (
          <div key={p.id} onClick={() => setPeriod(p.id)} style={{
            padding: '6px 14px', borderRadius: 10, fontSize: 12, fontWeight: 700,
            cursor: 'pointer',
            border: `1px solid ${period === p.id ? 'rgba(0,212,160,0.3)' : 'var(--border)'}`,
            background: period === p.id ? 'rgba(0,212,160,0.1)' : 'var(--card)',
            color: period === p.id ? 'var(--primary)' : 'var(--text2)'
          }}>{p.label}</div>
        ))}
      </div>

      {/* Summary Cards */}
      <div className="stat-grid">
        <div className="stat-card c-green">
          <div className="stat-label">Revenue</div>
          <div className="stat-val" style={{ color: 'var(--green)', fontSize: 28 }}>{fmt(data.totalRevenue)}</div>
        </div>
        <div className="stat-card c-blue">
          <div className="stat-label">Labor Cost</div>
          <div className="stat-val" style={{ color: 'var(--blue)', fontSize: 28 }}>{fmt(data.totalLaborCost)}</div>
        </div>
        <div className="stat-card c-yellow">
          <div className="stat-label">Profit Margin</div>
          <div className="stat-val" style={{ color: data.profitMargin > 30 ? 'var(--green)' : data.profitMargin > 0 ? 'var(--yellow)' : 'var(--red)', fontSize: 28 }}>
            {data.profitMargin.toFixed(0)}%
          </div>
        </div>
        <div className="stat-card c-red">
          <div className="stat-label">Hours Logged</div>
          <div className="stat-val" style={{ color: 'var(--primary)', fontSize: 28 }}>{data.totalHours.toFixed(0)}h</div>
        </div>
      </div>

      {/* Revenue by Client */}
      {data.topClients.length > 0 && (
        <div className="sec">
          <div className="sec-hdr"><div className="sec-title">Revenue by Client</div></div>
          <div className="card" style={{ cursor: 'default' }}>
            {data.topClients.map(([name, amount], i) => (
              <div key={name} style={{ marginBottom: i < data.topClients.length - 1 ? 14 : 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{name}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--primary)' }}>{fmt(amount)}</span>
                </div>
                <div style={{ height: 6, background: 'var(--bg2)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ height: '100%', borderRadius: 3, background: 'linear-gradient(90deg, var(--primary), var(--primary2))', width: `${(amount / maxClientRev) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Worker Productivity */}
      {data.topWorkers.length > 0 && (
        <div className="sec">
          <div className="sec-hdr"><div className="sec-title">Worker Productivity</div></div>
          <div className="card" style={{ cursor: 'default' }}>
            {data.topWorkers.map(([name, { hours, cost }], i) => (
              <div key={name} style={{ marginBottom: i < data.topWorkers.length - 1 ? 14 : 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{name}</span>
                  <div style={{ display: 'flex', gap: 12 }}>
                    <span style={{ fontSize: 12, color: 'var(--primary)', fontWeight: 700 }}>{hours.toFixed(1)}h</span>
                    <span style={{ fontSize: 12, color: 'var(--text3)' }}>{fmt(cost)}</span>
                  </div>
                </div>
                <div style={{ height: 6, background: 'var(--bg2)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ height: '100%', borderRadius: 3, background: 'linear-gradient(90deg, var(--blue), var(--purple))', width: `${(hours / maxWorkerHrs) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Invoice Aging */}
      <div className="sec">
        <div className="sec-hdr"><div className="sec-title">Invoice Aging (AR)</div></div>
        <div className="card" style={{ cursor: 'default' }}>
          <div style={{ display: 'flex', justifyContent: 'space-around', textAlign: 'center' }}>
            <div>
              <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--green)' }}>{fmt(data.aging.current)}</div>
              <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2, textTransform: 'uppercase' }}>Current</div>
            </div>
            <div>
              <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--yellow)' }}>{fmt(data.aging.thirtyDays)}</div>
              <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2, textTransform: 'uppercase' }}>1-30 Days</div>
            </div>
            <div>
              <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--orange)' }}>{fmt(data.aging.sixtyDays)}</div>
              <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2, textTransform: 'uppercase' }}>31-60 Days</div>
            </div>
            <div>
              <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--red)' }}>{fmt(data.aging.ninetyPlus)}</div>
              <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2, textTransform: 'uppercase' }}>90+ Days</div>
            </div>
          </div>
        </div>
      </div>

      {/* Pipeline Value by Stage */}
      <div className="sec">
        <div className="sec-hdr"><div className="sec-title">Pipeline by Stage</div></div>
        <div className="card" style={{ cursor: 'default' }}>
          {data.pipelineByStage.filter(s => s.count > 0).map(s => (
            <div key={s.stage} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: STAGE_COLORS[s.stage] }} />
                <span style={{ fontSize: 13, fontWeight: 600 }}>{STAGE_LABELS[s.stage]}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 12, color: 'var(--text3)' }}>{s.count} jobs</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: STAGE_COLORS[s.stage] }}>{fmt(s.value)}</span>
              </div>
            </div>
          ))}
          {data.pipelineByStage.every(s => s.count === 0) && (
            <div style={{ color: 'var(--text3)', fontSize: 13, textAlign: 'center', padding: 16 }}>No pipeline data yet</div>
          )}
        </div>
      </div>

      {/* Quick Numbers */}
      <div className="sec">
        <div className="sec-hdr"><div className="sec-title">Totals</div></div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {[
            { label: 'Jobs', val: data.jobCount, color: 'var(--primary)' },
            { label: 'Invoices', val: data.invoiceCount, color: 'var(--blue)' },
            { label: 'Clients', val: data.clientCount, color: 'var(--yellow)' },
            { label: 'Workers', val: data.workerCount, color: 'var(--purple)' },
          ].map(s => (
            <div key={s.label} style={{ flex: 1, minWidth: 70, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: 14, textAlign: 'center' }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: s.color }}>{s.val}</div>
              <div style={{ fontSize: 9, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

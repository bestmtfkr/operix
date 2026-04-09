import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'

export default function JobCostSummary({ jobId }) {
  const { companyId, profile } = useAuth()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadCosts() }, [jobId])

  async function loadCosts() {
    const [clockRes, timeRes, equipRes, receiptsRes, invoicesRes] = await Promise.all([
      supabase.from('clock_entries').select('*, workers(first_name, last_name, hourly_rate)')
        .eq('job_id', jobId).order('timestamp'),
      supabase.from('time_entries').select('total_hours, hourly_rate_at_time, workers(first_name, last_name)')
        .eq('job_id', jobId),
      supabase.from('equipment').select('id, name, daily_rate, type')
        .eq('current_job_id', jobId),
      supabase.from('job_activity').select('id, content, metadata, created_at')
        .eq('job_id', jobId).eq('file_type', 'receipt'),
      supabase.from('invoices').select('id, invoice_number, total, status')
        .eq('job_id', jobId).is('archived_at', null)
    ])

    // Calculate labor from clock entries
    const clockEntries = clockRes.data || []
    const laborByWorker = {}
    const workerEntries = {}

    clockEntries.forEach(e => {
      if (!workerEntries[e.worker_id]) workerEntries[e.worker_id] = []
      workerEntries[e.worker_id].push(e)
    })

    let totalClockHours = 0
    let totalLaborCost = 0
    Object.entries(workerEntries).forEach(([wId, entries]) => {
      entries.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
      let hours = 0
      for (let i = 0; i < entries.length - 1; i += 2) {
        if (entries[i].type === 'clock_in' && entries[i + 1]?.type === 'clock_out') {
          hours += (new Date(entries[i + 1].timestamp) - new Date(entries[i].timestamp)) / 3600000
        }
      }
      const rate = entries[0]?.workers?.hourly_rate || 0
      const name = entries[0]?.workers ? `${entries[0].workers.first_name} ${entries[0].workers.last_name}` : 'Worker'
      laborByWorker[wId] = { name, hours, rate: parseFloat(rate), cost: hours * parseFloat(rate) }
      totalClockHours += hours
      totalLaborCost += hours * parseFloat(rate)
    })

    // Also add manual time entries
    const timeEntries = timeRes.data || []
    const manualHours = timeEntries.reduce((s, e) => s + (parseFloat(e.total_hours) || 0), 0)
    const manualCost = timeEntries.reduce((s, e) => s + ((parseFloat(e.total_hours) || 0) * (parseFloat(e.hourly_rate_at_time) || 0)), 0)

    // Equipment cost
    const equipment = equipRes.data || []
    const equipCost = equipment.reduce((s, e) => s + (parseFloat(e.daily_rate) || 0), 0) // per day

    // Receipts
    const receipts = receiptsRes.data || []

    // Invoiced
    const invoices = invoicesRes.data || []
    const totalInvoiced = invoices.reduce((s, i) => s + (parseFloat(i.total) || 0), 0)

    setData({
      laborByWorker, totalClockHours, totalLaborCost,
      manualHours, manualCost,
      equipment, equipCost,
      receipts,
      invoices, totalInvoiced,
      totalHours: totalClockHours + manualHours,
      totalCost: totalLaborCost + manualCost
    })
    setLoading(false)
  }

  const isOwner = profile?.role === 'owner' || profile?.role === 'admin'

  if (loading) return <div style={{ padding: 12, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
  if (!data) return null

  return (
    <div>
      {/* Summary cards */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <div style={{ flex: 1, background: 'var(--bg2)', borderRadius: 10, padding: 10, textAlign: 'center' }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--primary)' }}>{data.totalHours.toFixed(1)}h</div>
          <div style={{ fontSize: 9, color: 'var(--text3)', textTransform: 'uppercase' }}>Total Hours</div>
        </div>
        {isOwner && (
          <div style={{ flex: 1, background: 'var(--bg2)', borderRadius: 10, padding: 10, textAlign: 'center' }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--blue)' }}>${data.totalCost.toFixed(0)}</div>
            <div style={{ fontSize: 9, color: 'var(--text3)', textTransform: 'uppercase' }}>Labor Cost</div>
          </div>
        )}
        <div style={{ flex: 1, background: 'var(--bg2)', borderRadius: 10, padding: 10, textAlign: 'center' }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--yellow)' }}>${data.totalInvoiced.toFixed(0)}</div>
          <div style={{ fontSize: 9, color: 'var(--text3)', textTransform: 'uppercase' }}>Invoiced</div>
        </div>
      </div>

      {/* Labor breakdown — owner only */}
      {isOwner && Object.keys(data.laborByWorker).length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text3)', letterSpacing: 1, marginBottom: 6 }}>LABOR</div>
          {Object.values(data.laborByWorker).map((w, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 12, borderBottom: '1px solid var(--border)' }}>
              <span>{w.name}</span>
              <span style={{ color: 'var(--text2)' }}>{w.hours.toFixed(1)}h {w.rate > 0 ? `· $${w.cost.toFixed(0)}` : ''}</span>
            </div>
          ))}
        </div>
      )}

      {/* Hours breakdown — everyone */}
      {!isOwner && Object.keys(data.laborByWorker).length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text3)', letterSpacing: 1, marginBottom: 6 }}>HOURS</div>
          {Object.values(data.laborByWorker).map((w, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 12, borderBottom: '1px solid var(--border)' }}>
              <span>{w.name}</span>
              <span style={{ color: 'var(--text2)' }}>{w.hours.toFixed(1)}h</span>
            </div>
          ))}
        </div>
      )}

      {/* Equipment */}
      {data.equipment.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text3)', letterSpacing: 1, marginBottom: 6 }}>EQUIPMENT ON SITE</div>
          {data.equipment.map(eq => (
            <div key={eq.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 12, borderBottom: '1px solid var(--border)' }}>
              <span>{eq.name}</span>
              {isOwner && eq.daily_rate && <span style={{ color: 'var(--text2)' }}>${eq.daily_rate}/day</span>}
            </div>
          ))}
        </div>
      )}

      {/* Receipts */}
      {data.receipts.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text3)', letterSpacing: 1, marginBottom: 6 }}>RECEIPTS ({data.receipts.length})</div>
          {data.receipts.map(r => (
            <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 12, borderBottom: '1px solid var(--border)' }}>
              <span style={{ color: 'var(--yellow)' }}>🧾 {r.content}</span>
              <span style={{ fontSize: 10, color: 'var(--text3)' }}>
                {new Date(r.created_at).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Profit margin — owner only */}
      {isOwner && data.totalInvoiced > 0 && (
        <div style={{
          background: 'var(--bg2)', borderRadius: 10, padding: 12, textAlign: 'center',
          border: '1px solid var(--border)'
        }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text3)', letterSpacing: 1, marginBottom: 4 }}>PROFIT MARGIN</div>
          <div style={{
            fontSize: 24, fontWeight: 800,
            color: (data.totalInvoiced - data.totalCost) > 0 ? 'var(--green)' : 'var(--red)'
          }}>
            {((data.totalInvoiced - data.totalCost) / data.totalInvoiced * 100).toFixed(0)}%
          </div>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
            ${data.totalInvoiced.toFixed(0)} invoiced — ${data.totalCost.toFixed(0)} labor = ${(data.totalInvoiced - data.totalCost).toFixed(0)} profit
          </div>
        </div>
      )}
    </div>
  )
}

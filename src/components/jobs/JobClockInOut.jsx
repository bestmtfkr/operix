import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useToast } from '../shared/Toast'

export default function JobClockInOut({ jobId, onUpdate }) {
  const { companyId, profile } = useAuth()
  const showToast = useToast()
  const [entries, setEntries] = useState([])
  const [workers, setWorkers] = useState([])
  const [loading, setLoading] = useState(true)
  const [clocking, setClocking] = useState(false)
  const [selectedWorker, setSelectedWorker] = useState('')

  useEffect(() => { loadData() }, [jobId])

  async function loadData() {
    const [entriesRes, workersRes] = await Promise.all([
      supabase.from('clock_entries').select('*, workers(first_name, last_name)')
        .eq('job_id', jobId).order('timestamp', { ascending: false }),
      supabase.from('job_workers').select('worker_id, workers(id, first_name, last_name)')
        .eq('job_id', jobId).is('removed_at', null)
    ])
    setEntries(entriesRes.data || [])
    setWorkers((workersRes.data || []).map(jw => jw.workers).filter(Boolean))
    setLoading(false)
  }

  function getLocation() {
    return new Promise((resolve) => {
      if (!navigator.geolocation) { resolve(null); return }
      navigator.geolocation.getCurrentPosition(
        pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => resolve(null),
        { timeout: 10000, enableHighAccuracy: true }
      )
    })
  }

  async function clockAction(workerId, type) {
    if (clocking) return
    setClocking(true)
    showToast(type === 'clock_in' ? 'Clocking in...' : 'Clocking out...')

    const location = await getLocation()

    const { error } = await supabase.from('clock_entries').insert({
      company_id: companyId,
      job_id: jobId,
      worker_id: workerId,
      type,
      lat: location?.lat || null,
      lng: location?.lng || null
    })

    if (error) { showToast('Error'); console.error(error); setClocking(false); return }

    // Log to job activity
    const worker = workers.find(w => w.id === workerId)
    const wName = worker ? `${worker.first_name} ${worker.last_name}` : 'Worker'
    await supabase.from('job_activity').insert({
      company_id: companyId, job_id: jobId, author_id: profile?.id,
      type: 'note',
      content: `${wName} ${type === 'clock_in' ? '🟢 clocked in' : '🔴 clocked out'}${location ? ` (GPS: ${location.lat.toFixed(5)}, ${location.lng.toFixed(5)})` : ''}`,
    })

    showToast(type === 'clock_in' ? '🟢 Clocked in' : '🔴 Clocked out')
    setClocking(false)
    loadData()
    if (onUpdate) onUpdate()
  }

  // Check who's currently clocked in (has clock_in without matching clock_out)
  function isWorkerClockedIn(workerId) {
    const workerEntries = entries.filter(e => e.worker_id === workerId)
    if (workerEntries.length === 0) return false
    return workerEntries[0].type === 'clock_in'
  }

  // Calculate total hours for a worker on this job
  function getWorkerHours(workerId) {
    const workerEntries = entries.filter(e => e.worker_id === workerId).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
    let total = 0
    for (let i = 0; i < workerEntries.length - 1; i += 2) {
      if (workerEntries[i].type === 'clock_in' && workerEntries[i + 1]?.type === 'clock_out') {
        total += (new Date(workerEntries[i + 1].timestamp) - new Date(workerEntries[i].timestamp)) / 3600000
      }
    }
    // If currently clocked in, add time since last clock_in
    const last = workerEntries[workerEntries.length - 1]
    if (last?.type === 'clock_in') {
      total += (Date.now() - new Date(last.timestamp).getTime()) / 3600000
    }
    return total
  }

  const totalHours = workers.reduce((s, w) => s + getWorkerHours(w.id), 0)

  if (loading) return <div style={{ padding: 12, textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  return (
    <div>
      {/* Summary */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <div style={{ flex: 1, background: 'var(--bg2)', borderRadius: 10, padding: 10, textAlign: 'center' }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--primary)' }}>{totalHours.toFixed(1)}h</div>
          <div style={{ fontSize: 9, color: 'var(--text3)', textTransform: 'uppercase' }}>Total Hours</div>
        </div>
        <div style={{ flex: 1, background: 'var(--bg2)', borderRadius: 10, padding: 10, textAlign: 'center' }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--green)' }}>{workers.filter(w => isWorkerClockedIn(w.id)).length}</div>
          <div style={{ fontSize: 9, color: 'var(--text3)', textTransform: 'uppercase' }}>On Site Now</div>
        </div>
      </div>

      {/* Worker clock buttons */}
      {workers.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 16, fontSize: 12, color: 'var(--text3)' }}>
          Assign workers to this job first
        </div>
      ) : workers.map(w => {
        const clockedIn = isWorkerClockedIn(w.id)
        const hours = getWorkerHours(w.id)
        return (
          <div key={w.id} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '10px 12px', background: 'var(--bg2)', borderRadius: 10,
            marginBottom: 6, border: clockedIn ? '1px solid rgba(0,212,160,0.2)' : '1px solid var(--border)'
          }}>
            <div style={{
              width: 8, height: 8, borderRadius: '50%',
              background: clockedIn ? 'var(--green)' : 'var(--text3)',
              animation: clockedIn ? 'blink 1.5s infinite' : 'none'
            }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{w.first_name} {w.last_name}</div>
              <div style={{ fontSize: 10, color: 'var(--text3)' }}>
                {clockedIn ? '🟢 On site' : '⚪ Off site'} · {hours.toFixed(1)}h logged
              </div>
            </div>
            <button onClick={() => clockAction(w.id, clockedIn ? 'clock_out' : 'clock_in')} disabled={clocking}
              style={{
                padding: '8px 14px', borderRadius: 8, fontSize: 11, fontWeight: 700,
                border: 'none', cursor: 'pointer', fontFamily: 'DM Sans',
                background: clockedIn ? 'rgba(255,59,92,0.1)' : 'rgba(0,212,160,0.1)',
                color: clockedIn ? 'var(--red)' : 'var(--primary)',
                borderWidth: 1, borderStyle: 'solid',
                borderColor: clockedIn ? 'rgba(255,59,92,0.2)' : 'rgba(0,212,160,0.2)'
              }}>
              {clockedIn ? '🔴 Clock Out' : '🟢 Clock In'}
            </button>
          </div>
        )
      })}

      {/* Recent entries */}
      {entries.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text3)', letterSpacing: 1, marginBottom: 6 }}>RECENT</div>
          {entries.slice(0, 8).map(e => (
            <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 11, borderBottom: '1px solid var(--border)' }}>
              <span style={{ color: 'var(--text2)' }}>
                {e.type === 'clock_in' ? '🟢' : '🔴'} {e.workers?.first_name} {e.workers?.last_name}
              </span>
              <span style={{ color: 'var(--text3)' }}>
                {new Date(e.timestamp).toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit' })}
                {e.lat ? ' 📍' : ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

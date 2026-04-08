import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { STAGE_LABELS, STAGE_COLORS } from '../../lib/constants'

export default function GlobalSearch({ onClose, onNavigate }) {
  const { companyId } = useAuth()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState({ clients: [], jobs: [], workers: [], invoices: [] })
  const [loading, setLoading] = useState(false)
  const inputRef = useRef(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  useEffect(() => {
    if (query.trim().length < 2) { setResults({ clients: [], jobs: [], workers: [], invoices: [] }); return }
    const timer = setTimeout(() => search(query.trim()), 250)
    return () => clearTimeout(timer)
  }, [query])

  async function search(q) {
    setLoading(true)
    const like = `%${q}%`

    const [clientsRes, jobsRes, workersRes, invoicesRes] = await Promise.all([
      supabase.from('clients').select('id, name, contact_name, type')
        .eq('company_id', companyId).is('archived_at', null)
        .or(`name.ilike.${like},contact_name.ilike.${like},contact_email.ilike.${like}`)
        .limit(5),
      supabase.from('jobs').select('id, name, job_number, stage, clients(name)')
        .eq('company_id', companyId).is('archived_at', null)
        .or(`name.ilike.${like},job_number.ilike.${like},site_address.ilike.${like}`)
        .limit(5),
      supabase.from('workers').select('id, first_name, last_name, role')
        .eq('company_id', companyId).is('archived_at', null)
        .or(`first_name.ilike.${like},last_name.ilike.${like},email.ilike.${like}`)
        .limit(5),
      supabase.from('invoices').select('id, invoice_number, total, status, clients(name)')
        .eq('company_id', companyId).is('archived_at', null)
        .or(`invoice_number.ilike.${like}`)
        .limit(5)
    ])

    setResults({
      clients: clientsRes.data || [],
      jobs: jobsRes.data || [],
      workers: workersRes.data || [],
      invoices: invoicesRes.data || []
    })
    setLoading(false)
  }

  const total = results.clients.length + results.jobs.length + results.workers.length + results.invoices.length

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 250,
      background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)',
      display: 'flex', flexDirection: 'column',
      padding: '16px', paddingTop: 'calc(env(safe-area-inset-top, 44px) + 12px)',
      paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)'
    }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      {/* Search input */}
      <div style={{
        background: 'var(--card)', border: '1px solid var(--border2)', borderRadius: 16,
        padding: '4px', display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16
      }}>
        <span style={{ fontSize: 18, paddingLeft: 12 }}>🔍</span>
        <input ref={inputRef} style={{
          flex: 1, background: 'none', border: 'none', outline: 'none',
          fontSize: 16, color: 'var(--text)', padding: '14px 0',
          fontFamily: 'DM Sans'
        }} placeholder="Search clients, jobs, workers, invoices..."
          value={query} onChange={e => setQuery(e.target.value)} />
        <button onClick={onClose} style={{
          background: 'var(--card2)', border: '1px solid var(--border)', borderRadius: 10,
          padding: '8px 14px', color: 'var(--text2)', fontSize: 12, fontWeight: 700,
          cursor: 'pointer', fontFamily: 'DM Sans', marginRight: 4
        }}>ESC</button>
      </div>

      {/* Results */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading && <div className="loading-center"><div className="spinner" /></div>}

        {!loading && query.length >= 2 && total === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--text3)', padding: 40, fontSize: 14 }}>
            No results for "{query}"
          </div>
        )}

        {/* Clients */}
        {results.clients.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--text3)', letterSpacing: 1, textTransform: 'uppercase', padding: '0 4px 8px' }}>CLIENTS</div>
            {results.clients.map(c => (
              <div key={c.id} className="card" onClick={() => { onClose(); onNavigate('clients', c.id) }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: 11,
                    background: 'linear-gradient(135deg, var(--primary), var(--primary2))',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 14, fontWeight: 800, color: '#000'
                  }}>{c.name.charAt(0)}</div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>{c.name}</div>
                    {c.contact_name && <div style={{ fontSize: 11, color: 'var(--text3)' }}>{c.contact_name}</div>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Jobs */}
        {results.jobs.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--text3)', letterSpacing: 1, textTransform: 'uppercase', padding: '0 4px 8px' }}>JOBS</div>
            {results.jobs.map(j => (
              <div key={j.id} className="card" onClick={() => { onClose(); onNavigate('jobs', j.id) }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>{j.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text3)' }}>{j.job_number} · {j.clients?.name}</div>
                  </div>
                  <span className="badge" style={{ background: STAGE_COLORS[j.stage] + '18', color: STAGE_COLORS[j.stage] }}>
                    {STAGE_LABELS[j.stage]}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Workers */}
        {results.workers.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--text3)', letterSpacing: 1, textTransform: 'uppercase', padding: '0 4px 8px' }}>WORKERS</div>
            {results.workers.map(w => (
              <div key={w.id} className="card" onClick={() => { onClose(); onNavigate('team') }}>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{w.first_name} {w.last_name}</div>
                <div style={{ fontSize: 11, color: 'var(--text3)' }}>{w.role}</div>
              </div>
            ))}
          </div>
        )}

        {/* Invoices */}
        {results.invoices.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--text3)', letterSpacing: 1, textTransform: 'uppercase', padding: '0 4px 8px' }}>INVOICES</div>
            {results.invoices.map(i => (
              <div key={i.id} className="card" onClick={() => { onClose(); onNavigate('billing') }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>{i.invoice_number}</div>
                    <div style={{ fontSize: 11, color: 'var(--text3)' }}>{i.clients?.name}</div>
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 800 }}>${parseFloat(i.total || 0).toLocaleString()}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { STAGE_LABELS, STAGE_COLORS } from '../../lib/constants'

export default function CustomerPortal({ token }) {
  const [client, setClient] = useState(null)
  const [jobs, setJobs] = useState([])
  const [invoices, setInvoices] = useState([])
  const [quotes, setQuotes] = useState([])
  const [company, setCompany] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [activeTab, setActiveTab] = useState('overview')
  const [selectedQuote, setSelectedQuote] = useState(null)
  const [selectedInvoice, setSelectedInvoice] = useState(null)

  useEffect(() => { loadPortalData() }, [token])

  async function loadPortalData() {
    // Find client by portal token — no auth needed
    const { data: clientData, error: clientErr } = await supabase
      .from('clients')
      .select('*, companies(*)')
      .eq('portal_token', token)
      .eq('portal_enabled', true)
      .single()

    if (clientErr || !clientData) {
      setError('Invalid or expired portal link')
      setLoading(false)
      return
    }

    setClient(clientData)
    setCompany(clientData.companies)

    // Load client's jobs, invoices, quotes
    const [jobsRes, invRes, quotesRes] = await Promise.all([
      supabase.from('jobs').select('*')
        .eq('client_id', clientData.id).is('archived_at', null)
        .order('created_at', { ascending: false }),
      supabase.from('invoices').select('*, invoice_lines(*)')
        .eq('client_id', clientData.id).is('archived_at', null)
        .order('created_at', { ascending: false }),
      supabase.from('quotes').select('*, invoice_lines:invoice_lines!quote_id(*)')
        .eq('client_id', clientData.id)
        .order('created_at', { ascending: false })
    ])

    setJobs(jobsRes.data || [])
    setInvoices(invRes.data || [])
    setQuotes(quotesRes.data || [])
    setLoading(false)
  }

  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#070B12', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="spinner" />
    </div>
  )

  if (error) return (
    <div style={{ minHeight: '100vh', background: '#070B12', color: '#EEF2FF', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 40, textAlign: 'center', fontFamily: 'DM Sans, sans-serif' }}>
      <div style={{ fontSize: 40, marginBottom: 16 }}>🔒</div>
      <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 8 }}>Access Denied</div>
      <div style={{ fontSize: 14, color: '#7A8799' }}>{error}</div>
    </div>
  )

  const activeJobs = jobs.filter(j => ['lead', 'quoted', 'active'].includes(j.stage))
  const completedJobs = jobs.filter(j => ['completed', 'invoiced', 'closed'].includes(j.stage))
  const pendingInvoices = invoices.filter(i => ['sent', 'viewed', 'partial', 'overdue'].includes(i.status))
  const totalOwed = pendingInvoices.reduce((s, i) => s + parseFloat(i.amount_due || 0), 0)
  const pendingQuotes = quotes.filter(q => ['sent', 'viewed'].includes(q.status))

  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'jobs', label: `Jobs (${jobs.length})` },
    { id: 'quotes', label: `Quotes (${pendingQuotes.length})` },
    { id: 'invoices', label: `Invoices (${invoices.length})` },
  ]

  return (
    <div style={{ minHeight: '100vh', background: '#070B12', color: '#EEF2FF', fontFamily: 'DM Sans, sans-serif' }}>
      {/* Header */}
      <div style={{
        padding: 'calc(env(safe-area-inset-top, 20px) + 16px) 20px 16px',
        background: '#0C1018', borderBottom: '1px solid rgba(255,255,255,0.06)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 11, color: '#7A8799', fontWeight: 500 }}>Client Portal</div>
            <div style={{ fontSize: 18, fontWeight: 800, marginTop: 2 }}>{client.name}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{
              fontSize: 12, fontWeight: 800, letterSpacing: 3,
              background: 'linear-gradient(135deg, #00D4A0, #0099FF)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent'
            }}>{company?.name || 'OPERIX'}</div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid rgba(255,255,255,0.06)', background: '#0C1018' }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
            flex: 1, padding: '12px 8px', fontSize: 11, fontWeight: 700,
            border: 'none', cursor: 'pointer', fontFamily: 'DM Sans',
            background: activeTab === t.id ? 'rgba(0,212,160,0.08)' : 'transparent',
            color: activeTab === t.id ? '#00D4A0' : '#7A8799',
            borderBottom: activeTab === t.id ? '2px solid #00D4A0' : '2px solid transparent'
          }}>{t.label}</button>
        ))}
      </div>

      <div style={{ padding: 16, maxWidth: 600, margin: '0 auto' }}>

        {/* OVERVIEW */}
        {activeTab === 'overview' && (
          <div>
            {/* Stats */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
              <div style={{ background: '#101520', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 16, padding: 16, borderTop: '2px solid #00D4A0' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#7A8799', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 8 }}>Active Jobs</div>
                <div style={{ fontSize: 28, fontWeight: 800, color: '#00D4A0' }}>{activeJobs.length}</div>
              </div>
              <div style={{ background: '#101520', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 16, padding: 16, borderTop: '2px solid #FF3B5C' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#7A8799', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 8 }}>Amount Due</div>
                <div style={{ fontSize: 28, fontWeight: 800, color: totalOwed > 0 ? '#FF3B5C' : '#00D4A0' }}>
                  ${totalOwed.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
            </div>

            {/* Pending Quotes */}
            {pendingQuotes.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 10 }}>Quotes Awaiting Approval</div>
                {pendingQuotes.map(q => (
                  <div key={q.id} onClick={() => { setSelectedQuote(q); setActiveTab('quotes') }} style={{
                    background: '#101520', border: '1px solid rgba(255,184,0,0.2)',
                    borderRadius: 14, padding: 14, marginBottom: 8, cursor: 'pointer'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <div style={{ fontSize: 14, fontWeight: 700 }}>{q.quote_number}</div>
                      <div style={{ fontSize: 16, fontWeight: 800 }}>${parseFloat(q.total || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                    </div>
                    <div style={{ fontSize: 11, color: '#FFB800', marginTop: 4 }}>Tap to review & approve</div>
                  </div>
                ))}
              </div>
            )}

            {/* Active Jobs */}
            {activeJobs.length > 0 && (
              <div>
                <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 10 }}>Active Jobs</div>
                {activeJobs.map(j => (
                  <div key={j.id} style={{
                    background: '#101520', border: '1px solid rgba(255,255,255,0.06)',
                    borderRadius: 14, padding: 14, marginBottom: 8
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 700 }}>{j.name}</div>
                        <div style={{ fontSize: 11, color: '#7A8799', marginTop: 2 }}>{j.job_number} {j.site_address ? '· ' + j.site_address : ''}</div>
                      </div>
                      <span style={{ padding: '4px 10px', borderRadius: 8, fontSize: 10, fontWeight: 800, background: STAGE_COLORS[j.stage] + '18', color: STAGE_COLORS[j.stage] }}>
                        {STAGE_LABELS[j.stage]}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* JOBS */}
        {activeTab === 'jobs' && (
          <div>
            {jobs.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 40, color: '#3D4A5C' }}>No jobs yet</div>
            ) : jobs.map(j => (
              <div key={j.id} style={{
                background: '#101520', border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: 14, padding: 14, marginBottom: 8
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>{j.name}</div>
                    <div style={{ fontSize: 11, color: '#7A8799', marginTop: 2 }}>{j.job_number}</div>
                  </div>
                  <span style={{ padding: '4px 10px', borderRadius: 8, fontSize: 10, fontWeight: 800, background: STAGE_COLORS[j.stage] + '18', color: STAGE_COLORS[j.stage] }}>
                    {STAGE_LABELS[j.stage]}
                  </span>
                </div>
                {j.site_address && <div style={{ fontSize: 12, color: '#7A8799' }}>📍 {j.site_address}</div>}
                {j.description && <div style={{ fontSize: 12, color: '#7A8799', marginTop: 6, lineHeight: 1.5 }}>{j.description.slice(0, 150)}{j.description.length > 150 ? '...' : ''}</div>}
              </div>
            ))}
          </div>
        )}

        {/* QUOTES */}
        {activeTab === 'quotes' && (
          <div>
            {quotes.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 40, color: '#3D4A5C' }}>No quotes yet</div>
            ) : quotes.map(q => (
              <div key={q.id} style={{
                background: '#101520', border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: 14, padding: 16, marginBottom: 10
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>{q.quote_number}</div>
                    <div style={{ fontSize: 11, color: '#7A8799', marginTop: 2 }}>{q.issue_date} {q.expiry_date ? '· Expires ' + q.expiry_date : ''}</div>
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 800 }}>${parseFloat(q.total || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                </div>

                {/* Line items */}
                {q.invoice_lines && q.invoice_lines.length > 0 && (
                  <div style={{ background: '#0C1018', borderRadius: 10, padding: 12, marginBottom: 10 }}>
                    {q.invoice_lines.map(l => (
                      <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 12 }}>
                        <span style={{ color: '#7A8799' }}>{l.description}</span>
                        <span style={{ fontWeight: 600 }}>${parseFloat(l.amount || 0).toFixed(2)}</span>
                      </div>
                    ))}
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0 0', marginTop: 8, borderTop: '1px solid rgba(255,255,255,0.06)', fontWeight: 800 }}>
                      <span>Total</span>
                      <span>${parseFloat(q.total || 0).toFixed(2)}</span>
                    </div>
                  </div>
                )}

                {q.notes && <div style={{ fontSize: 12, color: '#7A8799', marginBottom: 10, lineHeight: 1.5 }}>{q.notes}</div>}

                {['sent', 'viewed'].includes(q.status) && (
                  <button onClick={() => approveQuote(q.id)} style={{
                    width: '100%', padding: 14, borderRadius: 12,
                    background: 'linear-gradient(135deg, #00D4A0, #0099FF)',
                    border: 'none', color: '#000', fontSize: 14, fontWeight: 800,
                    cursor: 'pointer', fontFamily: 'DM Sans'
                  }}>✓ Approve Quote</button>
                )}

                {q.status === 'approved' && (
                  <div style={{ textAlign: 'center', padding: 10, color: '#00D4A0', fontWeight: 700, fontSize: 13 }}>✓ Approved</div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* INVOICES */}
        {activeTab === 'invoices' && (
          <div>
            {invoices.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 40, color: '#3D4A5C' }}>No invoices yet</div>
            ) : invoices.map(inv => {
              const statusColors = { draft: '#3D4A5C', sent: '#2196F3', viewed: '#8B5CF6', partial: '#FF6B35', paid: '#00D4A0', overdue: '#FF3B5C', void: '#3D4A5C' }
              return (
                <div key={inv.id} style={{
                  background: '#101520', border: '1px solid rgba(255,255,255,0.06)',
                  borderRadius: 14, padding: 16, marginBottom: 10
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700 }}>{inv.invoice_number}</div>
                      <div style={{ fontSize: 11, color: '#7A8799', marginTop: 2 }}>Due {inv.due_date || '—'}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 18, fontWeight: 800 }}>${parseFloat(inv.total || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                      <span style={{ padding: '3px 8px', borderRadius: 6, fontSize: 9, fontWeight: 800, background: (statusColors[inv.status] || '#3D4A5C') + '18', color: statusColors[inv.status] }}>
                        {inv.status?.toUpperCase()}
                      </span>
                    </div>
                  </div>

                  {/* Line items */}
                  {inv.invoice_lines && inv.invoice_lines.length > 0 && (
                    <div style={{ background: '#0C1018', borderRadius: 10, padding: 12, marginBottom: 8 }}>
                      {inv.invoice_lines.map(l => (
                        <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 12 }}>
                          <span style={{ color: '#7A8799' }}>{l.description}</span>
                          <span style={{ fontWeight: 600 }}>${parseFloat(l.amount || 0).toFixed(2)}</span>
                        </div>
                      ))}
                      {inv.tax1_label && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 11, color: '#7A8799', marginTop: 4 }}>
                          <span>{inv.tax1_label} ({((inv.tax1_rate || 0) * 100).toFixed(1)}%)</span>
                          <span>${parseFloat(inv.tax1_amount || 0).toFixed(2)}</span>
                        </div>
                      )}
                      {inv.tax2_label && inv.tax2_rate && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 11, color: '#7A8799' }}>
                          <span>{inv.tax2_label} ({((inv.tax2_rate || 0) * 100).toFixed(1)}%)</span>
                          <span>${parseFloat(inv.tax2_amount || 0).toFixed(2)}</span>
                        </div>
                      )}
                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0 0', marginTop: 4, borderTop: '1px solid rgba(255,255,255,0.06)', fontWeight: 800 }}>
                        <span>Total</span>
                        <span>${parseFloat(inv.total || 0).toFixed(2)}</span>
                      </div>
                    </div>
                  )}

                  {parseFloat(inv.amount_due || 0) > 0 && inv.status !== 'paid' && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0' }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: '#FF3B5C' }}>Amount Due: ${parseFloat(inv.amount_due).toFixed(2)}</span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

      </div>

      {/* Footer */}
      <div style={{ textAlign: 'center', padding: '20px 16px 40px', fontSize: 11, color: '#3D4A5C' }}>
        Powered by Operix · {company?.name}
      </div>
    </div>
  )

  async function approveQuote(quoteId) {
    if (!confirm('Approve this quote?')) return
    await supabase.from('quotes').update({ status: 'approved', approved_at: new Date().toISOString(), approved_by: client.name }).eq('id', quoteId)
    loadPortalData()
  }
}

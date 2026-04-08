import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useToast } from '../shared/Toast'
import Modal from '../shared/Modal'
import { analyzeEmail } from '../../lib/ai'
import { STAGE_LABELS } from '../../lib/constants'

const CAT_COLORS = {
  insurance: { bg: 'rgba(139,92,246,0.12)', color: '#8B5CF6' },
  client: { bg: 'rgba(0,212,160,0.1)', color: '#00D4A0' },
  supplier: { bg: 'rgba(33,150,243,0.12)', color: '#2196F3' },
  pm: { bg: 'rgba(255,107,53,0.12)', color: '#FF6B35' },
  internal: { bg: 'rgba(61,74,92,0.2)', color: '#7A8799' },
  urgent: { bg: 'rgba(255,59,92,0.12)', color: '#FF3B5C' }
}

export default function SmartInbox({ onNavigate }) {
  const { companyId, profile } = useAuth()
  const showToast = useToast()
  const [emails, setEmails] = useState([])
  const [loading, setLoading] = useState(true)
  const [analyzing, setAnalyzing] = useState(false)
  const [showCompose, setShowCompose] = useState(false)
  const [showDetail, setShowDetail] = useState(null)
  const [inputText, setInputText] = useState('')
  const [filter, setFilter] = useState('all')

  useEffect(() => { if (companyId) loadEmails() }, [companyId])

  async function loadEmails() {
    const { data } = await supabase.from('inbox_emails')
      .select('*')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(50)
    setEmails(data || [])
    setLoading(false)
  }

  async function analyzeAndSave() {
    if (!inputText.trim()) { showToast('Paste an email first'); return }
    setAnalyzing(true)

    const result = await analyzeEmail(inputText)

    if (!result) {
      showToast('AI could not analyze this email. Try again.')
      setAnalyzing(false)
      return
    }

    // Save to database
    const { data: saved, error } = await supabase.from('inbox_emails').insert({
      company_id: companyId,
      from_address: result.from_email || result.from_name || 'Unknown',
      from_name: result.from_name || null,
      subject: result.subject || 'No subject',
      body: inputText,
      raw_text: inputText,
      categories: [result.category].filter(Boolean),
      priority: result.priority || 'normal',
      summary: result.summary || '',
      suggested_action: result.suggested_action || 'none',
      draft_reply: result.draft_reply || '',
      status: 'unread',
      metadata: result.extracted_data ? { extracted_data: result.extracted_data } : null
    }).select().single()

    if (error) {
      showToast('Error saving email')
      console.error(error)
      setAnalyzing(false)
      return
    }

    showToast('Email analyzed and saved')
    setInputText('')
    setShowCompose(false)
    setAnalyzing(false)
    loadEmails()

    // If AI suggests creating a job, show detail immediately
    if (saved && result.suggested_action === 'create_job') {
      setShowDetail(saved)
    }
  }

  async function markRead(email) {
    if (email.status === 'unread') {
      await supabase.from('inbox_emails').update({ status: 'read' }).eq('id', email.id)
      email.status = 'read'
    }
    setShowDetail(email)
  }

  async function createJobFromEmail(email) {
    const extracted = email.metadata?.extracted_data || {}

    // Try to find or create client
    let clientId = null
    if (extracted.client_name) {
      const { data: existing } = await supabase.from('clients')
        .select('id').eq('company_id', companyId)
        .ilike('name', `%${extracted.client_name}%`).limit(1)
      if (existing?.length) {
        clientId = existing[0].id
      } else {
        const { data: newClient } = await supabase.from('clients').insert({
          company_id: companyId, name: extracted.client_name, type: 'commercial'
        }).select().single()
        if (newClient) clientId = newClient.id
      }
    }

    if (!clientId) {
      showToast('Could not determine client — create job manually')
      return
    }

    // Generate job number
    const { data: jobNum } = await supabase.rpc('generate_job_number', { p_company_id: companyId })

    const { error } = await supabase.from('jobs').insert({
      company_id: companyId,
      job_number: jobNum || ('JOB-' + Date.now()),
      client_id: clientId,
      name: email.subject || 'New Job from Email',
      description: email.summary || '',
      stage: 'lead',
      priority: email.priority || 'normal',
      site_address: extracted.address || '',
      insurance_company: extracted.insurance_company || '',
      insurance_claim_number: extracted.claim_number || '',
      estimated_value: extracted.amount ? parseFloat(extracted.amount) : null,
      created_by: profile?.id
    })

    if (error) { showToast('Error creating job'); console.error(error); return }

    // Mark email as actioned
    await supabase.from('inbox_emails').update({
      status: 'actioned', actioned_at: new Date().toISOString()
    }).eq('id', email.id)

    showToast('Job created from email!')
    setShowDetail(null)
    loadEmails()
  }

  async function deleteEmail(id) {
    if (!confirm('Delete this email?')) return
    await supabase.from('inbox_emails').delete().eq('id', id)
    showToast('Email deleted')
    setShowDetail(null)
    loadEmails()
  }

  function timeAgo(iso) {
    const diff = Date.now() - new Date(iso).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return 'Just now'
    if (mins < 60) return mins + 'm ago'
    const hours = Math.floor(mins / 60)
    if (hours < 24) return hours + 'h ago'
    return Math.floor(hours / 24) + 'd ago'
  }

  const filtered = filter === 'all' ? emails :
    filter === 'unread' ? emails.filter(e => e.status === 'unread') :
    emails.filter(e => (e.categories || []).includes(filter))

  const unreadCount = emails.filter(e => e.status === 'unread').length

  if (loading) return <div className="loading-center"><div className="spinner" /></div>

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">AI Smart Inbox</div>
          <div className="page-subtitle">{unreadCount} unread · {emails.length} total</div>
        </div>
      </div>

      {/* Compose Button */}
      {!showCompose && (
        <div style={{ padding: '0 16px 8px' }}>
          <button onClick={() => setShowCompose(true)} style={{
            width: '100%', padding: 14, borderRadius: 14,
            background: 'linear-gradient(135deg, rgba(0,212,160,0.08), rgba(0,153,255,0.08))',
            border: '1px solid rgba(0,212,160,0.2)', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 10,
            fontFamily: 'DM Sans', fontSize: 13, fontWeight: 700, color: 'var(--primary)'
          }}>
            🤖 Paste an email — AI analyzes, categorizes & drafts reply
          </button>
        </div>
      )}

      {/* Compose Area */}
      {showCompose && (
        <div style={{
          margin: '0 16px 12px', background: 'var(--card)',
          border: '1px solid rgba(0,212,160,0.2)', borderRadius: 18, padding: 16
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <div style={{
              width: 28, height: 28, borderRadius: 8,
              background: 'linear-gradient(135deg, var(--primary), var(--primary2))',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14
            }}>🤖</div>
            <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--primary)' }}>PASTE EMAIL</div>
            <button onClick={() => setShowCompose(false)} style={{
              marginLeft: 'auto', background: 'none', border: 'none',
              color: 'var(--text3)', cursor: 'pointer', fontSize: 16
            }}>✕</button>
          </div>
          <textarea style={{
            width: '100%', background: 'var(--bg2)', border: '1px solid var(--border2)',
            borderRadius: 12, padding: 14, fontSize: 13, color: 'var(--text)',
            fontFamily: 'DM Sans', outline: 'none', resize: 'none', minHeight: 120, lineHeight: 1.6
          }} placeholder="Paste the full email text here..."
            value={inputText} onChange={e => setInputText(e.target.value)} />
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button onClick={analyzeAndSave} disabled={analyzing || !inputText.trim()} style={{
              flex: 1, padding: 12, borderRadius: 10,
              background: analyzing ? 'var(--card2)' : 'linear-gradient(135deg, var(--primary), var(--primary2))',
              border: 'none', color: analyzing ? 'var(--text2)' : '#000',
              fontSize: 13, fontWeight: 800, cursor: analyzing ? 'default' : 'pointer',
              fontFamily: 'DM Sans', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8
            }}>
              {analyzing ? <><div className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> Analyzing...</> : '🤖 Analyze with AI'}
            </button>
            <button onClick={() => { setInputText(''); setShowCompose(false) }} style={{
              padding: '12px 16px', borderRadius: 10, background: 'var(--card2)',
              border: '1px solid var(--border)', color: 'var(--text2)', fontSize: 12,
              fontWeight: 700, cursor: 'pointer', fontFamily: 'DM Sans'
            }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Filter Tabs */}
      <div style={{ display: 'flex', gap: 6, padding: '4px 16px', overflowX: 'auto', scrollbarWidth: 'none' }}>
        {[
          { id: 'all', label: 'All' }, { id: 'unread', label: 'Unread' },
          { id: 'insurance', label: 'Insurance' }, { id: 'client', label: 'Clients' },
          { id: 'supplier', label: 'Suppliers' }, { id: 'urgent', label: 'Urgent' }
        ].map(f => (
          <div key={f.id} onClick={() => setFilter(f.id)} style={{
            padding: '6px 12px', borderRadius: 10, fontSize: 11, fontWeight: 700,
            cursor: 'pointer', whiteSpace: 'nowrap',
            border: `1px solid ${filter === f.id ? 'rgba(0,212,160,0.3)' : 'var(--border)'}`,
            background: filter === f.id ? 'rgba(0,212,160,0.1)' : 'var(--card)',
            color: filter === f.id ? 'var(--primary)' : 'var(--text2)'
          }}>{f.label}</div>
        ))}
      </div>

      {/* Email List */}
      <div className="sec" style={{ marginTop: 4 }}>
        {filtered.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">📬</div>
            <div className="empty-title">{filter === 'all' ? 'No emails yet' : 'No matches'}</div>
            <div className="empty-sub">Paste an email above to get started</div>
          </div>
        ) : filtered.map(email => {
          const cat = (email.categories || [])[0] || 'client'
          const catStyle = CAT_COLORS[cat] || CAT_COLORS.client
          return (
            <div key={email.id} className="card" onClick={() => markRead(email)} style={{
              borderLeft: email.status === 'unread' ? '3px solid var(--primary)' : '3px solid transparent'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <div style={{ fontSize: 14, fontWeight: email.status === 'unread' ? 800 : 600 }}>
                  {email.from_name || email.from_address || 'Unknown'}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text3)', whiteSpace: 'nowrap' }}>
                  {timeAgo(email.created_at)}
                </div>
              </div>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{email.subject}</div>
              <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                {email.summary}
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                <span style={{
                  padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 700,
                  background: catStyle.bg, color: catStyle.color
                }}>{cat.toUpperCase()}</span>
                {email.priority === 'urgent' && (
                  <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 700, background: 'rgba(255,59,92,0.12)', color: '#FF3B5C' }}>URGENT</span>
                )}
                {email.suggested_action === 'create_job' && email.status !== 'actioned' && (
                  <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 700, background: 'rgba(0,212,160,0.1)', color: 'var(--primary)', border: '1px solid rgba(0,212,160,0.2)' }}>→ CREATE JOB</span>
                )}
                {email.status === 'actioned' && (
                  <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 700, background: 'rgba(0,212,160,0.1)', color: 'var(--primary)' }}>✓ ACTIONED</span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Email Detail Modal */}
      {showDetail && (
        <Modal title="Email Detail" onClose={() => setShowDetail(null)}>
          <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 4 }}>
            From: {showDetail.from_name || showDetail.from_address}
          </div>
          <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 12 }}>{showDetail.subject}</div>

          {/* Categories */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
            {(showDetail.categories || []).map(c => {
              const s = CAT_COLORS[c] || CAT_COLORS.client
              return <span key={c} style={{ padding: '3px 10px', borderRadius: 7, fontSize: 10, fontWeight: 700, background: s.bg, color: s.color }}>{c.toUpperCase()}</span>
            })}
          </div>

          {/* AI Summary */}
          <div style={{
            background: 'rgba(0,212,160,0.04)', border: '1px solid rgba(0,212,160,0.15)',
            borderRadius: 14, padding: 14, marginBottom: 12
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <span style={{ fontSize: 14 }}>🤖</span>
              <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--primary)', letterSpacing: 0.5 }}>AI SUMMARY</span>
            </div>
            <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.6 }}>{showDetail.summary}</div>
          </div>

          {/* Email Body */}
          <div style={{
            background: 'var(--bg2)', borderRadius: 14, padding: 14, marginBottom: 12,
            fontSize: 13, color: 'var(--text2)', lineHeight: 1.7, whiteSpace: 'pre-wrap',
            maxHeight: 200, overflow: 'auto'
          }}>
            {showDetail.body || showDetail.raw_text}
          </div>

          {/* Draft Reply */}
          {showDetail.draft_reply && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--text3)', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 }}>Suggested Reply</div>
              <textarea style={{
                width: '100%', background: 'var(--bg2)', border: '1px solid var(--border2)',
                borderRadius: 12, padding: 12, fontSize: 13, color: 'var(--text)',
                fontFamily: 'DM Sans', outline: 'none', resize: 'none', minHeight: 80, lineHeight: 1.6
              }} defaultValue={showDetail.draft_reply} />
              <button className="btn btn-secondary" style={{ marginTop: 6, fontSize: 12 }}
                onClick={() => {
                  const text = document.querySelector('textarea[defaultValue]')?.value || showDetail.draft_reply
                  navigator.clipboard.writeText(text).then(() => showToast('Reply copied'))
                }}>📋 Copy Reply</button>
            </div>
          )}

          {/* Actions */}
          {showDetail.suggested_action === 'create_job' && showDetail.status !== 'actioned' && (
            <button className="btn btn-primary btn-full" onClick={() => createJobFromEmail(showDetail)}>
              🤖 Create Job from this Email
            </button>
          )}

          <button className="btn btn-danger btn-full" style={{ marginTop: 8 }} onClick={() => deleteEmail(showDetail.id)}>
            Delete Email
          </button>
          <button className="btn btn-secondary btn-full" style={{ marginTop: 8 }} onClick={() => setShowDetail(null)}>
            Close
          </button>
        </Modal>
      )}
    </div>
  )
}

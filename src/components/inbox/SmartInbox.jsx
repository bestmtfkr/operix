import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useToast } from '../shared/Toast'
import Modal from '../shared/Modal'
import { analyzeEmail } from '../../lib/ai'
import { askAIJSON } from '../../lib/ai'

const CAT_COLORS = {
  insurance: { bg: 'rgba(139,92,246,0.12)', color: '#8B5CF6' },
  client: { bg: 'rgba(0,212,160,0.1)', color: '#00D4A0' },
  supplier: { bg: 'rgba(33,150,243,0.12)', color: '#2196F3' },
  pm: { bg: 'rgba(255,107,53,0.12)', color: '#FF6B35' },
  internal: { bg: 'rgba(61,74,92,0.2)', color: '#7A8799' },
  urgent: { bg: 'rgba(255,59,92,0.12)', color: '#FF3B5C' }
}

export default function SmartInbox() {
  const { companyId, profile } = useAuth()
  const showToast = useToast()
  const [emails, setEmails] = useState([])
  const [jobs, setJobs] = useState([])
  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [showDetail, setShowDetail] = useState(null)
  const [showCompose, setShowCompose] = useState(false)
  const [inputText, setInputText] = useState('')
  const [tab, setTab] = useState('inbox') // inbox, suggestions, linked
  const [filter, setFilter] = useState('all')
  const [gmailConnected, setGmailConnected] = useState(false)
  const [gmailEmail, setGmailEmail] = useState('')

  useEffect(() => {
    if (companyId) { loadEmails(); loadJobs(); loadClients(); checkGmail() }
  }, [companyId])

  // Listen for Gmail OAuth callback
  useEffect(() => {
    function handleMessage(e) {
      if (e.data?.type === 'gmail-connected') {
        saveGmailTokens(e.data)
      }
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [companyId])

  async function checkGmail() {
    const { data } = await supabase.from('companies').select('gmail_tokens').eq('id', companyId).single()
    if (data?.gmail_tokens?.access_token) {
      setGmailConnected(true)
      setGmailEmail(data.gmail_tokens.email || '')
    }
  }

  async function saveGmailTokens(data) {
    // Tokens are stored server-side by the callback function
    // Frontend only gets the email address
    setGmailConnected(true)
    setGmailEmail(data.email || '')
    showToast('Gmail connected securely: ' + (data.email || ''))
    fetchGmailEmails()
  }

  function connectGmail() {
    const w = window.open(`/api/gmail/connect?company_id=${companyId}`, '_blank', 'width=500,height=600,left=200,top=100')
    if (!w) showToast('Popup blocked — allow popups for this site')
  }

  async function fetchGmailEmails() {
    setSyncing(true)
    try {
      // Only send company_id — tokens are read server-side
      const res = await fetch('/.netlify/functions/gmail-fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId, max_results: 15 })
      })

      const data = await res.json()
      if (data.error) { showToast('Gmail: ' + data.error); setSyncing(false); return }

      // Check which emails we already have
      const existingIds = emails.map(e => e.metadata?.gmail_id).filter(Boolean)
      const newEmails = (data.emails || []).filter(e => !existingIds.includes(e.gmail_id))

      if (newEmails.length === 0) {
        showToast('No new emails')
        setSyncing(false)
        return
      }

      // Analyze each new email with AI and save
      let saved = 0
      for (const email of newEmails) {
        const aiResult = await analyzeEmail(`From: ${email.from}\nSubject: ${email.subject}\n\n${email.body}`)

        const { error } = await supabase.from('inbox_emails').insert({
          company_id: companyId,
          from_address: email.from,
          from_name: aiResult?.from_name || email.from.split('<')[0].trim(),
          subject: email.subject,
          body: email.body,
          raw_text: `From: ${email.from}\nSubject: ${email.subject}\n\n${email.body}`,
          categories: aiResult ? [aiResult.category].filter(Boolean) : ['client'],
          priority: aiResult?.priority || 'normal',
          summary: aiResult?.summary || email.snippet,
          suggested_action: aiResult?.suggested_action || 'none',
          draft_reply: aiResult?.draft_reply || '',
          status: 'unread',
          metadata: {
            gmail_id: email.gmail_id,
            thread_id: email.thread_id,
            extracted_data: aiResult?.extracted_data || {},
            date: email.date
          }
        })

        if (!error) saved++
      }

      showToast(`${saved} new emails synced and analyzed`)
      loadEmails()
    } catch (err) {
      showToast('Gmail sync failed')
      console.error(err)
    }
    setSyncing(false)
  }

  async function loadEmails() {
    const { data } = await supabase.from('inbox_emails')
      .select('*')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false })
      .limit(100)
    setEmails(data || [])
    setLoading(false)
  }

  async function loadJobs() {
    const { data } = await supabase.from('jobs')
      .select('id, name, job_number, client_id, site_address, unit_numbers, insurance_claim_number, clients(name)')
      .eq('company_id', companyId).is('archived_at', null)
      .order('created_at', { ascending: false })
    setJobs(data || [])
  }

  async function loadClients() {
    const { data } = await supabase.from('clients').select('id, name, contact_email')
      .eq('company_id', companyId).is('archived_at', null)
    setClients(data || [])
  }

  async function analyzeAndSave() {
    if (!inputText.trim()) { showToast('Paste an email first'); return }
    setAnalyzing(true)
    const result = await analyzeEmail(inputText)
    if (!result) { showToast('AI could not analyze'); setAnalyzing(false); return }

    const { error } = await supabase.from('inbox_emails').insert({
      company_id: companyId,
      from_address: result.from_email || result.from_name || 'Unknown',
      from_name: result.from_name,
      subject: result.subject || 'No subject',
      body: inputText, raw_text: inputText,
      categories: [result.category].filter(Boolean),
      priority: result.priority || 'normal',
      summary: result.summary || '',
      suggested_action: result.suggested_action || 'none',
      draft_reply: result.draft_reply || '',
      status: 'unread',
      metadata: { extracted_data: result.extracted_data || {} }
    })

    if (error) { showToast('Error saving'); setAnalyzing(false); return }
    showToast('Email analyzed')
    setInputText(''); setShowCompose(false); setAnalyzing(false)
    loadEmails()
  }

  // AI suggests which job an email belongs to
  async function suggestJobMatch(email) {
    const jobList = jobs.slice(0, 20).map(j => ({
      id: j.id, name: j.name, number: j.job_number,
      client: j.clients?.name, address: j.site_address,
      units: j.unit_numbers, claim: j.insurance_claim_number
    }))

    const result = await askAIJSON(
      `Email:\nFrom: ${email.from_name || email.from_address}\nSubject: ${email.subject}\nBody: ${(email.body || '').slice(0, 500)}\n\nExisting jobs:\n${JSON.stringify(jobList)}\n\nWhich job does this email most likely relate to? If no match, say null.`,
      `You match incoming emails to existing jobs for a facility management company.
Look at client names, addresses, unit numbers, claim numbers, and subject matter to find the best match.
Return JSON: { "job_id": "uuid or null", "confidence": "high" | "medium" | "low", "reason": "brief explanation" }
Only return valid JSON.`
    )
    return result
  }

  async function linkEmailToJob(emailId, jobId) {
    await supabase.from('inbox_emails').update({
      status: 'actioned',
      actioned_at: new Date().toISOString(),
      metadata: { ...(showDetail?.metadata || {}), linked_job_id: jobId }
    }).eq('id', emailId)

    // Add to job activity
    const email = emails.find(e => e.id === emailId)
    if (email) {
      await supabase.from('job_activity').insert({
        company_id: companyId, job_id: jobId, author_id: profile?.id,
        type: 'email_received',
        content: `Email from ${email.from_name || email.from_address}: ${email.subject}`,
        metadata: { email_id: emailId, summary: email.summary }
      })
    }

    showToast('Email linked to job')
    setShowDetail(null)
    loadEmails()
  }

  async function createJobFromEmail(email) {
    const extracted = email.metadata?.extracted_data || {}
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

    if (!clientId) { showToast('Could not determine client'); return }

    const { data: jobNum } = await supabase.rpc('generate_job_number', { p_company_id: companyId })
    const { data: job, error } = await supabase.from('jobs').insert({
      company_id: companyId, job_number: jobNum || ('JOB-' + Date.now()),
      client_id: clientId, name: email.subject || 'New Job',
      description: email.summary || '', stage: 'lead',
      priority: email.priority || 'normal',
      site_address: extracted.address || '',
      insurance_claim_number: extracted.claim_number || '',
      created_by: profile?.id
    }).select().single()

    if (error) { showToast('Error creating job'); return }

    await linkEmailToJob(email.id, job.id)
    showToast('Job created and email linked!')
    loadJobs()
  }

  async function markRead(email) {
    if (email.status === 'unread') {
      await supabase.from('inbox_emails').update({ status: 'read' }).eq('id', email.id)
      email.status = 'read'
    }
    // Auto-suggest job match
    if (!email.metadata?.linked_job_id && !email._suggestion) {
      const suggestion = await suggestJobMatch(email)
      email._suggestion = suggestion
    }
    setShowDetail({ ...email })
  }

  async function deleteEmail(id) {
    if (!confirm('Delete?')) return
    await supabase.from('inbox_emails').delete().eq('id', id)
    showToast('Deleted'); setShowDetail(null); loadEmails()
  }

  function timeAgo(iso) {
    const diff = Date.now() - new Date(iso).getTime()
    const m = Math.floor(diff / 60000)
    if (m < 1) return 'Now'; if (m < 60) return m + 'm'
    const h = Math.floor(m / 60); if (h < 24) return h + 'h'
    return Math.floor(h / 24) + 'd'
  }

  const unread = emails.filter(e => e.status === 'unread')
  const suggestions = emails.filter(e => e.status !== 'actioned' && !e.metadata?.linked_job_id)
  const linked = emails.filter(e => e.metadata?.linked_job_id)

  const displayEmails = tab === 'suggestions' ? suggestions :
    tab === 'linked' ? linked :
    filter === 'all' ? emails :
    filter === 'unread' ? unread :
    emails.filter(e => (e.categories || []).includes(filter))

  if (loading) return <div className="loading-center"><div className="spinner" /></div>

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">AI Smart Inbox</div>
          <div className="page-subtitle">{unread.length} unread · {suggestions.length} need sorting</div>
        </div>
      </div>

      {/* Gmail Connection */}
      <div style={{ padding: '0 16px 8px' }}>
        {gmailConnected ? (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            background: 'rgba(0,212,160,0.04)', border: '1px solid rgba(0,212,160,0.15)',
            borderRadius: 14, padding: '10px 14px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 16 }}>✅</span>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--primary)' }}>Gmail Connected</div>
                <div style={{ fontSize: 11, color: 'var(--text3)' }}>{gmailEmail}</div>
              </div>
            </div>
            <button onClick={() => fetchGmailEmails()} disabled={syncing} style={{
              padding: '8px 14px', borderRadius: 10, fontSize: 12, fontWeight: 700,
              background: syncing ? 'var(--card2)' : 'linear-gradient(135deg, var(--primary), var(--primary2))',
              border: 'none', color: syncing ? 'var(--text2)' : '#000', cursor: 'pointer', fontFamily: 'DM Sans'
            }}>{syncing ? '⏳ Syncing...' : '🔄 Sync Now'}</button>
          </div>
        ) : (
          <button onClick={connectGmail} style={{
            width: '100%', padding: 14, borderRadius: 14,
            background: 'linear-gradient(135deg, rgba(0,212,160,0.08), rgba(0,153,255,0.08))',
            border: '1px solid rgba(0,212,160,0.2)', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
            fontFamily: 'DM Sans', fontSize: 14, fontWeight: 700, color: 'var(--primary)'
          }}>📧 Connect Gmail — emails sync automatically</button>
        )}
      </div>

      {/* Paste email (always available) */}
      {!showCompose ? (
        <div style={{ padding: '0 16px 8px' }}>
          <button onClick={() => setShowCompose(true)} style={{
            width: '100%', padding: 12, borderRadius: 12,
            background: 'var(--card)', border: '1px solid var(--border)', cursor: 'pointer',
            fontSize: 12, fontWeight: 700, color: 'var(--text2)', fontFamily: 'DM Sans'
          }}>📋 Or paste an email manually</button>
        </div>
      ) : (
        <div style={{ margin: '0 16px 8px', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 14 }}>
          <textarea style={{
            width: '100%', background: 'var(--bg2)', border: '1px solid var(--border2)',
            borderRadius: 12, padding: 12, fontSize: 13, color: 'var(--text)',
            fontFamily: 'DM Sans', outline: 'none', resize: 'none', minHeight: 100, lineHeight: 1.6
          }} placeholder="Paste email text..." value={inputText} onChange={e => setInputText(e.target.value)} />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button onClick={analyzeAndSave} disabled={analyzing} style={{
              flex: 1, padding: 10, borderRadius: 10,
              background: analyzing ? 'var(--card2)' : 'linear-gradient(135deg, var(--primary), var(--primary2))',
              border: 'none', color: analyzing ? 'var(--text2)' : '#000', fontSize: 12, fontWeight: 800,
              cursor: 'pointer', fontFamily: 'DM Sans'
            }}>{analyzing ? '⏳ Analyzing...' : '🤖 Analyze'}</button>
            <button onClick={() => setShowCompose(false)} style={{
              padding: '10px 14px', borderRadius: 10, background: 'var(--card2)',
              border: '1px solid var(--border)', color: 'var(--text2)', fontSize: 12,
              cursor: 'pointer', fontFamily: 'DM Sans'
            }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Tabs: Inbox | Suggestions | Linked */}
      <div style={{ display: 'flex', gap: 0, margin: '0 16px 8px', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
        {[
          { id: 'inbox', label: `Inbox (${emails.length})` },
          { id: 'suggestions', label: `Sort (${suggestions.length})` },
          { id: 'linked', label: `Linked (${linked.length})` }
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            flex: 1, padding: 10, fontSize: 12, fontWeight: 800,
            border: 'none', cursor: 'pointer', fontFamily: 'DM Sans',
            background: tab === t.id ? 'rgba(0,212,160,0.1)' : 'transparent',
            color: tab === t.id ? 'var(--primary)' : 'var(--text2)'
          }}>{t.label}</button>
        ))}
      </div>

      {/* Category filters (inbox tab only) */}
      {tab === 'inbox' && (
        <div style={{ display: 'flex', gap: 6, padding: '0 16px 8px', overflowX: 'auto', scrollbarWidth: 'none' }}>
          {['all', 'unread', 'insurance', 'client', 'supplier', 'urgent'].map(f => (
            <div key={f} onClick={() => setFilter(f)} style={{
              padding: '5px 10px', borderRadius: 8, fontSize: 10, fontWeight: 700,
              cursor: 'pointer', whiteSpace: 'nowrap',
              border: `1px solid ${filter === f ? 'rgba(0,212,160,0.3)' : 'var(--border)'}`,
              background: filter === f ? 'rgba(0,212,160,0.1)' : 'var(--card)',
              color: filter === f ? 'var(--primary)' : 'var(--text2)'
            }}>{f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}</div>
          ))}
        </div>
      )}

      {/* Email List */}
      <div className="sec">
        {displayEmails.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">{tab === 'suggestions' ? '✅' : tab === 'linked' ? '🔗' : '📬'}</div>
            <div className="empty-title">
              {tab === 'suggestions' ? 'All sorted!' : tab === 'linked' ? 'No linked emails' : 'No emails yet'}
            </div>
            <div className="empty-sub">
              {tab === 'suggestions' ? 'All emails have been linked to jobs' :
                gmailConnected ? 'Tap Sync Now to pull new emails' : 'Connect Gmail or paste an email'}
            </div>
          </div>
        ) : displayEmails.map(email => {
          const cat = (email.categories || [])[0] || 'client'
          const catStyle = CAT_COLORS[cat] || CAT_COLORS.client
          const isLinked = email.metadata?.linked_job_id
          const linkedJob = isLinked ? jobs.find(j => j.id === isLinked) : null

          return (
            <div key={email.id} className="card" onClick={() => markRead(email)} style={{
              borderLeft: email.status === 'unread' ? '3px solid var(--primary)' :
                isLinked ? '3px solid var(--blue)' : '3px solid transparent',
              position: 'relative', zIndex: 1, cursor: 'pointer'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <div style={{ fontSize: 13, fontWeight: email.status === 'unread' ? 800 : 600, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {email.from_name || email.from_address || 'Unknown'}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text3)', flexShrink: 0, marginLeft: 8 }}>{timeAgo(email.created_at)}</div>
              </div>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{email.subject}</div>
              <div style={{ fontSize: 11, color: 'var(--text2)', lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{email.summary}</div>
              <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ padding: '2px 6px', borderRadius: 5, fontSize: 9, fontWeight: 700, background: catStyle.bg, color: catStyle.color }}>{cat.toUpperCase()}</span>
                {email.priority === 'urgent' && <span style={{ padding: '2px 6px', borderRadius: 5, fontSize: 9, fontWeight: 700, background: 'rgba(255,59,92,0.12)', color: '#FF3B5C' }}>URGENT</span>}
                {isLinked && linkedJob && <span style={{ padding: '2px 6px', borderRadius: 5, fontSize: 9, fontWeight: 700, background: 'rgba(33,150,243,0.12)', color: 'var(--blue)' }}>🔗 {linkedJob.job_number}</span>}
                {!isLinked && email.suggested_action === 'create_job' && <span style={{ padding: '2px 6px', borderRadius: 5, fontSize: 9, fontWeight: 700, background: 'rgba(0,212,160,0.1)', color: 'var(--primary)', border: '1px solid rgba(0,212,160,0.2)' }}>→ NEW JOB</span>}
              </div>
            </div>
          )
        })}
      </div>

      {/* Email Detail Modal */}
      {showDetail && (
        <Modal title="Email" onClose={() => setShowDetail(null)}>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 3 }}>From: {showDetail.from_name || showDetail.from_address}</div>
          <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 10 }}>{showDetail.subject}</div>

          <div style={{ display: 'flex', gap: 4, marginBottom: 10, flexWrap: 'wrap' }}>
            {(showDetail.categories || []).map(c => {
              const s = CAT_COLORS[c] || CAT_COLORS.client
              return <span key={c} style={{ padding: '3px 8px', borderRadius: 6, fontSize: 9, fontWeight: 700, background: s.bg, color: s.color }}>{c.toUpperCase()}</span>
            })}
          </div>

          {/* AI Summary */}
          <div style={{ background: 'rgba(0,212,160,0.04)', border: '1px solid rgba(0,212,160,0.12)', borderRadius: 12, padding: 12, marginBottom: 10 }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--primary)', marginBottom: 4 }}>🤖 AI SUMMARY</div>
            <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.6 }}>{showDetail.summary}</div>
          </div>

          {/* Email body */}
          <div style={{ background: 'var(--bg2)', borderRadius: 12, padding: 12, fontSize: 12, color: 'var(--text2)', lineHeight: 1.6, maxHeight: 150, overflow: 'auto', whiteSpace: 'pre-wrap', marginBottom: 10 }}>
            {showDetail.body || showDetail.raw_text}
          </div>

          {/* AI Job Suggestion */}
          {showDetail._suggestion && showDetail._suggestion.job_id && (
            <div style={{ background: 'rgba(33,150,243,0.06)', border: '1px solid rgba(33,150,243,0.2)', borderRadius: 12, padding: 12, marginBottom: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--blue)', marginBottom: 6 }}>🤖 AI SUGGESTS LINKING TO:</div>
              {(() => {
                const suggestedJob = jobs.find(j => j.id === showDetail._suggestion.job_id)
                return suggestedJob ? (
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{suggestedJob.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>{suggestedJob.job_number} · {suggestedJob.clients?.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 4 }}>Confidence: {showDetail._suggestion.confidence} — {showDetail._suggestion.reason}</div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                      <button onClick={() => linkEmailToJob(showDetail.id, suggestedJob.id)} style={{
                        flex: 1, padding: 10, borderRadius: 10, fontSize: 12, fontWeight: 700,
                        background: 'linear-gradient(135deg, var(--primary), var(--primary2))',
                        border: 'none', color: '#000', cursor: 'pointer', fontFamily: 'DM Sans'
                      }}>✓ Confirm Link</button>
                      <button onClick={() => { showDetail._suggestion = null; setShowDetail({ ...showDetail }) }} style={{
                        padding: '10px 14px', borderRadius: 10, background: 'var(--card2)',
                        border: '1px solid var(--border)', color: 'var(--text2)', fontSize: 12,
                        cursor: 'pointer', fontFamily: 'DM Sans'
                      }}>✕ Wrong</button>
                    </div>
                  </div>
                ) : <div style={{ fontSize: 12, color: 'var(--text3)' }}>Job not found</div>
              })()}
            </div>
          )}

          {/* Manual link */}
          {!showDetail.metadata?.linked_job_id && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--text3)', letterSpacing: 1, marginBottom: 6 }}>LINK TO JOB</div>
              <select className="form-input" style={{ fontSize: 13 }} onChange={e => { if (e.target.value) linkEmailToJob(showDetail.id, e.target.value) }}>
                <option value="">Select job to link...</option>
                {jobs.map(j => <option key={j.id} value={j.id}>{j.job_number} — {j.name} ({j.clients?.name})</option>)}
              </select>
            </div>
          )}

          {showDetail.metadata?.linked_job_id && (
            <div style={{ background: 'rgba(33,150,243,0.06)', border: '1px solid rgba(33,150,243,0.15)', borderRadius: 12, padding: 12, marginBottom: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--blue)', marginBottom: 4 }}>🔗 LINKED TO</div>
              {(() => {
                const lj = jobs.find(j => j.id === showDetail.metadata.linked_job_id)
                return lj ? <div style={{ fontSize: 13, fontWeight: 700 }}>{lj.job_number} — {lj.name}</div> : <div>Job not found</div>
              })()}
            </div>
          )}

          {/* Draft reply */}
          {showDetail.draft_reply && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--text3)', letterSpacing: 1, marginBottom: 6 }}>SUGGESTED REPLY</div>
              <textarea className="form-input" style={{ fontSize: 12, minHeight: 60 }} defaultValue={showDetail.draft_reply} />
              <button className="btn btn-secondary" style={{ marginTop: 6, fontSize: 11, padding: '6px 12px' }}
                onClick={() => navigator.clipboard.writeText(showDetail.draft_reply).then(() => showToast('Copied'))}>📋 Copy</button>
            </div>
          )}

          {/* Actions */}
          {!showDetail.metadata?.linked_job_id && showDetail.suggested_action === 'create_job' && (
            <button className="btn btn-primary btn-full" style={{ marginBottom: 8 }} onClick={() => createJobFromEmail(showDetail)}>
              🤖 Create New Job from Email
            </button>
          )}

          <button className="btn btn-danger btn-full" style={{ marginBottom: 8 }} onClick={() => deleteEmail(showDetail.id)}>Delete</button>
          <button className="btn btn-secondary btn-full" onClick={() => setShowDetail(null)}>Close</button>
        </Modal>
      )}
    </div>
  )
}

import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useToast } from '../shared/Toast'
import Modal from '../shared/Modal'
import { categorizeEmail, analyzeEmailFull, askAIJSON } from '../../lib/ai'

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
  const [sortMode, setSortMode] = useState('address') // 'address' or 'name'
  const [gmailConnected, setGmailConnected] = useState(false)
  const [gmailEmail, setGmailEmail] = useState('')

  useEffect(() => {
    if (companyId) { loadEmails(); loadJobs(); loadClients(); checkGmail() }
  }, [companyId])

  // Auto-sync Gmail every 5 minutes
  useEffect(() => {
    if (!gmailConnected || !companyId) return
    // Sync on first load
    fetchGmailEmails(true)
    // Then every 5 minutes
    const interval = setInterval(() => fetchGmailEmails(true), 30 * 1000)
    return () => clearInterval(interval)
  }, [gmailConnected, companyId])

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

  async function fetchGmailEmails(silent = false) {
    if (syncing) return // Don't stack syncs
    setSyncing(true)
    try {
      // Only fetch emails newer than what we already have
      const newestEmail = emails.length > 0 ? emails[0] : null
      const afterDate = newestEmail?.metadata?.date
        ? new Date(newestEmail.metadata.date).toISOString().split('T')[0].replace(/-/g, '/')
        : null

      const res = await fetch('/.netlify/functions/gmail-fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId, max_results: 100, after_date: afterDate })
      })

      const data = await res.json()
      if (data.error) { if (!silent) showToast('Gmail: ' + data.error); setSyncing(false); return }

      // Check which emails we already have
      const existingIds = emails.map(e => e.metadata?.gmail_id).filter(Boolean)
      const newEmails = (data.emails || []).filter(e => !existingIds.includes(e.gmail_id))

      if (newEmails.length === 0) {
        if (!silent) showToast('No new emails')
        setSyncing(false)
        return
      }

      // Quick categorize with Haiku (cheap ~$0.001/email) — full analysis happens when user opens
      let saved = 0
      for (const email of newEmails) {
        const quick = await categorizeEmail(`From: ${email.from}\nSubject: ${email.subject}\n\n${email.body.slice(0, 500)}`)

        // Auto-link if same thread as an already-linked email
        let autoLinkedJobId = null
        if (email.thread_id) {
          const threadMatch = emails.find(e =>
            e.metadata?.thread_id === email.thread_id &&
            e.metadata?.linked_job_id
          )
          if (threadMatch) autoLinkedJobId = threadMatch.metadata.linked_job_id
        }

        const { data: savedEmail, error } = await supabase.from('inbox_emails').insert({
          company_id: companyId,
          from_address: email.from,
          from_name: quick?.from_name || email.from.split('<')[0].trim(),
          subject: email.subject,
          body: email.body,
          raw_text: `From: ${email.from}\nSubject: ${email.subject}\n\n${email.body}`,
          categories: quick ? [quick.category].filter(Boolean) : ['client'],
          priority: quick?.priority || 'normal',
          summary: quick?.summary || email.snippet,
          suggested_action: quick?.suggested_action || 'none',
          draft_reply: '',
          status: autoLinkedJobId ? 'actioned' : 'unread',
          metadata: {
            gmail_id: email.gmail_id,
            thread_id: email.thread_id,
            needs_full_analysis: true,
            date: email.date,
            linked_job_id: autoLinkedJobId
          }
        }).select().single()

        // If auto-linked, add to job activity
        if (!error && autoLinkedJobId && savedEmail) {
          await supabase.from('job_activity').insert({
            company_id: companyId, job_id: autoLinkedJobId, author_id: profile?.id,
            type: 'email_received',
            content: `Email from ${email.from.split('<')[0].trim()}: ${email.subject}`,
            metadata: { email_id: savedEmail.id }
          })
        }

        if (!error) saved++
      }

      if (!silent || saved > 0) showToast(`${saved} new email${saved !== 1 ? 's' : ''} synced`)
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
    // Quick categorize with Haiku (cheap) — full analysis when user opens
    const result = await categorizeEmail(inputText.slice(0, 500))
    if (!result) { showToast('AI could not analyze'); setAnalyzing(false); return }

    const { error } = await supabase.from('inbox_emails').insert({
      company_id: companyId,
      from_address: result.from_name || 'Unknown',
      from_name: result.from_name,
      subject: result.summary || 'Pasted email',
      body: inputText, raw_text: inputText,
      categories: [result.category].filter(Boolean),
      priority: result.priority || 'normal',
      summary: result.summary || '',
      suggested_action: result.suggested_action || 'none',
      draft_reply: '',
      status: 'unread',
      metadata: { needs_full_analysis: true }
    })

    if (error) { showToast('Error saving'); setAnalyzing(false); return }
    showToast('Email analyzed')
    setInputText(''); setShowCompose(false); setAnalyzing(false)
    loadEmails()
  }

  // Suggest which job an email belongs to
  // Priority: 1) Same thread as linked email  2) AI match by address+units  3) AI match by client
  async function suggestJobMatch(email) {
    // 1. Check if another email in the same thread is already linked
    if (email.metadata?.thread_id) {
      const threadMatch = emails.find(e =>
        e.id !== email.id &&
        e.metadata?.thread_id === email.metadata.thread_id &&
        e.metadata?.linked_job_id
      )
      if (threadMatch) {
        const linkedJob = jobs.find(j => j.id === threadMatch.metadata.linked_job_id)
        return {
          job_id: threadMatch.metadata.linked_job_id,
          confidence: 'high',
          reason: `Same email thread as ${linkedJob?.job_number || 'a linked email'}`
        }
      }
    }

    // 2. AI match — prioritize address and unit numbers over client name
    const jobList = jobs.slice(0, 30).map(j => ({
      id: j.id, name: j.name, number: j.job_number,
      client: j.clients?.name, address: j.site_address,
      units: j.unit_numbers, claim: j.insurance_claim_number
    }))

    const result = await askAIJSON(
      `Email:\nFrom: ${email.from_name || email.from_address}\nSubject: ${email.subject}\nBody: ${(email.body || '').slice(0, 800)}\n\nExisting jobs:\n${JSON.stringify(jobList)}\n\nWhich job does this email relate to?`,
      `You match incoming emails to existing jobs for a facility management / restoration company.

MATCHING PRIORITY (most important first):
1. ADDRESS — if the email mentions a specific street address, match to the job at that address
2. UNIT NUMBERS — if units are mentioned, match to the job with those units
3. INSURANCE CLAIM NUMBER — if a claim # is mentioned, match to that claim
4. EMAIL THREAD CONTEXT — the subject line "Re:" indicates a reply chain about a specific job
5. CLIENT NAME — only use client name if nothing else matches. One client can have MANY jobs, so client name alone is NOT enough.

IMPORTANT: Do NOT match by client name alone if the email mentions a specific address that doesn't match any job. That means it's a NEW job, return null.

Return JSON: { "job_id": "uuid or null", "confidence": "high" | "medium" | "low", "reason": "brief explanation of what matched" }
Only return valid JSON.`, 256, 'haiku'
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

  const [showCreateJobModal, setShowCreateJobModal] = useState(false)
  const [createJobEmail, setCreateJobEmail] = useState(null)
  const [createJobClientId, setCreateJobClientId] = useState('')
  const [createJobNewClient, setCreateJobNewClient] = useState('')
  const [createJobForm, setCreateJobForm] = useState({ name: '', description: '', site_address: '', priority: 'normal', insurance_claim_number: '' })

  function startCreateJobFromEmail(email) {
    const extracted = email.metadata?.extracted_data || {}
    setCreateJobEmail(email)
    setCreateJobNewClient(extracted.client_name || email.from_name || '')
    setCreateJobClientId('')
    // Build description from AI summary + email body
    let desc = ''
    if (email.summary) desc += email.summary
    if (email.body && email.body !== email.summary) {
      if (desc) desc += '\n\n--- Original Email ---\n\n'
      desc += email.body
    }

    // Clean AI values — strip placeholder text
    const clean = (v) => {
      if (!v || v === 'null') return ''
      const lower = v.toString().toLowerCase()
      if (lower.includes('not mentioned') || lower.includes('not specified') || lower.includes('not provided') || lower.includes('[') || lower === 'n/a' || lower === 'none' || lower === 'unknown') return ''
      return v
    }

    setCreateJobForm({
      name: email.subject || '',
      description: extracted.scope_details ? (clean(extracted.scope_details) + (email.summary ? '\n\n' + email.summary : '')) : (desc || email.raw_text || ''),
      stage: 'lead',
      priority: email.priority || 'normal',
      job_type: clean(extracted.job_type) || '',
      estimated_value: clean(extracted.amount),
      site_address: clean(extracted.address),
      site_city: clean(extracted.city),
      site_province_state: clean(extracted.province_state),
      unit_numbers: clean(extracted.unit_numbers),
      scheduled_start: '',
      scheduled_end: '',
      insurance_company: clean(extracted.insurance_company),
      insurance_claim_number: clean(extracted.claim_number),
      notes: ''
    })
    setShowCreateJobModal(true)
  }

  async function confirmCreateJobFromEmail() {
    if (!createJobEmail) return
    const extracted = createJobEmail.metadata?.extracted_data || {}
    let clientId = createJobClientId

    // Create new client if no existing one selected
    if (!clientId && createJobNewClient.trim()) {
      const { data: newClient } = await supabase.from('clients').insert({
        company_id: companyId, name: createJobNewClient.trim(), type: 'commercial',
        contact_email: createJobEmail.from_address || null
      }).select().single()
      if (newClient) clientId = newClient.id
      loadClients()
    }

    if (!clientId) { showToast('Please select or enter a client name'); return }
    if (!createJobForm.name.trim()) { showToast('Please enter a job name'); return }

    const { data: jobNum } = await supabase.rpc('generate_job_number', { p_company_id: companyId })
    const { data: job, error } = await supabase.from('jobs').insert({
      company_id: companyId, job_number: jobNum || ('JOB-' + Date.now()),
      client_id: clientId,
      name: createJobForm.name.trim(),
      description: createJobForm.description.trim(),
      stage: createJobForm.stage || 'lead',
      priority: createJobForm.priority || 'normal',
      job_type: createJobForm.job_type || null,
      estimated_value: createJobForm.estimated_value ? parseFloat(createJobForm.estimated_value) : null,
      site_address: createJobForm.site_address?.trim() || null,
      site_city: createJobForm.site_city?.trim() || null,
      site_province_state: createJobForm.site_province_state?.trim() || null,
      unit_numbers: createJobForm.unit_numbers?.trim() || null,
      scheduled_start: createJobForm.scheduled_start || null,
      scheduled_end: createJobForm.scheduled_end || null,
      insurance_company: createJobForm.insurance_company?.trim() || null,
      insurance_claim_number: createJobForm.insurance_claim_number?.trim() || null,
      notes: createJobForm.notes?.trim() || null,
      created_by: profile?.id
    }).select().single()

    if (error) { showToast('Error creating job'); console.error(error); return }

    await linkEmailToJob(createJobEmail.id, job.id)
    showToast('Job created and email linked!')
    setShowCreateJobModal(false)
    setShowDetail(null)
    loadJobs()
  }

  const [opening, setOpening] = useState(false)

  async function openEmail(email) {
    if (opening || showDetail) return // Prevent double-tap
    setOpening(true)

    // Open detail immediately — don't wait for AI
    setShowDetail({ ...email, _openedFrom: tab, _analyzing: email.metadata?.needs_full_analysis })

    // Mark as read in background
    if (email.status === 'unread') {
      supabase.from('inbox_emails').update({ status: 'read' }).eq('id', email.id)
      email.status = 'read'
    }

    // Run FULL analysis with Sonnet if not done yet (on-demand, only when user opens)
    if (email.metadata?.needs_full_analysis) {
      const body = (email.body || email.raw_text || '').slice(0, 2000)
      const fullText = `From: ${email.from_name || email.from_address}\nSubject: ${email.subject}\n\n${body}`
      Promise.race([
        analyzeEmailFull(fullText),
        new Promise(r => setTimeout(() => r(null), 15000)) // 15s timeout
      ]).then(async (fullResult) => {
        if (fullResult) {
          // Update in database
          await supabase.from('inbox_emails').update({
            summary: fullResult.summary || email.summary,
            draft_reply: fullResult.draft_reply || '',
            metadata: {
              ...email.metadata,
              needs_full_analysis: false,
              extracted_data: fullResult.extracted_data || {}
            }
          }).eq('id', email.id)

          // Update the modal
          const updated = {
            ...email,
            summary: fullResult.summary || email.summary,
            draft_reply: fullResult.draft_reply || '',
            metadata: { ...email.metadata, needs_full_analysis: false, extracted_data: fullResult.extracted_data || {} },
            _openedFrom: tab,
            _analyzing: false
          }
          setShowDetail(prev => prev?.id === email.id ? updated : prev)
        } else {
          // Timed out or failed — stop spinner
          setShowDetail(prev => prev?.id === email.id ? { ...prev, _analyzing: false } : prev)
        }
      })
    }

    // Suggest job match in background
    if (!email.metadata?.linked_job_id && !email._suggestion) {
      suggestJobMatch(email).then(suggestion => {
        if (suggestion) {
          email._suggestion = suggestion
          setShowDetail(prev => prev?.id === email.id ? { ...prev, _suggestion: suggestion } : prev)
        }
      })
    }

    setOpening(false)
  }

  async function unlinkEmail(id) {
    const email = emails.find(e => e.id === id)
    const meta = { ...(email?.metadata || {}) }
    delete meta.linked_job_id
    await supabase.from('inbox_emails').update({
      status: 'read', actioned_at: null, metadata: meta
    }).eq('id', id)
    showToast('Email unlinked')
    setShowDetail(null)
    loadEmails()
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
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--primary)' }}>Gmail Connected — Auto-syncing</div>
                <div style={{ fontSize: 11, color: 'var(--text3)' }}>{gmailEmail} · auto-syncing</div>
              </div>
            </div>
            <button onClick={() => fetchGmailEmails(false)} disabled={syncing} style={{
              padding: '8px 14px', borderRadius: 10, fontSize: 12, fontWeight: 700,
              background: syncing ? 'var(--card2)' : 'var(--card)',
              border: '1px solid var(--border)', color: syncing ? 'var(--text3)' : 'var(--text2)', cursor: 'pointer', fontFamily: 'DM Sans'
            }}>{syncing ? '⏳ ...' : '🔄'}</button>
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

      {/* Sort mode toggle */}
      <div style={{ display: 'flex', gap: 0, margin: '0 16px 8px', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
        <button onClick={() => setSortMode('address')} style={{
          flex: 1, padding: '8px 12px', fontSize: 11, fontWeight: 700,
          border: 'none', cursor: 'pointer', fontFamily: 'DM Sans',
          background: sortMode === 'address' ? 'rgba(0,212,160,0.1)' : 'transparent',
          color: sortMode === 'address' ? 'var(--primary)' : 'var(--text3)'
        }}>📍 By Address</button>
        <button onClick={() => setSortMode('name')} style={{
          flex: 1, padding: '8px 12px', fontSize: 11, fontWeight: 700,
          border: 'none', cursor: 'pointer', fontFamily: 'DM Sans',
          background: sortMode === 'name' ? 'rgba(0,212,160,0.1)' : 'transparent',
          color: sortMode === 'name' ? 'var(--primary)' : 'var(--text3)'
        }}>👤 By Name</button>
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
            <div key={email.id} className="card" onClick={() => openEmail(email)} style={{
              borderLeft: email.status === 'unread' ? '3px solid var(--primary)' :
                isLinked ? '3px solid var(--blue)' : '3px solid transparent',
              position: 'relative', zIndex: 1, cursor: 'pointer'
            }}>
              {/* Primary line — address or name based on sort mode */}
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <div style={{ fontSize: 13, fontWeight: email.status === 'unread' ? 800 : 600, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {sortMode === 'address'
                    ? (email.metadata?.extracted_data?.address || email.metadata?.extracted_data?.unit_numbers
                        ? `📍 ${email.metadata?.extracted_data?.address || ''}${email.metadata?.extracted_data?.unit_numbers ? ' · Unit ' + email.metadata.extracted_data.unit_numbers : ''}`
                        : email.subject)
                    : (email.from_name || email.from_address || 'Unknown')
                  }
                </div>
                <div style={{ fontSize: 10, color: 'var(--text3)', flexShrink: 0, marginLeft: 8 }}>{timeAgo(email.created_at)}</div>
              </div>
              {/* Secondary line — the other view */}
              <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 3 }}>
                {sortMode === 'address'
                  ? (email.from_name || email.from_address || '')
                  : (email.metadata?.extracted_data?.address ? '📍 ' + email.metadata.extracted_data.address : '')
                }
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
        <Modal title={null} onClose={() => setShowDetail(null)}>
          {/* Sort mode banner */}
          {showDetail._openedFrom === 'suggestions' && !showDetail.metadata?.linked_job_id && (
            <div style={{
              background: 'rgba(255,184,0,0.08)', border: '1px solid rgba(255,184,0,0.2)',
              borderRadius: 12, padding: '12px 14px', marginBottom: 14,
              display: 'flex', alignItems: 'center', gap: 10
            }}>
              <span style={{ fontSize: 20 }}>📂</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--yellow)' }}>Sort this email</div>
                <div style={{ fontSize: 11, color: 'var(--text3)' }}>Link it to an existing job or create a new one</div>
              </div>
            </div>
          )}

          {/* Header */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ fontSize: 12, color: 'var(--text3)' }}>
                {showDetail.from_name || showDetail.from_address}
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                {(showDetail.categories || []).map(c => {
                  const s = CAT_COLORS[c] || CAT_COLORS.client
                  return <span key={c} style={{ padding: '3px 8px', borderRadius: 6, fontSize: 9, fontWeight: 700, background: s.bg, color: s.color }}>{c.toUpperCase()}</span>
                })}
                {showDetail.priority === 'urgent' && <span style={{ padding: '3px 8px', borderRadius: 6, fontSize: 9, fontWeight: 700, background: 'rgba(255,59,92,0.12)', color: '#FF3B5C' }}>URGENT</span>}
              </div>
            </div>
            <div style={{ fontSize: 18, fontWeight: 800, lineHeight: 1.3 }}>{showDetail.subject}</div>
          </div>

          {/* Linked status */}
          {showDetail.metadata?.linked_job_id && (() => {
            const lj = jobs.find(j => j.id === showDetail.metadata.linked_job_id)
            return lj ? (
              <div style={{ background: 'rgba(33,150,243,0.06)', border: '1px solid rgba(33,150,243,0.15)', borderRadius: 14, padding: '12px 14px', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 18 }}>🔗</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--blue)', letterSpacing: 0.5 }}>LINKED TO</div>
                  <div style={{ fontSize: 14, fontWeight: 700, marginTop: 2 }}>{lj.job_number} — {lj.name}</div>
                </div>
                <button onClick={() => unlinkEmail(showDetail.id)} style={{
                  background: 'none', border: '1px solid rgba(255,59,92,0.3)', borderRadius: 8,
                  padding: '6px 10px', fontSize: 11, fontWeight: 700, color: 'var(--red)',
                  cursor: 'pointer', fontFamily: 'DM Sans'
                }}>Unlink</button>
              </div>
            ) : null
          })()}

          {/* AI Summary */}
          <div style={{ background: 'rgba(0,212,160,0.04)', border: '1px solid rgba(0,212,160,0.12)', borderRadius: 14, padding: 16, marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <span style={{ fontSize: 14 }}>🤖</span>
              <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--primary)', letterSpacing: 0.5 }}>AI SUMMARY</span>
              {showDetail._analyzing && <div className="spinner" style={{ width: 12, height: 12, borderWidth: 2, marginLeft: 4 }} />}
            </div>
            <div style={{ fontSize: 14, color: 'var(--text)', lineHeight: 1.7 }}>
              {showDetail.summary}
              {showDetail._analyzing && <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 8 }}>Running deep analysis...</div>}
            </div>
          </div>

          {/* AI Job Suggestion */}
          {!showDetail.metadata?.linked_job_id && !showDetail._suggestion && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', marginBottom: 14, background: 'var(--bg2)', borderRadius: 12 }}>
              <div className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
              <span style={{ color: 'var(--text3)', fontSize: 13 }}>Finding matching job...</span>
            </div>
          )}

          {showDetail._suggestion && showDetail._suggestion.job_id && !showDetail.metadata?.linked_job_id && (() => {
            const suggestedJob = jobs.find(j => j.id === showDetail._suggestion.job_id)
            return suggestedJob ? (
              <div style={{ background: 'rgba(33,150,243,0.06)', border: '1px solid rgba(33,150,243,0.2)', borderRadius: 14, padding: 16, marginBottom: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                  <span style={{ fontSize: 14 }}>🤖</span>
                  <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--blue)', letterSpacing: 0.5 }}>AI SUGGESTS LINKING TO</span>
                </div>
                <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 2 }}>{suggestedJob.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 4 }}>{suggestedJob.job_number} · {suggestedJob.clients?.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 12, lineHeight: 1.5 }}>
                  Confidence: <strong>{showDetail._suggestion.confidence}</strong> — {showDetail._suggestion.reason}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => linkEmailToJob(showDetail.id, suggestedJob.id)} className="btn btn-primary" style={{ flex: 1, padding: 12, fontSize: 13 }}>
                    ✓ Confirm Link
                  </button>
                  <button onClick={() => { showDetail._suggestion = null; setShowDetail({ ...showDetail }) }} className="btn btn-secondary" style={{ padding: '12px 16px', fontSize: 13 }}>
                    ✕ Wrong
                  </button>
                </div>
              </div>
            ) : null
          })()}

          {/* Manual link */}
          {!showDetail.metadata?.linked_job_id && (
            <div style={{ marginBottom: 14 }}>
              <label className="form-label">LINK TO JOB MANUALLY</label>
              <select className="form-input" onChange={e => { if (e.target.value) linkEmailToJob(showDetail.id, e.target.value) }}>
                <option value="">Select job...</option>
                {jobs.map(j => <option key={j.id} value={j.id}>{j.job_number} — {j.name} ({j.clients?.name})</option>)}
              </select>
            </div>
          )}

          {/* Email body — expandable */}
          <details style={{ marginBottom: 14 }}>
            <summary style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', letterSpacing: 1, cursor: 'pointer', padding: '8px 0', userSelect: 'none' }}>
              ORIGINAL EMAIL ▾
            </summary>
            <div style={{ background: 'var(--bg2)', borderRadius: 12, padding: 16, fontSize: 14, color: 'var(--text2)', lineHeight: 1.8, whiteSpace: 'pre-wrap', marginTop: 8, maxHeight: 300, overflow: 'auto' }}>
              {showDetail.body || showDetail.raw_text}
            </div>
          </details>

          {/* Suggested Reply */}
          {showDetail.draft_reply && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <label className="form-label" style={{ margin: 0 }}>SUGGESTED REPLY</label>
                <button className="btn btn-secondary" style={{ padding: '5px 12px', fontSize: 11 }}
                  onClick={() => {
                    const el = document.getElementById('draft-reply-text')
                    navigator.clipboard.writeText(el?.value || showDetail.draft_reply).then(() => showToast('Copied to clipboard'))
                  }}>📋 Copy</button>
              </div>
              <textarea id="draft-reply-text" className="form-input" style={{
                fontSize: 14, lineHeight: 1.7, minHeight: 160, color: 'var(--text)',
                background: 'var(--bg2)', padding: 16
              }} defaultValue={showDetail.draft_reply} />
            </div>
          )}

          {/* Action buttons */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
            {!showDetail.metadata?.linked_job_id && (
              <button className="btn btn-primary btn-full" style={{ padding: 14, fontSize: 14 }} onClick={() => startCreateJobFromEmail(showDetail)}>
                + Create New Job from Email
              </button>
            )}
            <button className="btn btn-danger btn-full" style={{ padding: 12 }} onClick={() => deleteEmail(showDetail.id)}>Delete Email</button>
            <button className="btn btn-secondary btn-full" style={{ padding: 12 }} onClick={() => setShowDetail(null)}>Close</button>
          </div>
        </Modal>
      )}

      {/* Create Job from Email Modal — Full form same as Jobs tab */}
      {showCreateJobModal && createJobEmail && (
        <Modal title="Create Job from Email" onClose={() => setShowCreateJobModal(false)}>
          {/* Email reference */}
          <div style={{ background: 'rgba(0,212,160,0.04)', border: '1px solid rgba(0,212,160,0.12)', borderRadius: 12, padding: 14, marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 2 }}>From: {createJobEmail.from_name || createJobEmail.from_address}</div>
            <div style={{ fontSize: 13, fontWeight: 700 }}>{createJobEmail.subject}</div>
          </div>

          {/* Client */}
          <div className="form-field">
            <label className="form-label">Client *</label>
            <select className="form-input" value={createJobClientId} onChange={e => { setCreateJobClientId(e.target.value); if (e.target.value) setCreateJobNewClient('') }}>
              <option value="">-- Select existing or create new --</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          {!createJobClientId && (
            <div className="form-field">
              <label className="form-label">Or New Client Name</label>
              <input className="form-input" placeholder="e.g. Maple Leaf Properties"
                value={createJobNewClient} onChange={e => setCreateJobNewClient(e.target.value)} />
            </div>
          )}

          {/* Job Name */}
          <div className="form-field">
            <label className="form-label">Job Name *</label>
            <input className="form-input" value={createJobForm.name}
              onChange={e => setCreateJobForm(f => ({ ...f, name: e.target.value }))} />
          </div>

          {/* Stage + Priority */}
          <div className="form-row">
            <div className="form-field">
              <label className="form-label">Stage</label>
              <select className="form-input" value={createJobForm.stage || 'lead'}
                onChange={e => setCreateJobForm(f => ({ ...f, stage: e.target.value }))}>
                <option value="lead">Lead</option>
                <option value="quoted">Quoted</option>
                <option value="active">Active</option>
              </select>
            </div>
            <div className="form-field">
              <label className="form-label">Priority</label>
              <select className="form-input" value={createJobForm.priority}
                onChange={e => setCreateJobForm(f => ({ ...f, priority: e.target.value }))}>
                <option value="emergency">Emergency</option>
                <option value="urgent">Urgent</option>
                <option value="normal">Normal</option>
                <option value="low">Low</option>
              </select>
            </div>
          </div>

          {/* Job Type + Value */}
          <div className="form-row">
            <div className="form-field">
              <label className="form-label">Job Type</label>
              <select className="form-input" value={createJobForm.job_type || ''}
                onChange={e => setCreateJobForm(f => ({ ...f, job_type: e.target.value }))}>
                <option value="">Select...</option>
                <option value="water_damage">Water Damage</option>
                <option value="fire_damage">Fire Damage</option>
                <option value="mold_remediation">Mold Remediation</option>
                <option value="storm_damage">Storm Damage</option>
                <option value="hvac">HVAC</option>
                <option value="plumbing">Plumbing</option>
                <option value="electrical">Electrical</option>
                <option value="cleaning">Cleaning</option>
                <option value="maintenance">Maintenance</option>
                <option value="inspection">Inspection</option>
                <option value="renovation">Renovation</option>
                <option value="general">General</option>
              </select>
            </div>
            <div className="form-field">
              <label className="form-label">Estimated Value ($)</label>
              <input className="form-input" type="number" placeholder="0.00"
                value={createJobForm.estimated_value || ''}
                onChange={e => setCreateJobForm(f => ({ ...f, estimated_value: e.target.value }))} />
            </div>
          </div>

          {/* Site Address */}
          <div className="form-field">
            <label className="form-label">Site Address</label>
            <input className="form-input" value={createJobForm.site_address}
              onChange={e => setCreateJobForm(f => ({ ...f, site_address: e.target.value }))} />
          </div>
          <div className="form-row">
            <div className="form-field">
              <label className="form-label">City</label>
              <input className="form-input" value={createJobForm.site_city || ''}
                onChange={e => setCreateJobForm(f => ({ ...f, site_city: e.target.value }))} />
            </div>
            <div className="form-field">
              <label className="form-label">Province/State</label>
              <input className="form-input" value={createJobForm.site_province_state || ''}
                onChange={e => setCreateJobForm(f => ({ ...f, site_province_state: e.target.value }))} />
            </div>
          </div>

          {/* Unit Numbers */}
          <div className="form-field">
            <label className="form-label">Unit Numbers</label>
            <input className="form-input" placeholder="e.g. 820, 416, 1003"
              value={createJobForm.unit_numbers || ''}
              onChange={e => setCreateJobForm(f => ({ ...f, unit_numbers: e.target.value }))} />
          </div>

          {/* Schedule */}
          <div className="form-row">
            <div className="form-field">
              <label className="form-label">Scheduled Start</label>
              <input className="form-input" type="datetime-local" value={createJobForm.scheduled_start || ''}
                onChange={e => setCreateJobForm(f => ({ ...f, scheduled_start: e.target.value }))} />
            </div>
            <div className="form-field">
              <label className="form-label">Scheduled End</label>
              <input className="form-input" type="datetime-local" value={createJobForm.scheduled_end || ''}
                onChange={e => setCreateJobForm(f => ({ ...f, scheduled_end: e.target.value }))} />
            </div>
          </div>

          {/* Insurance */}
          <div className="form-row">
            <div className="form-field">
              <label className="form-label">Insurance Company</label>
              <input className="form-input" placeholder="Optional"
                value={createJobForm.insurance_company || ''}
                onChange={e => setCreateJobForm(f => ({ ...f, insurance_company: e.target.value }))} />
            </div>
            <div className="form-field">
              <label className="form-label">Claim #</label>
              <input className="form-input" placeholder="Optional"
                value={createJobForm.insurance_claim_number}
                onChange={e => setCreateJobForm(f => ({ ...f, insurance_claim_number: e.target.value }))} />
            </div>
          </div>

          {/* Description */}
          <div className="form-field">
            <label className="form-label">Description / Scope</label>
            <textarea className="form-input" style={{ minHeight: 140, lineHeight: 1.7 }}
              value={createJobForm.description}
              onChange={e => setCreateJobForm(f => ({ ...f, description: e.target.value }))} />
          </div>

          {/* Notes */}
          <div className="form-field">
            <label className="form-label">Notes</label>
            <textarea className="form-input" placeholder="Internal notes..."
              value={createJobForm.notes || ''}
              onChange={e => setCreateJobForm(f => ({ ...f, notes: e.target.value }))} />
          </div>

          <button className="btn btn-primary btn-full" style={{ marginTop: 8, padding: 14, fontSize: 14 }} onClick={confirmCreateJobFromEmail}>
            Create Job & Link Email
          </button>
          <button className="btn btn-secondary btn-full" style={{ marginTop: 8 }} onClick={() => setShowCreateJobModal(false)}>
            Cancel
          </button>
        </Modal>
      )}
    </div>
  )
}

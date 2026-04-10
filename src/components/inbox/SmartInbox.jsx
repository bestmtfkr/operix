import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useToast } from '../shared/Toast'
import Modal from '../shared/Modal'
import { categorizeEmail, analyzeEmailFull, askAIJSON } from '../../lib/ai'
import './Inbox.css'

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
  const [emailSort, setEmailSort] = useState('newest')
  const [emailSearch, setEmailSearch] = useState('')
  const [teamMembers, setTeamMembers] = useState([])
  const [replyTemplates, setReplyTemplates] = useState([])
  const [newComment, setNewComment] = useState('')
  const [emailConfig, setEmailConfig] = useState({})
  const [gmailConnected, setGmailConnected] = useState(false)
  const [gmailEmail, setGmailEmail] = useState('')
  const [importing, setImporting] = useState(false)
  const [importProgress, setImportProgress] = useState({ done: 0, total: 0 })

  useEffect(() => {
    if (companyId) { loadEmails(); loadJobs(); loadClients(); checkGmail(); loadTeamAndConfig() }
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
            linked_job_id: autoLinkedJobId,
            attachments: email.attachments || []
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

  async function bulkImport() {
    if (importing) return
    showToast('Starting email import...')
    setImporting(true)
    setImportProgress({ done: 0, total: 0 })

    let pageToken = null
    let totalImported = 0
    let totalEstimated = 0

    // Get existing gmail IDs to skip duplicates
    const { data: existingEmails } = await supabase.from('inbox_emails')
      .select('metadata').eq('company_id', companyId)
    const existingIds = new Set((existingEmails || []).map(e => e.metadata?.gmail_id).filter(Boolean))

    do {
      try {
        const res = await fetch('/.netlify/functions/gmail-bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ company_id: companyId, page_token: pageToken, months_back: 6 })
        })

        if (!res.ok) {
          const errText = await res.text()
          console.error('Bulk fetch error:', res.status, errText)
          showToast('Import failed: ' + res.status)
          break
        }

        const data = await res.json()

        if (data.error) { showToast('Import error: ' + data.error); break }
        if (!data.emails || data.emails.length === 0) {
          showToast('No more emails to import')
          break
        }

        totalEstimated = data.total_estimated || totalEstimated

        // Filter out duplicates
        const newEmails = data.emails.filter(e => !existingIds.has(e.gmail_id))

        // Save in batch — no AI on bulk import, just store raw
        for (const email of newEmails) {
          // Check if thread already linked
          let autoLinkedJobId = null
          const threadLinked = emails.find(e =>
            e.metadata?.thread_id === email.thread_id && e.metadata?.linked_job_id
          )
          if (threadLinked) autoLinkedJobId = threadLinked.metadata.linked_job_id

          await supabase.from('inbox_emails').insert({
            company_id: companyId,
            from_address: email.from,
            from_name: email.from.split('<')[0].trim(),
            subject: email.subject,
            body: email.body,
            raw_text: `From: ${email.from}\nSubject: ${email.subject}\n\n${email.body}`,
            categories: [],
            priority: 'normal',
            summary: email.snippet || '',
            status: autoLinkedJobId ? 'actioned' : 'unread',
            metadata: {
              gmail_id: email.gmail_id,
              thread_id: email.thread_id,
              needs_full_analysis: true,
              needs_categorize: true,
              date: email.date,
              linked_job_id: autoLinkedJobId,
              attachments: email.attachments || []
            }
          })
          existingIds.add(email.gmail_id)
          totalImported++
        }

        setImportProgress({ done: totalImported, total: totalEstimated })
        pageToken = data.next_page_token
      } catch (err) {
        console.error('Bulk import error:', err)
        showToast('Import error — will retry')
        break
      }
    } while (pageToken)

    setImporting(false)
    showToast(`Imported ${totalImported} emails`)
    loadEmails()

    // Background categorize with Haiku
    if (totalImported > 0) {
      showToast('Categorizing imported emails...')
      categorizeImportedEmails()
    }
  }

  async function categorizeImportedEmails() {
    const { data: uncategorized } = await supabase.from('inbox_emails')
      .select('id, from_address, subject, body, metadata')
      .eq('company_id', companyId)
      .filter('metadata->needs_categorize', 'eq', true)
      .limit(50)

    if (!uncategorized || uncategorized.length === 0) return

    for (const email of uncategorized) {
      const quick = await categorizeEmail(`From: ${email.from_address}\nSubject: ${email.subject}\n\n${(email.body || '').slice(0, 500)}`)
      if (quick) {
        // Get current metadata and remove the flag
        const { data: current } = await supabase.from('inbox_emails').select('metadata').eq('id', email.id).single()
        const meta = { ...(current?.metadata || {}), needs_categorize: false, needs_full_analysis: true }
        await supabase.from('inbox_emails').update({
          categories: [quick.category].filter(Boolean),
          priority: quick.priority || 'normal',
          summary: quick.summary || '',
          suggested_action: quick.suggested_action || 'none',
          metadata: meta
        }).eq('id', email.id)
      }
    }

    // Check if more to categorize
    const { count } = await supabase.from('inbox_emails')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .filter('metadata->needs_categorize', 'eq', true)

    if (count > 0) {
      setTimeout(() => categorizeImportedEmails(), 1000) // Process next batch
    } else {
      showToast('All emails categorized')
      loadEmails()
    }
  }

  const [emailPage, setEmailPage] = useState(0)
  const [totalEmails, setTotalEmails] = useState(0)
  const PAGE_SIZE = 50

  const [searchResults, setSearchResults] = useState(null) // null = not searching

  // Debounced search
  useEffect(() => {
    if (!emailSearch.trim()) { setSearchResults(null); return }
    const timer = setTimeout(() => searchEmails(emailSearch.trim()), 300)
    return () => clearTimeout(timer)
  }, [emailSearch])

  async function searchEmails(query) {
    const like = `%${query}%`
    const { data } = await supabase.from('inbox_emails')
      .select('*')
      .eq('company_id', companyId)
      .or(`from_name.ilike.${like},from_address.ilike.${like},subject.ilike.${like},summary.ilike.${like}`)
      .order('created_at', { ascending: false })
      .limit(100)
    setSearchResults(data || [])
  }

  async function loadEmails(page = 0) {
    const from = page * PAGE_SIZE
    const to = from + PAGE_SIZE - 1

    const [{ data, count }, ] = await Promise.all([
      supabase.from('inbox_emails')
        .select('*', { count: 'exact' })
        .eq('company_id', companyId)
        .order('created_at', { ascending: false })
        .range(from, to),
    ])

    setEmails(data || [])
    setTotalEmails(count || 0)
    setEmailPage(page)
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

  async function loadTeamAndConfig() {
    const [membersRes, templatesRes, compRes] = await Promise.all([
      supabase.from('profiles').select('id, full_name, email, role').eq('company_id', companyId).eq('is_active', true),
      supabase.from('reply_templates').select('*').eq('company_id', companyId).order('name'),
      supabase.from('companies').select('settings').eq('id', companyId).single()
    ])
    setTeamMembers(membersRes.data || [])
    setReplyTemplates(templatesRes.data || [])
    setEmailConfig(compRes.data?.settings || {})
  }

  async function assignEmail(emailId, userId) {
    await supabase.from('inbox_emails').update({ assigned_to: userId }).eq('id', emailId)
    showToast(userId ? 'Email assigned' : 'Assignment removed')
    loadEmails()
  }

  async function addComment(emailId) {
    if (!newComment.trim()) return
    const email = emails.find(e => e.id === emailId) || showDetail
    const comments = [...(email?.comments || []), {
      user: profile?.full_name || 'User',
      text: newComment.trim(),
      time: new Date().toISOString()
    }]
    await supabase.from('inbox_emails').update({ comments }).eq('id', emailId)
    setNewComment('')
    // Update detail view
    if (showDetail?.id === emailId) {
      setShowDetail(prev => ({ ...prev, comments }))
    }
    showToast('Comment added')
  }

  function applyTemplate(template, email) {
    const linked = email?.metadata?.linked_job_id ? jobs.find(j => j.id === email.metadata.linked_job_id) : null
    let body = template.body
    body = body.replace(/\{client_name\}/g, email?.from_name || '')
    body = body.replace(/\{address\}/g, linked?.site_address || '')
    body = body.replace(/\{job_number\}/g, linked?.job_number || '')
    body = body.replace(/\{date\}/g, new Date().toLocaleDateString('en-CA'))
    body = body.replace(/\{worker_name\}/g, profile?.full_name || '')
    return body
  }

  function getSlaStatus(email) {
    if (!emailConfig.email_sla || !email.created_at) return null
    const hours = emailConfig.email_sla_hours || 4
    const created = new Date(email.metadata?.date || email.created_at).getTime()
    const deadline = created + hours * 3600000
    const now = Date.now()
    const remaining = (deadline - now) / 3600000
    if (email.status === 'actioned') return { status: 'resolved', label: 'Resolved' }
    if (remaining <= 0) return { status: 'breached', label: `Overdue by ${Math.abs(remaining).toFixed(1)}h`, color: 'var(--red)' }
    if (remaining <= 1) return { status: 'warning', label: `${remaining.toFixed(1)}h remaining`, color: 'var(--yellow)' }
    return { status: 'ok', label: `${remaining.toFixed(1)}h remaining`, color: 'var(--text3)' }
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

  async function downloadAttachment(email, attachment) {
    showToast('Downloading ' + attachment.filename + '...')
    try {
      const res = await fetch('/.netlify/functions/gmail-attachment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: companyId,
          gmail_id: email.metadata?.gmail_id,
          attachment_id: attachment.id,
          filename: attachment.filename
        })
      })
      if (!res.ok) { showToast('Download failed'); return }
      // Create download link from response
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = attachment.filename
      a.click()
      URL.revokeObjectURL(url)
      showToast('Downloaded ' + attachment.filename)
    } catch (err) {
      showToast('Download error')
    }
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

  function formatEmailDate(email) {
    // Use Gmail date if available, otherwise created_at
    const dateStr = email.metadata?.date || email.created_at
    if (!dateStr) return ''
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return ''
    const now = new Date()
    const today = now.toISOString().split('T')[0]
    const emailDate = d.toISOString().split('T')[0]
    const time = d.toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit' })

    if (emailDate === today) return time
    const yesterday = new Date(now - 86400000).toISOString().split('T')[0]
    if (emailDate === yesterday) return 'Yesterday ' + time
    // Same year
    if (d.getFullYear() === now.getFullYear()) {
      return d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }) + ' ' + time
    }
    return d.toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' })
  }

  const unread = emails.filter(e => e.status === 'unread')
  const suggestions = emails.filter(e => e.status !== 'actioned' && !e.metadata?.linked_job_id)
  const linked = emails.filter(e => e.metadata?.linked_job_id)

  // If searching, use search results instead of paginated list
  let displayEmails = searchResults ? searchResults :
    tab === 'suggestions' ? suggestions :
    tab === 'linked' ? linked :
    filter === 'all' ? emails :
    filter === 'unread' ? unread :
    emails.filter(e => (e.categories || []).includes(filter))

  // Search is handled by searchEmails — don't filter here

  // Apply sort
  const priOrder = { urgent: 0, high: 1, normal: 2, low: 3 }
  displayEmails = [...displayEmails].sort((a, b) => {
    if (emailSort === 'newest') return new Date(b.metadata?.date || b.created_at) - new Date(a.metadata?.date || a.created_at)
    if (emailSort === 'oldest') return new Date(a.metadata?.date || a.created_at) - new Date(b.metadata?.date || b.created_at)
    if (emailSort === 'name_az') return (a.from_name || a.from_address || '').localeCompare(b.from_name || b.from_address || '')
    if (emailSort === 'name_za') return (b.from_name || b.from_address || '').localeCompare(a.from_name || a.from_address || '')
    if (emailSort === 'unread') return (a.status === 'unread' ? 0 : 1) - (b.status === 'unread' ? 0 : 1)
    if (emailSort === 'priority') return (priOrder[a.priority] || 2) - (priOrder[b.priority] || 2)
    return 0
  })

  const avColors = { insurance: '#8B5CF6', urgent: '#FF3B5C', supplier: '#2196F3', pm: '#FF6B35', client: '#00D4A0', internal: '#7A8799' }

  if (loading) return <div className="loading-center"><div className="spinner" /></div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>Inbox</div>
          <div style={{ fontSize: 11, color: 'var(--text3)' }}>{totalEmails.toLocaleString()} emails</div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {!gmailConnected && <button onClick={connectGmail} style={{ padding: '6px 12px', borderRadius: 8, fontSize: 11, fontWeight: 600, border: '1px solid rgba(0,212,160,0.2)', background: 'transparent', color: 'var(--primary)', cursor: 'pointer', fontFamily: 'DM Sans' }}>📧 Connect Gmail</button>}
          {gmailConnected && <>
            <span style={{ fontSize: 10, color: 'var(--text3)', alignSelf: 'center' }}>📧 {gmailEmail}</span>
            <button onClick={() => fetchGmailEmails(false)} disabled={syncing} style={{ padding: '5px 10px', borderRadius: 6, fontSize: 10, fontWeight: 600, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text3)', cursor: 'pointer', fontFamily: 'DM Sans' }}>{syncing ? '⏳' : '🔄'}</button>
            <button onClick={() => { console.log('IMPORT CLICKED'); bulkImport() }} disabled={importing} style={{ padding: '5px 10px', borderRadius: 6, fontSize: 10, fontWeight: 600, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text3)', cursor: 'pointer', fontFamily: 'DM Sans' }}>{importing ? '⏳' : '📥'}</button>
          </>}
        </div>
      </div>

      {importing && <div style={{ padding: '6px 20px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--primary)', marginBottom: 4 }}>
          <span>Importing...</span><span>{importProgress.done}{importProgress.total ? ` / ~${importProgress.total}` : ''}</span>
        </div>
        <div style={{ height: 3, background: 'var(--bg2)', borderRadius: 2 }}><div style={{ height: '100%', borderRadius: 2, background: 'var(--primary)', width: importProgress.total ? `${Math.min((importProgress.done / importProgress.total) * 100, 100)}%` : '30%' }} /></div>
      </div>}

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        {[{ id: 'inbox', label: 'Inbox', count: emails.length }, { id: 'suggestions', label: 'Sort', count: suggestions.length }, { id: 'linked', label: 'Linked', count: linked.length }].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            flex: 1, padding: '10px', fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer', fontFamily: 'DM Sans',
            background: 'transparent', color: tab === t.id ? 'var(--text)' : 'var(--text3)',
            borderBottom: tab === t.id ? '2px solid var(--primary)' : '2px solid transparent'
          }}>{t.label} <span style={{ fontSize: 11, color: 'var(--text3)' }}>({t.count})</span></button>
        ))}
      </div>

      {/* Search + filters */}
      <div style={{ display: 'flex', gap: 6, padding: '8px 20px', borderBottom: '1px solid var(--border)', flexShrink: 0, alignItems: 'center', overflowX: 'auto', scrollbarWidth: 'none' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 120 }}>
          <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 12, color: 'var(--text3)' }}>🔍</span>
          <input value={emailSearch} onChange={e => setEmailSearch(e.target.value)} placeholder="Search..." style={{
            width: '100%', padding: '7px 10px 7px 30px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, color: 'var(--text)', outline: 'none', fontFamily: 'DM Sans'
          }} />
        </div>
        <select value={emailSort} onChange={e => setEmailSort(e.target.value)} style={{ padding: '6px 8px', borderRadius: 6, fontSize: 10, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text3)', outline: 'none', fontFamily: 'DM Sans', cursor: 'pointer' }}>
          <option value="newest">Newest</option><option value="oldest">Oldest</option><option value="name_az">A-Z</option><option value="name_za">Z-A</option><option value="unread">Unread</option><option value="priority">Priority</option>
        </select>
        {['all','unread','insurance','client','supplier','urgent'].map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{
            padding: '5px 8px', borderRadius: 6, fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap', cursor: 'pointer', fontFamily: 'DM Sans',
            border: filter === f ? '1px solid var(--primary)' : '1px solid var(--border)',
            background: filter === f ? 'var(--primary)' : 'transparent',
            color: filter === f ? '#000' : 'var(--text3)'
          }}>{f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}</button>
        ))}
      </div>

      {/* Paste email */}
      {showCompose && <div style={{ padding: '8px 20px', borderBottom: '1px solid var(--border)' }}>
        <textarea value={inputText} onChange={e => setInputText(e.target.value)} placeholder="Paste email text..." style={{ width: '100%', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, padding: 10, fontSize: 13, color: 'var(--text)', fontFamily: 'DM Sans', outline: 'none', resize: 'none', minHeight: 80, lineHeight: 1.5 }} />
        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          <button onClick={analyzeAndSave} disabled={analyzing} style={{ flex: 1, padding: 8, borderRadius: 8, background: analyzing ? 'var(--card2)' : 'var(--primary)', border: 'none', color: analyzing ? 'var(--text3)' : '#000', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'DM Sans' }}>{analyzing ? '⏳' : '🤖 Analyze'}</button>
          <button onClick={() => setShowCompose(false)} style={{ padding: '8px 12px', borderRadius: 8, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text3)', fontSize: 12, cursor: 'pointer', fontFamily: 'DM Sans' }}>Cancel</button>
        </div>
      </div>}
      {!showCompose && <button onClick={() => setShowCompose(true)} style={{ margin: '0 20px', padding: '8px', border: '1px dashed var(--border)', borderRadius: 8, background: 'transparent', color: 'var(--text3)', fontSize: 11, cursor: 'pointer', fontFamily: 'DM Sans', textAlign: 'center', marginBottom: 0, marginTop: 0 }}>📋 Paste email manually</button>}

      {/* Email list */}
      <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
        {displayEmails.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">{tab === 'suggestions' ? '✅' : tab === 'linked' ? '🔗' : '📬'}</div>
            <div className="empty-title">{tab === 'suggestions' ? 'All sorted!' : tab === 'linked' ? 'No linked emails' : 'No emails'}</div>
            <div className="empty-sub">{tab === 'suggestions' ? 'All emails linked to jobs' : gmailConnected ? 'Emails sync automatically' : 'Connect Gmail or paste an email'}</div>
          </div>
        ) : displayEmails.map(email => {
          const cat = (email.categories || [])[0] || 'client'
          const catStyle = CAT_COLORS[cat] || CAT_COLORS.client
          const isLinked = email.metadata?.linked_job_id
          const linkedJob = isLinked ? jobs.find(j => j.id === isLinked) : null
          const init = (email.from_name || email.from_address || '?').charAt(0).toUpperCase()

          return (
            <div key={email.id} className={`email-row ${email.status === 'unread' ? 'unread' : ''}`} onClick={() => openEmail(email)}>
              <div className="email-av" style={{ background: avColors[cat] || '#00D4A0' }}>{init}</div>
              <div className="email-body-wrap">
                <div className="email-from">{sortMode === 'address' ? (email.metadata?.extracted_data?.address || email.subject) : (email.from_name || email.from_address || 'Unknown')}</div>
                <div className="email-subj">{email.subject}</div>
                <div className="email-snippet">{email.summary || (email.body || '').slice(0, 80)}</div>
                <div className="email-tags">
                  <span className="etag" style={{ background: catStyle.bg, color: catStyle.color }}>{cat.toUpperCase()}</span>
                  {email.priority === 'urgent' && <span className="etag" style={{ background: 'rgba(255,59,92,0.12)', color: '#FF3B5C' }}>URGENT</span>}
                  {isLinked && linkedJob && <span className="etag" style={{ background: 'rgba(33,150,243,0.12)', color: 'var(--blue)' }}>🔗 {linkedJob.job_number}</span>}
                  {!isLinked && email.suggested_action === 'create_job' && <span className="etag" style={{ background: 'rgba(0,212,160,0.1)', color: 'var(--primary)' }}>→ JOB</span>}
                  {email.metadata?.attachments?.length > 0 && <span className="etag" style={{ background: 'rgba(255,184,0,0.1)', color: 'var(--yellow)' }}>📎{email.metadata.attachments.length}</span>}
                </div>
              </div>
              <div className="email-right"><div className="email-time">{formatEmailDate(email)}</div></div>
            </div>
          )
        })}

        {totalEmails > PAGE_SIZE && !searchResults && (
          <div className="inbox-pagination">
            <button onClick={() => loadEmails(emailPage - 1)} disabled={emailPage === 0}>← Prev</button>
            <span>{emailPage * PAGE_SIZE + 1}–{Math.min((emailPage + 1) * PAGE_SIZE, totalEmails)} of {totalEmails.toLocaleString()}</span>
            <button onClick={() => loadEmails(emailPage + 1)} disabled={(emailPage + 1) * PAGE_SIZE >= totalEmails}>Next →</button>
          </div>
        )}
      </div>

      {/* EMAIL DETAIL */}
      {showDetail && (
        <Modal title={null} onClose={() => setShowDetail(null)}>
          {/* Subject + From */}
          <div style={{ paddingBottom: 14, borderBottom: '1px solid var(--border)', marginBottom: 14 }}>
            <div style={{ fontSize: 18, fontWeight: 800, lineHeight: 1.3, marginBottom: 8 }}>{showDetail.subject}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{showDetail.from_name || showDetail.from_address}</span>
              <span style={{ fontSize: 11, color: 'var(--text3)' }}>{formatEmailDate(showDetail)}</span>
              {(showDetail.categories || []).map(c => {
                const s = CAT_COLORS[c] || CAT_COLORS.client
                return <span key={c} className="etag" style={{ background: s.bg, color: s.color }}>{c.toUpperCase()}</span>
              })}
            </div>
          </div>

          {/* Toolbar */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', paddingBottom: 12, marginBottom: 12, borderBottom: '1px solid var(--border)' }}>
            {emailConfig.email_assignment && (
              <select value={showDetail.assigned_to || ''} onChange={e => assignEmail(showDetail.id, e.target.value || null)} style={{ padding: '5px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text2)', outline: 'none', fontFamily: 'DM Sans', cursor: 'pointer' }}>
                <option value="">👤 Assign</option>
                {teamMembers.map(m => <option key={m.id} value={m.id}>{m.full_name}</option>)}
              </select>
            )}
            {!showDetail.metadata?.linked_job_id && (
              <select onChange={e => { if (e.target.value) linkEmailToJob(showDetail.id, e.target.value) }} style={{ padding: '5px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text2)', outline: 'none', fontFamily: 'DM Sans', cursor: 'pointer' }}>
                <option value="">🔗 Link to job</option>
                {jobs.map(j => <option key={j.id} value={j.id}>{j.job_number} — {j.name}</option>)}
              </select>
            )}
            {!showDetail.metadata?.linked_job_id && <button onClick={() => startCreateJobFromEmail(showDetail)} style={{ padding: '5px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text2)', cursor: 'pointer', fontFamily: 'DM Sans' }}>+ New Job</button>}
          </div>

          {/* Linked job */}
          {showDetail.metadata?.linked_job_id && (() => {
            const lj = jobs.find(j => j.id === showDetail.metadata.linked_job_id)
            return lj ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'rgba(33,150,243,0.04)', border: '1px solid rgba(33,150,243,0.12)', borderRadius: 10, marginBottom: 14 }}>
                <span>🔗</span>
                <div style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{lj.job_number} — {lj.name}</div>
                <button onClick={() => unlinkEmail(showDetail.id)} style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', fontSize: 11, fontWeight: 700, fontFamily: 'DM Sans' }}>Unlink</button>
              </div>
            ) : null
          })()}

          {/* THE EMAIL — shown first, this is the main content */}
          <div className="email-full-body">{showDetail.body || showDetail.raw_text || 'No content'}</div>

          {/* Attachments */}
          {showDetail.metadata?.attachments?.length > 0 && (
            <div className="attach-chips">
              {showDetail.metadata.attachments.map((att, i) => (
                <div key={i} className="attach-chip" onClick={() => downloadAttachment(showDetail, att)}>
                  <span>{att.mimeType?.includes('image') ? '🖼️' : att.mimeType?.includes('pdf') ? '📄' : '📎'}</span>
                  <span>{att.filename}</span>
                </div>
              ))}
            </div>
          )}

          {/* AI — ON DEMAND */}
          {!showDetail._aiLoaded && (
            <button onClick={async () => {
              setShowDetail(prev => ({ ...prev, _analyzing: true }))
              const body = (showDetail.body || showDetail.raw_text || '').slice(0, 2000)
              const fullText = `From: ${showDetail.from_name || showDetail.from_address}\nSubject: ${showDetail.subject}\n\n${body}`
              const result = await analyzeEmailFull(fullText)
              if (result) {
                await supabase.from('inbox_emails').update({ summary: result.summary || '', draft_reply: result.draft_reply || '', metadata: { ...showDetail.metadata, needs_full_analysis: false, extracted_data: result.extracted_data || {} } }).eq('id', showDetail.id)
                setShowDetail(prev => prev?.id === showDetail.id ? { ...prev, summary: result.summary, draft_reply: result.draft_reply, _aiLoaded: true, _analyzing: false } : prev)
              } else {
                setShowDetail(prev => ({ ...prev, _analyzing: false }))
              }
            }} disabled={showDetail._analyzing} className="ai-analyze-btn">
              {showDetail._analyzing ? <><div className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> Analyzing...</> : '🤖 AI Summary & Draft Reply'}
            </button>
          )}

          {showDetail._aiLoaded && showDetail.summary && (
            <div className="ai-result-box" style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--primary)', letterSpacing: 0.5, marginBottom: 6 }}>🤖 AI SUMMARY</div>
              <div style={{ fontSize: 14, color: 'var(--text)', lineHeight: 1.7 }}>{showDetail.summary}</div>
            </div>
          )}

          {/* Comments */}
          {emailConfig.email_comments && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text3)', letterSpacing: 1, marginBottom: 6 }}>COMMENTS ({(showDetail.comments || []).length})</div>
              <div className="comments-box">
                {(showDetail.comments || []).length === 0 ? (
                  <div style={{ padding: 12, textAlign: 'center', fontSize: 11, color: 'var(--text3)' }}>Team-only comments</div>
                ) : (showDetail.comments || []).map((c, i) => (
                  <div key={i} className="comment-row">
                    <span className="comment-name">{c.user}</span>
                    <span className="comment-date">{new Date(c.time).toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit' })}</span>
                    <div className="comment-body">{c.text}</div>
                  </div>
                ))}
                <div className="comment-add">
                  <input className="comment-input" value={newComment} onChange={e => setNewComment(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addComment(showDetail.id) }} placeholder="Add comment..." />
                  <button className="comment-send" onClick={() => addComment(showDetail.id)}>💬</button>
                </div>
              </div>
            </div>
          )}

          {/* Reply */}
          <div className="reply-box">
            <div className="reply-header">
              <span className="reply-label">Reply</span>
              <div style={{ display: 'flex', gap: 6 }}>
                {emailConfig.email_templates && replyTemplates.length > 0 && (
                  <select onChange={e => { if (!e.target.value) return; const tpl = replyTemplates.find(t => t.id === e.target.value); if (tpl) { const el = document.getElementById('reply-area'); if (el) el.value = applyTemplate(tpl, showDetail) } e.target.value = '' }} style={{ padding: '4px 8px', borderRadius: 6, fontSize: 10, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text3)', outline: 'none', fontFamily: 'DM Sans', cursor: 'pointer' }}>
                    <option value="">📝 Templates</option>
                    {replyTemplates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                )}
                <button onClick={() => { const el = document.getElementById('reply-area'); navigator.clipboard.writeText(el?.value || showDetail.draft_reply || '').then(() => showToast('Copied')) }} style={{ padding: '4px 8px', borderRadius: 6, fontSize: 10, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text3)', cursor: 'pointer', fontFamily: 'DM Sans' }}>📋 Copy</button>
              </div>
            </div>
            <textarea id="reply-area" className="reply-area" defaultValue={showDetail.draft_reply || ''} placeholder="Write a reply..." />
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button className="btn btn-danger btn-full" style={{ padding: 12 }} onClick={() => deleteEmail(showDetail.id)}>Delete</button>
            <button className="btn btn-secondary btn-full" style={{ padding: 12 }} onClick={() => setShowDetail(null)}>Close</button>
          </div>
        </Modal>
      )}

      {/* Create Job Modal */}
      {showCreateJobModal && createJobEmail && (
        <Modal title="Create Job from Email" onClose={() => setShowCreateJobModal(false)}>
          <div style={{ background: 'var(--bg2)', borderRadius: 12, padding: 14, marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 2 }}>From: {createJobEmail.from_name || createJobEmail.from_address}</div>
            <div style={{ fontSize: 13, fontWeight: 700 }}>{createJobEmail.subject}</div>
          </div>
          <div className="form-field"><label className="form-label">Client *</label>
            <select className="form-input" value={createJobClientId} onChange={e => { setCreateJobClientId(e.target.value); if (e.target.value) setCreateJobNewClient('') }}>
              <option value="">-- Select or create new --</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          {!createJobClientId && <div className="form-field"><label className="form-label">New Client Name</label><input className="form-input" placeholder="Client name" value={createJobNewClient} onChange={e => setCreateJobNewClient(e.target.value)} /></div>}
          <div className="form-field"><label className="form-label">Job Name *</label><input className="form-input" value={createJobForm.name} onChange={e => setCreateJobForm(f => ({ ...f, name: e.target.value }))} /></div>
          <div className="form-row">
            <div className="form-field"><label className="form-label">Stage</label><select className="form-input" value={createJobForm.stage || 'lead'} onChange={e => setCreateJobForm(f => ({ ...f, stage: e.target.value }))}><option value="lead">Lead</option><option value="quoted">Quoted</option><option value="active">Active</option><option value="completed">Completed</option><option value="invoiced">Invoiced</option><option value="closed">Closed</option></select></div>
            <div className="form-field"><label className="form-label">Priority</label><select className="form-input" value={createJobForm.priority} onChange={e => setCreateJobForm(f => ({ ...f, priority: e.target.value }))}><option value="emergency">Emergency</option><option value="urgent">Urgent</option><option value="normal">Normal</option><option value="low">Low</option></select></div>
          </div>
          <div className="form-row">
            <div className="form-field"><label className="form-label">Job Type</label><select className="form-input" value={createJobForm.job_type || ''} onChange={e => setCreateJobForm(f => ({ ...f, job_type: e.target.value }))}><option value="">Select...</option><option value="water_damage">Water Damage</option><option value="fire_damage">Fire Damage</option><option value="mold_remediation">Mold</option><option value="hvac">HVAC</option><option value="plumbing">Plumbing</option><option value="electrical">Electrical</option><option value="cleaning">Cleaning</option><option value="maintenance">Maintenance</option><option value="renovation">Renovation</option><option value="general">General</option></select></div>
            <div className="form-field"><label className="form-label">Value ($)</label><input className="form-input" type="number" placeholder="0" value={createJobForm.estimated_value || ''} onChange={e => setCreateJobForm(f => ({ ...f, estimated_value: e.target.value }))} /></div>
          </div>
          <div className="form-field"><label className="form-label">Address</label><input className="form-input" value={createJobForm.site_address} onChange={e => setCreateJobForm(f => ({ ...f, site_address: e.target.value }))} /></div>
          <div className="form-row">
            <div className="form-field"><label className="form-label">City</label><input className="form-input" value={createJobForm.site_city || ''} onChange={e => setCreateJobForm(f => ({ ...f, site_city: e.target.value }))} /></div>
            <div className="form-field"><label className="form-label">Province</label><input className="form-input" value={createJobForm.site_province_state || ''} onChange={e => setCreateJobForm(f => ({ ...f, site_province_state: e.target.value }))} /></div>
          </div>
          <div className="form-field"><label className="form-label">Units</label><input className="form-input" placeholder="820, 416, 1003" value={createJobForm.unit_numbers || ''} onChange={e => setCreateJobForm(f => ({ ...f, unit_numbers: e.target.value }))} /></div>
          <div className="form-row">
            <div className="form-field"><label className="form-label">Start</label><input className="form-input" type="datetime-local" value={createJobForm.scheduled_start || ''} onChange={e => setCreateJobForm(f => ({ ...f, scheduled_start: e.target.value }))} /></div>
            <div className="form-field"><label className="form-label">End</label><input className="form-input" type="datetime-local" value={createJobForm.scheduled_end || ''} onChange={e => setCreateJobForm(f => ({ ...f, scheduled_end: e.target.value }))} /></div>
          </div>
          <div className="form-row">
            <div className="form-field"><label className="form-label">Insurance Co.</label><input className="form-input" value={createJobForm.insurance_company || ''} onChange={e => setCreateJobForm(f => ({ ...f, insurance_company: e.target.value }))} /></div>
            <div className="form-field"><label className="form-label">Claim #</label><input className="form-input" value={createJobForm.insurance_claim_number} onChange={e => setCreateJobForm(f => ({ ...f, insurance_claim_number: e.target.value }))} /></div>
          </div>
          <div className="form-field"><label className="form-label">Description</label><textarea className="form-input" style={{ minHeight: 120 }} value={createJobForm.description} onChange={e => setCreateJobForm(f => ({ ...f, description: e.target.value }))} /></div>
          <div className="form-field"><label className="form-label">Notes</label><textarea className="form-input" value={createJobForm.notes || ''} onChange={e => setCreateJobForm(f => ({ ...f, notes: e.target.value }))} /></div>
          <button className="btn btn-primary btn-full" style={{ marginTop: 8, padding: 14 }} onClick={confirmCreateJobFromEmail}>Create Job & Link Email</button>
          <button className="btn btn-secondary btn-full" style={{ marginTop: 8 }} onClick={() => setShowCreateJobModal(false)}>Cancel</button>
        </Modal>
      )}
    </div>
  )
}

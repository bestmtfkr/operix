import { useEffect, useState, useRef } from 'react'
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
  // `tab` removed — replaced by selectedView below (VIEWS section in sidebar)
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
  // Real composer (to actually send via Gmail)
  const [composer, setComposer] = useState(null) // null | { to, cc, bcc, subject, body, attachments, replyToId, threadId, inReplyTo, references, showCcBcc }
  const [sending, setSending] = useState(false)
  // Desktop = 3-column layout (sidebar | list | preview). Mobile = modal for detail.
  const [isDesktop, setIsDesktop] = useState(typeof window !== 'undefined' && window.innerWidth >= 900)
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)
  const [headerExpanded, setHeaderExpanded] = useState(false)

  // ─── Multi-account state — driven by the real mailboxes table ────────
  const [mailboxes, setMailboxes] = useState([]) // real rows from DB
  const [selectedAccountId, setSelectedAccountId] = useState('unified')

  async function loadMailboxes() {
    if (!companyId) return
    const { data } = await supabase
      .from('mailboxes')
      .select('id, email_address, display_name, color, status, is_primary, provider')
      .eq('company_id', companyId)
      .is('archived_at', null)
      .eq('status', 'active')
      .order('is_primary', { ascending: false })
      .order('connected_at', { ascending: true })
    setMailboxes(data || [])
  }

  useEffect(() => { loadMailboxes() }, [companyId])

  // Build the list the sidebar renders: synthetic Unified row + real mailboxes
  const connectedAccounts = [
    { id: 'unified', type: 'unified', label: 'Unified Inbox', color: null, icon: '📬' },
    ...mailboxes.map(m => ({
      id: m.id,
      type: m.provider || 'gmail',
      email: m.email_address,
      color: m.color || '#00D4A0',
      display_name: m.display_name,
      is_primary: m.is_primary
    }))
  ]
  const selectedAccount = connectedAccounts.find(a => a.id === selectedAccountId) || connectedAccounts[0]
  const isUnifiedView = selectedAccountId === 'unified'

  // Views: orthogonal to mailbox selection (assigned/archived override mailbox filter)
  const [selectedView, setSelectedView] = useState('inbox') // 'inbox' | 'assigned' | 'archived'

  // Folders — sent/drafts/spam/trash. null = default inbox (no folder filter).
  // The `folder` column on inbox_emails doesn't exist until migration 3.2.2 runs,
  // so buildQuery guards filter application behind this feature flag.
  const [selectedFolder, setSelectedFolder] = useState(null) // null | 'sent' | 'drafts' | 'spam' | 'trash'
  const FOLDERS_ENABLED = true // Flip to false if the column isn't in the DB yet

  // Bulk selection for the new toolbar
  const [selectedEmails, setSelectedEmails] = useState(new Set())
  function toggleSelectEmail(id) {
    setSelectedEmails(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  function clearSelection() { setSelectedEmails(new Set()) }

  // In unified view, look up which mailbox a given email belongs to so we can color-dot the avatar
  const mailboxById = new Map(mailboxes.map(m => [m.id, m]))
  function accountForEmail(email) {
    if (!email?.mailbox_id) return null
    const m = mailboxById.get(email.mailbox_id)
    if (!m) return null
    return { id: m.id, email: m.email_address, color: m.color || '#00D4A0' }
  }

  useEffect(() => {
    function onResize() { setIsDesktop(window.innerWidth >= 900) }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    // loadEmails runs via the tab/filter effect below
    if (companyId) { loadJobs(); loadClients(); checkGmail(); loadTeamAndConfig() }
  }, [companyId])

  // Auto-sync all active mailboxes.
  // Hot folders (inbox + sent) every 2 min.
  // Spam every 30 min.
  // Trash is on-demand only (user-initiated).
  // Rate-limited to 3 concurrent Gmail fetches to avoid 429s.
  useEffect(() => {
    if (!companyId || mailboxes.length === 0) return

    async function runWorkers(queue, concurrency = 3) {
      const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
        while (queue.length) {
          const job = queue.shift()
          if (job) await fetchMailboxEmails(job.mailboxId, true, job.folder)
        }
      })
      await Promise.all(workers)
    }

    const syncHot = async () => {
      const queue = []
      for (const mb of mailboxes) {
        queue.push({ mailboxId: mb.id, folder: 'inbox' })
        queue.push({ mailboxId: mb.id, folder: 'sent' })
      }
      await runWorkers(queue, 3)
    }

    const syncSpam = async () => {
      const queue = mailboxes.map(mb => ({ mailboxId: mb.id, folder: 'spam' }))
      await runWorkers(queue, 2)
    }

    const firstHot = setTimeout(syncHot, 8000)
    const hotInterval = setInterval(syncHot, 2 * 60 * 1000)
    const spamInterval = setInterval(syncSpam, 30 * 60 * 1000)

    return () => {
      clearTimeout(firstHot)
      clearInterval(hotInterval)
      clearInterval(spamInterval)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, mailboxes.length])

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
    // Frontend only gets the email address (+ mailbox_id for new-account flow)
    setGmailConnected(true)
    setGmailEmail(data.email || '')
    showToast('Connected: ' + (data.email || ''))
    // Refresh mailboxes list and auto-select the new one if we got its id
    await loadMailboxes()
    if (data.mailbox_id) {
      setSelectedAccountId(data.mailbox_id)
    }
    fetchGmailEmails()
  }

  function connectGmail(intent = 'add') {
    const w = window.open(
      `/api/gmail/connect?company_id=${companyId}&intent=${encodeURIComponent(intent)}`,
      '_blank',
      'width=500,height=600,left=200,top=100'
    )
    if (!w) showToast('Popup blocked — allow popups for this site')
  }

  // Fetch newest emails for a SPECIFIC mailbox + folder and insert into inbox_emails.
  // Returns the number of new emails saved.
  async function fetchMailboxEmails(mailboxId, silent = false, folder = 'inbox') {
    try {
      // Find the newest email we already have for this (mailbox, folder) combo
      const { data: newest } = await supabase
        .from('inbox_emails')
        .select('metadata')
        .eq('mailbox_id', mailboxId)
        .eq('folder', folder)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      const afterDate = newest?.metadata?.date
        ? new Date(newest.metadata.date).toISOString().split('T')[0].replace(/-/g, '/')
        : null

      const res = await fetch('/.netlify/functions/gmail-fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mailbox_id: mailboxId, max_results: 100, after_date: afterDate, folder })
      })
      const data = await res.json()
      if (data.error) {
        if (!silent) showToast('Gmail: ' + data.error)
        return 0
      }

      // Skip duplicates already in this (mailbox, folder)
      const { data: existing } = await supabase
        .from('inbox_emails')
        .select('metadata')
        .eq('mailbox_id', mailboxId)
        .eq('folder', folder)
        .order('created_at', { ascending: false })
        .limit(500)
      const existingIds = new Set((existing || []).map(e => e.metadata?.gmail_id).filter(Boolean))
      // Skip dupes AND truly-empty emails at sync time (Option C)
      const newEmails = (data.emails || []).filter(e => {
        if (existingIds.has(e.gmail_id)) return false
        const from = (e.from || '').trim().replace(/^<|>$/g, '')
        const subj = (e.subject || '').trim()
        const bodyLen = (e.body || '').trim().length + (e.html_body || '').trim().length
        if (!from && !subj && bodyLen < 30) {
          console.log('Skipping empty email at sync:', e.gmail_id)
          return false
        }
        return true
      })
      if (newEmails.length === 0) return 0

      let saved = 0
      for (const email of newEmails) {
        const quick = await categorizeEmail(`From: ${email.from}\nSubject: ${email.subject}\n\n${email.body.slice(0, 500)}`)

        // Auto-link if same thread as an already-linked email IN THE SAME MAILBOX
        let autoLinkedJobId = null
        if (email.thread_id) {
          const { data: threadMatch } = await supabase
            .from('inbox_emails')
            .select('metadata')
            .eq('mailbox_id', mailboxId)
            .filter('metadata->>thread_id', 'eq', email.thread_id)
            .not('metadata->>linked_job_id', 'is', null)
            .limit(1)
            .maybeSingle()
          if (threadMatch?.metadata?.linked_job_id) autoLinkedJobId = threadMatch.metadata.linked_job_id
        }

        const { data: savedEmail, error } = await supabase.from('inbox_emails').insert({
          company_id: companyId,
          mailbox_id: mailboxId,
          folder: folder,
          from_address: email.from,
          from_name: quick?.from_name || email.from.split('<')[0].trim(),
          subject: email.subject,
          body: email.body,
          html_body: email.html_body || null,
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
            message_id: email.message_id || null,
            to: email.to || '',
            cc: email.cc || '',
            needs_full_analysis: true,
            date: email.date,
            linked_job_id: autoLinkedJobId,
            attachments: email.attachments || []
          }
        }).select().single()

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

      return saved
    } catch (err) {
      console.error('fetchMailboxEmails error', err)
      return 0
    }
  }

  // Sync one or all mailboxes. If isUnifiedView, loops over every mailbox.
  // Otherwise syncs only the currently-selected mailbox.
  async function fetchGmailEmails(silent = false) {
    if (syncing) return
    if (mailboxes.length === 0) return
    setSyncing(true)
    try {
      const targets = isUnifiedView
        ? mailboxes
        : mailboxes.filter(m => m.id === selectedAccountId)

      let totalSaved = 0
      // Rate-limit to 3 concurrent fetches
      const queue = [...targets]
      const concurrency = 3
      const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
        while (queue.length) {
          const mb = queue.shift()
          if (mb) totalSaved += await fetchMailboxEmails(mb.id, silent)
        }
      })
      await Promise.all(workers)

      if (!silent || totalSaved > 0) {
        showToast(totalSaved === 0 ? 'No new emails' : `${totalSaved} new email${totalSaved !== 1 ? 's' : ''} synced`)
      }
      if (totalSaved > 0) loadEmails()
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

    // If a specific mailbox is selected, import only that one; otherwise use primary
    const importMailboxId = !isUnifiedView
      ? selectedAccountId
      : (mailboxes.find(m => m.is_primary) || mailboxes[0])?.id

    do {
      try {
        const res = await fetch('/.netlify/functions/gmail-bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mailbox_id: importMailboxId,
            company_id: companyId,
            page_token: pageToken,
            months_back: 6
          })
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
            mailbox_id: importMailboxId || null,
            from_address: email.from,
            from_name: email.from.split('<')[0].trim(),
            subject: email.subject,
            body: email.body,
            html_body: email.html_body || null,
            raw_text: `From: ${email.from}\nSubject: ${email.subject}\n\n${email.body}`,
            categories: [],
            priority: 'normal',
            summary: email.snippet || '',
            status: autoLinkedJobId ? 'actioned' : 'unread',
            metadata: {
              gmail_id: email.gmail_id,
              thread_id: email.thread_id,
              message_id: email.message_id || null,
              to: email.to || '',
              cc: email.cc || '',
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
  const [hasMore, setHasMore] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
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

  // Only columns needed for the list view — body/html_body/raw_text/draft_reply are
  // lazy-loaded in openEmail.
  const LIST_COLUMNS = 'id, company_id, mailbox_id, folder, from_address, from_name, subject, summary, categories, priority, status, suggested_action, assigned_to, comments, created_at, actioned_at, archived_at, metadata'

  // Build the base query with current view + filter + selected mailbox applied
  // server-side so we don't blow memory on 30k+ rows.
  function buildQuery() {
    let q = supabase
      .from('inbox_emails')
      .select(LIST_COLUMNS)
      .eq('company_id', companyId)

    // Views take precedence over mailbox filter for the archived/assigned cases
    if (selectedView === 'archived') {
      q = q.not('archived_at', 'is', null)
    } else if (selectedView === 'assigned') {
      if (profile?.id) q = q.eq('assigned_to', profile.id)
      q = q.is('archived_at', null)
    } else {
      // Default inbox view hides archived
      q = q.is('archived_at', null)
    }

    // Folder filter (sent/drafts/spam/trash). Only apply if the column exists.
    if (FOLDERS_ENABLED && selectedFolder) {
      q = q.eq('folder', selectedFolder)
    } else if (FOLDERS_ENABLED && selectedView === 'inbox') {
      // Default inbox view only shows folder='inbox' (hides sent/spam/trash leak-in)
      q = q.eq('folder', 'inbox')
    }

    // Mailbox filter — unified = no filter, otherwise scope to that mailbox
    if (selectedAccountId && selectedAccountId !== 'unified') {
      q = q.eq('mailbox_id', selectedAccountId)
    }

    // Category/status filters (all/unread/insurance/client/supplier/urgent)
    if (filter === 'unread') {
      q = q.eq('status', 'unread')
    } else if (filter === 'urgent') {
      q = q.eq('priority', 'urgent')
    } else if (['insurance', 'client', 'supplier'].includes(filter)) {
      q = q.contains('categories', [filter])
    }

    return q
  }

  async function loadEmails(page = 0, { append = false } = {}) {
    if (append) setLoadingMore(true)
    const from = page * PAGE_SIZE
    const to = from + PAGE_SIZE - 1

    try {
      const listRes = await buildQuery()
        .order('created_at', { ascending: false })
        .range(from, to)

      if (listRes.error) {
        console.error('loadEmails error', listRes.error)
        showToast('Load failed, retrying...')
        setTimeout(() => loadEmails(page, { append }), 2000)
        return
      }

      const rows = listRes.data || []
      if (append) {
        setEmails(prev => [...prev, ...rows])
      } else {
        setEmails(rows)
      }
      setHasMore(rows.length === PAGE_SIZE)
      setEmailPage(page)

      // Count query only on first page (it's slow on large tables even with estimate)
      if (page === 0 && !append) {
        const countRes = await supabase
          .from('inbox_emails')
          .select('id', { count: 'estimated', head: true })
          .eq('company_id', companyId)
        setTotalEmails(countRes.count || rows.length)
      }
    } catch (err) {
      console.error('loadEmails exception', err)
      showToast('Load failed')
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }

  // Reset to page 0 whenever view, filter, mailbox, folder, or company changes
  useEffect(() => {
    if (!companyId) return
    setEmails([])
    setEmailPage(0)
    setHasMore(true)
    clearSelection()
    loadEmails(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedView, filter, selectedAccountId, selectedFolder, companyId])

  // Infinite scroll: sentinel at end of list
  const sentinelRef = useRef(null)
  useEffect(() => {
    if (!sentinelRef.current || !hasMore || loadingMore || searchResults) return
    const observer = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasMore && !loadingMore) {
        loadEmails(emailPage + 1, { append: true })
      }
    }, { rootMargin: '400px' })
    observer.observe(sentinelRef.current)
    return () => observer.disconnect()
  }, [emailPage, hasMore, loadingMore, searchResults, selectedView, filter])

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
    // Allow switching between emails — only block if it's the same one already open
    if (showDetail?.id === email.id) return
    setOpening(true)
    setHeaderExpanded(false)

    // Open detail immediately with list-row data — body fetches in background
    setShowDetail({ ...email, _openedFrom: selectedView, _analyzing: email.metadata?.needs_full_analysis, _bodyLoading: true })

    // Lazy-fetch the heavy fields (body, html_body, raw_text, draft_reply) only now
    supabase.from('inbox_emails')
      .select('body, html_body, raw_text, draft_reply')
      .eq('id', email.id)
      .single()
      .then(({ data }) => {
        if (data) {
          Object.assign(email, data)
          setShowDetail(prev => prev?.id === email.id ? { ...prev, ...data, _bodyLoading: false } : prev)
        } else {
          setShowDetail(prev => prev?.id === email.id ? { ...prev, _bodyLoading: false } : prev)
        }
      })

    // Mark as read in background
    if (email.status === 'unread') {
      supabase.from('inbox_emails').update({ status: 'read' }).eq('id', email.id)
      email.status = 'read'
    }

    // Run FULL analysis with Sonnet if not done yet (on-demand, only when user opens)
    if (email.metadata?.needs_full_analysis) {
      // Wait a tick for body to load — if still not there use snippet/summary
      await new Promise(r => setTimeout(r, 500))
      const body = (email.body || email.raw_text || email.summary || '').slice(0, 2000)
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
            _openedFrom: selectedView,
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
          mailbox_id: email.mailbox_id || null,
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

  // Move email to a different folder. Calls gmail-move-folder which
  // updates both the local row AND the Gmail labels bidirectionally.
  async function moveEmailToFolder(id, targetFolder) {
    const email = emails.find(e => e.id === id) || showDetail
    try {
      const res = await fetch('/.netlify/functions/gmail-move-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: companyId,
          mailbox_id: email?.mailbox_id || null,
          email_id: id,
          gmail_id: email?.metadata?.gmail_id || null,
          target_folder: targetFolder
        })
      })
      const data = await res.json()
      if (data.error) {
        showToast('Failed: ' + data.error)
        return false
      }
      // Optimistically remove from current list
      setEmails(prev => prev.filter(e => e.id !== id))
      if (showDetail?.id === id) setShowDetail(null)
      return true
    } catch (err) {
      showToast('Move failed: ' + err.message)
      return false
    }
  }

  async function bulkMoveSelected(targetFolder) {
    if (selectedEmails.size === 0) return
    const ids = Array.from(selectedEmails)
    const label = targetFolder === 'trash' ? 'Trashed' : targetFolder === 'spam' ? 'Marked as spam' : 'Moved'
    showToast(`${label} ${ids.length}...`)
    for (const id of ids) {
      await moveEmailToFolder(id, targetFolder)
    }
    clearSelection()
  }

  // Archive — dedicated state separate from "actioned" (linked to job)
  async function archiveEmail(id) {
    await supabase.from('inbox_emails')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', id)
    showToast('Archived')
    setEmails(prev => prev.filter(e => e.id !== id))
    if (showDetail?.id === id) setShowDetail(null)
  }

  async function bulkArchiveSelected() {
    if (selectedEmails.size === 0) return
    const ids = Array.from(selectedEmails)
    await supabase.from('inbox_emails')
      .update({ archived_at: new Date().toISOString() })
      .in('id', ids)
    showToast(`Archived ${ids.length}`)
    setEmails(prev => prev.filter(e => !selectedEmails.has(e.id)))
    clearSelection()
  }

  // Detect truly-empty emails (no sender AND no subject AND no body content)
  // These are usually tracking pixels, auto-bounces, or broken API responses
  function isEmptyEmail(email) {
    const from = (email.from_address || '').trim().replace(/^<|>$/g, '')
    const subj = (email.subject || '').trim()
    const bodyLen = (email.body || '').trim().length + (email.html_body || '').trim().length
    const summary = (email.summary || '').trim().toLowerCase()
    const hallucinatedSummary = summary.includes('empty email') ||
                                summary.includes('no subject') ||
                                summary.includes('no sender') ||
                                summary.includes('no content')
    if (!from && !subj && bodyLen < 30) return true
    if (!from && !subj && hallucinatedSummary) return true
    return false
  }

  // Parse "Name <email@x.com>" → "email@x.com"
  function extractEmail(addr) {
    if (!addr) return ''
    const m = addr.match(/<([^>]+)>/)
    return (m ? m[1] : addr).trim()
  }

  // Pick the mailbox that should be the default "From" for a new compose.
  // Priority: currently-selected single mailbox → primary → first available.
  function defaultComposeMailboxId() {
    if (!isUnifiedView && selectedAccountId) return selectedAccountId
    const primary = mailboxes.find(m => m.is_primary)
    return primary?.id || mailboxes[0]?.id || null
  }

  function openCompose() {
    if (mailboxes.length === 0) { showToast('Connect a Gmail account first'); return }
    setComposer({
      mailboxId: defaultComposeMailboxId(),
      to: '', cc: '', bcc: '', subject: '', body: '',
      attachments: [], replyToId: null, threadId: null,
      inReplyTo: null, references: null, showCcBcc: false
    })
  }

  function openReplyComposer(email, prefillBody = '') {
    if (mailboxes.length === 0) { showToast('Connect a Gmail account first'); return }
    const fromAddr = extractEmail(email.from_address)
    const subj = email.subject || ''
    const replySubject = /^re:/i.test(subj) ? subj : `Re: ${subj}`
    const msgId = email.metadata?.message_id
    const prevRefs = email.metadata?.references || ''
    const refs = msgId ? `${prevRefs ? prevRefs + ' ' : ''}${msgId}`.trim() : prevRefs

    // Build quoted body (Gmail convention)
    const dateStr = email.metadata?.date ? new Date(email.metadata.date).toLocaleString('en-CA') : ''
    const quotedLines = (email.body || '').split('\n').map(l => `> ${l}`).join('\n')
    const quoteHeader = dateStr
      ? `\n\nOn ${dateStr}, ${email.from_name || fromAddr} <${fromAddr}> wrote:\n`
      : `\n\n${email.from_name || fromAddr} <${fromAddr}> wrote:\n`

    setComposer({
      // Reply from the account that received the email — falls back to default
      mailboxId: email.mailbox_id || defaultComposeMailboxId(),
      // Remember the original mailbox so we can warn if the user switches
      originalMailboxId: email.mailbox_id || null,
      to: fromAddr,
      cc: '',
      bcc: '',
      subject: replySubject,
      body: (prefillBody || email.draft_reply || '') + quoteHeader + quotedLines,
      attachments: [],
      replyToId: email.id,
      threadId: email.metadata?.thread_id || null,
      inReplyTo: msgId || null,
      references: refs || null,
      showCcBcc: false
    })
  }

  async function handleAttachFile(e) {
    const files = Array.from(e.target.files || [])
    const newAttachments = []
    for (const file of files) {
      if (file.size > 25 * 1024 * 1024) {
        showToast(`${file.name} too big (max 25MB)`)
        continue
      }
      const b64 = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result.split(',')[1])
        reader.onerror = reject
        reader.readAsDataURL(file)
      })
      newAttachments.push({ filename: file.name, mimeType: file.type || 'application/octet-stream', data: b64, size: file.size })
    }
    setComposer(c => c ? { ...c, attachments: [...c.attachments, ...newAttachments] } : c)
    e.target.value = ''
  }

  async function sendComposer() {
    if (!composer) return
    if (!composer.to.trim()) { showToast('Recipient required'); return }
    if (!composer.subject.trim() && !confirm('Send with no subject?')) return
    setSending(true)
    try {
      // Determine which mailbox to send from:
      //   - Reply: use the original email's mailbox_id
      //   - Compose from unified view: use primary mailbox
      //   - Compose from a specific account view: use that account
      let sendMailboxId = composer.mailboxId
      if (!sendMailboxId) {
        if (composer.replyToId) {
          const original = emails.find(e => e.id === composer.replyToId)
          sendMailboxId = original?.mailbox_id || null
        }
        if (!sendMailboxId && !isUnifiedView) {
          sendMailboxId = selectedAccountId
        }
        if (!sendMailboxId) {
          const primary = mailboxes.find(m => m.is_primary) || mailboxes[0]
          sendMailboxId = primary?.id || null
        }
      }

      const res = await fetch('/.netlify/functions/gmail-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mailbox_id: sendMailboxId,
          company_id: companyId, // legacy fallback
          to: composer.to,
          cc: composer.cc,
          bcc: composer.bcc,
          subject: composer.subject,
          body: composer.body,
          attachments: composer.attachments,
          thread_id: composer.threadId,
          in_reply_to: composer.inReplyTo,
          references: composer.references
        })
      })
      const data = await res.json()
      if (!res.ok || data.error) {
        showToast('Send failed: ' + (data.error || 'Unknown'))
        setSending(false)
        return
      }

      // Log as outbound in inbox_emails
      const outboundRow = {
        company_id: companyId,
        from_address: data.from || gmailEmail,
        from_name: 'Me',
        subject: composer.subject,
        body: composer.body,
        raw_text: `To: ${composer.to}\nSubject: ${composer.subject}\n\n${composer.body}`,
        categories: [],
        priority: 'normal',
        summary: composer.body.slice(0, 200),
        status: 'sent',
        metadata: {
          gmail_id: data.gmail_id,
          thread_id: data.thread_id,
          direction: 'outbound',
          to: composer.to,
          cc: composer.cc,
          bcc: composer.bcc,
          date: new Date().toISOString(),
          attachments: composer.attachments.map(a => ({ filename: a.filename, mimeType: a.mimeType, size: a.size })),
          reply_to_email_id: composer.replyToId
        }
      }
      await supabase.from('inbox_emails').insert(outboundRow)

      // If this was a reply, mark original as actioned and log to linked job activity
      if (composer.replyToId) {
        await supabase.from('inbox_emails').update({ status: 'actioned', actioned_at: new Date().toISOString() }).eq('id', composer.replyToId)
        const original = emails.find(e => e.id === composer.replyToId)
        const jobId = original?.metadata?.linked_job_id
        if (jobId) {
          await supabase.from('job_activity').insert({
            company_id: companyId, job_id: jobId, author_id: profile?.id,
            type: 'email_sent',
            content: `Replied to ${composer.to}: ${composer.subject}`,
            metadata: { gmail_id: data.gmail_id, thread_id: data.thread_id }
          })
        }
      }

      showToast('Email sent')
      setComposer(null)
      setShowDetail(null)
      loadEmails()
    } catch (err) {
      showToast('Send error: ' + err.message)
    }
    setSending(false)
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

  // Server-side filters mean `emails` is already view+filter-scoped.
  // Client-side sort runs over the currently-loaded slice only.
  // Option C: strip empty/garbage rows at render time so the existing DB
  // cruft is hidden immediately. Sync-time filtering prevents new ones.
  let displayEmails = (searchResults ? searchResults : emails).filter(e => !isEmptyEmail(e))

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

  const filterDefs = [
    { id: 'all', label: 'All', icon: '📬' },
    { id: 'unread', label: 'Unread', icon: '🔵' },
    { id: 'insurance', label: 'Insurance', icon: '🏢' },
    { id: 'client', label: 'Clients', icon: '👤' },
    { id: 'supplier', label: 'Suppliers', icon: '🚚' },
    { id: 'urgent', label: 'Urgent', icon: '🚨' }
  ]

  // Shared email detail content — rendered in mobile Modal OR desktop preview pane
  // Extract sender email from "Name <email@x.com>" or raw email
  const senderRaw = showDetail?.from_address || ''
  const senderEmail = (() => {
    const m = senderRaw.match(/<([^>]+)>/)
    return (m ? m[1] : senderRaw).trim()
  })()
  const senderName = showDetail?.from_name || senderEmail.split('@')[0] || 'Unknown'
  const senderInitial = (senderName || '?').charAt(0).toUpperCase()
  const senderCat = (showDetail?.categories || [])[0] || 'client'
  const senderAvColor = { insurance: '#8B5CF6', urgent: '#FF3B5C', supplier: '#2196F3', pm: '#FF6B35', client: '#00D4A0', internal: '#7A8799' }[senderCat] || '#00D4A0'
  const toAddr = showDetail?.metadata?.to || gmailEmail || ''
  const ccAddr = showDetail?.metadata?.cc || ''
  // Pull display name out of "Name <email>" if possible; otherwise use the local part of the email
  const toShortLabel = (() => {
    if (!toAddr) return ''
    const m = toAddr.match(/^\s*"?([^"<]+?)"?\s*<([^>]+)>/)
    if (m) return m[1].trim()
    const emailOnly = toAddr.split(',')[0].trim()
    return emailOnly.includes('@') ? emailOnly.split('@')[0] : emailOnly
  })()
  const fullDate = showDetail?.metadata?.date
    ? new Date(showDetail.metadata.date).toLocaleString('en-CA', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : new Date(showDetail?.created_at || Date.now()).toLocaleString('en-CA')

  const emailDetailContent = showDetail ? (
    <>
      {/* Subject */}
      <div style={{ fontSize: 20, fontWeight: 800, lineHeight: 1.3, marginBottom: 16, wordBreak: 'break-word' }}>
        {showDetail.subject || '(no subject)'}
      </div>

      {/* Gmail-style header */}
      <div className="email-header">
        {/* Avatar */}
        <div className="email-header-avatar" style={{ background: senderAvColor }}>
          {senderInitial}
        </div>

        {/* Sender + recipients */}
        <div className="email-header-body">
          {/* Sender line — name only + date right */}
          <div className="email-header-sender">
            <span className="email-header-name">{senderName}</span>
            <span className="email-header-date">{fullDate}</span>
          </div>

          {/* "to ___" line with chevron on the right */}
          <div className="email-header-to-row">
            <span className="email-header-to">
              to <span className="email-header-to-name">{toShortLabel || '—'}</span>
            </span>
            <button
              className="email-header-chevron"
              onClick={() => setHeaderExpanded(h => !h)}
              title={headerExpanded ? 'Hide details' : 'Show details'}
              aria-label={headerExpanded ? 'Hide details' : 'Show details'}
            >
              {headerExpanded ? '▲' : '▼'}
            </button>
          </div>

          {/* Expanded detail panel — shown only when chevron is clicked */}
          {headerExpanded && (
            <div className="email-header-details">
              <span className="email-header-label">from:</span>
              <span className="email-header-value">
                <strong>{senderName}</strong> &lt;{senderEmail}&gt;
              </span>
              <span className="email-header-label">to:</span>
              <span className="email-header-value">{toAddr || '—'}</span>
              {ccAddr && <>
                <span className="email-header-label">cc:</span>
                <span className="email-header-value">{ccAddr}</span>
              </>}
              <span className="email-header-label">date:</span>
              <span className="email-header-value">{fullDate}</span>
              <span className="email-header-label">subject:</span>
              <span className="email-header-value">{showDetail.subject || '(no subject)'}</span>
            </div>
          )}

          {/* Category tags */}
          {(showDetail.categories || []).length > 0 && (
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 8 }}>
              {(showDetail.categories || []).map(c => {
                const s = CAT_COLORS[c] || CAT_COLORS.client
                return <span key={c} className="etag" style={{ background: s.bg, color: s.color }}>{c.toUpperCase()}</span>
              })}
            </div>
          )}
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

      {/* THE EMAIL — render HTML if available, plain text fallback */}
      {showDetail._bodyLoading ? (
        <div className="email-full-body" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 200, color: 'var(--text3)' }}>
          <div className="spinner" style={{ marginRight: 10 }} /> Loading...
        </div>
      ) : showDetail.html_body ? (
        <iframe
          srcDoc={`<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>
            html,body{margin:0;padding:16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Helvetica Neue',Arial,sans-serif;font-size:14px;line-height:1.6;color:#222;background:#fff;overflow-x:hidden;word-wrap:break-word;overflow-wrap:anywhere}
            *{max-width:100%!important;box-sizing:border-box}
            img,table,video{max-width:100%!important;height:auto!important}
            table{width:auto!important}
            pre{white-space:pre-wrap!important;word-break:break-word}
            a{color:#1a73e8}
          </style></head><body>${showDetail.html_body}</body></html>`}
          sandbox=""
          style={{
            width: '100%', minHeight: 300, maxHeight: '50vh', border: '1px solid var(--border)',
            borderRadius: 12, background: '#fff', display: 'block'
          }}
          onLoad={e => { try { e.target.style.height = Math.min(e.target.contentWindow.document.body.scrollHeight + 20, 600) + 'px' } catch(err){} }}
        />
      ) : (
        <div className="email-full-body">
          {showDetail.body || showDetail.raw_text || 'No content'}
        </div>
      )}

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
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <button
            onClick={() => {
              const el = document.getElementById('reply-area')
              const text = el?.value || ''
              openReplyComposer(showDetail, text)
            }}
            disabled={!gmailConnected}
            style={{ flex: 1, padding: '10px 14px', borderRadius: 8, border: 'none', background: gmailConnected ? 'var(--primary)' : 'var(--card2)', color: gmailConnected ? '#000' : 'var(--text3)', fontSize: 13, fontWeight: 700, cursor: gmailConnected ? 'pointer' : 'not-allowed', fontFamily: 'DM Sans' }}
          >📤 Send Reply</button>
        </div>
        {!gmailConnected && <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 4 }}>Connect Gmail to send replies directly</div>}
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button className="btn btn-danger btn-full" style={{ padding: 12 }} onClick={() => deleteEmail(showDetail.id)}>Delete</button>
        {!isDesktop && <button className="btn btn-secondary btn-full" style={{ padding: 12 }} onClick={() => setShowDetail(null)}>Close</button>}
      </div>
    </>
  ) : null

  return (
    <div className="inbox-shell">
      {/* LEFT — email list column */}
      <div className="inbox-main">
        {/* Top bar — title reflects selected account */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            {isUnifiedView ? (
              <span style={{ fontSize: 20 }}>📬</span>
            ) : (
              <span style={{
                width: 10, height: 10, borderRadius: '50%',
                background: selectedAccount?.color || 'var(--text3)',
                flexShrink: 0
              }} />
            )}
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {isUnifiedView ? 'Unified Inbox' : (selectedAccount?.email || 'Inbox')}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                {isUnifiedView
                  ? `${totalEmails.toLocaleString()} emails • ${connectedAccounts.length - 1} accounts`
                  : `${totalEmails.toLocaleString()} emails`}
              </div>
            </div>
          </div>
          {!gmailConnected && <button onClick={connectGmail} style={{ padding: '6px 12px', borderRadius: 8, fontSize: 11, fontWeight: 600, border: '1px solid rgba(0,212,160,0.2)', background: 'transparent', color: 'var(--primary)', cursor: 'pointer', fontFamily: 'DM Sans' }}>📧 Connect Gmail</button>}
        </div>

        {/* MOBILE ONLY — compact toolbar: Compose + Search + Filter toggle */}
        {!isDesktop && (
          <div className="inbox-mobile-bar">
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <button
                onClick={openCompose}
                disabled={!gmailConnected}
                style={{
                  flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  padding: '10px 12px', borderRadius: 10, border: 'none',
                  background: gmailConnected ? 'var(--primary)' : 'var(--card2)',
                  color: gmailConnected ? '#000' : 'var(--text3)',
                  fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: 'DM Sans'
                }}
              >
                ✍️ Compose
              </button>
              <button
                onClick={() => setMobileFiltersOpen(o => !o)}
                style={{
                  padding: '10px 14px', borderRadius: 10,
                  border: '1px solid var(--border)', background: mobileFiltersOpen ? 'var(--card)' : 'transparent',
                  color: 'var(--text2)', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'DM Sans'
                }}
              >
                ⚙
              </button>
            </div>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 12, color: 'var(--text3)' }}>🔍</span>
              <input
                value={emailSearch}
                onChange={e => setEmailSearch(e.target.value)}
                placeholder="Search emails..."
                style={{
                  width: '100%', padding: '9px 10px 9px 30px', background: 'var(--bg2)',
                  border: '1px solid var(--border)', borderRadius: 10, fontSize: 13,
                  color: 'var(--text)', outline: 'none', fontFamily: 'DM Sans', boxSizing: 'border-box'
                }}
              />
            </div>

            {/* Collapsible filters panel */}
            {mobileFiltersOpen && (
              <div style={{ marginTop: 10, padding: 10, background: 'var(--bg2)', borderRadius: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {gmailConnected && (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => fetchGmailEmails(false)} disabled={syncing} style={{ flex: 1, padding: '8px', borderRadius: 8, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text2)', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'DM Sans' }}>{syncing ? '⏳' : '🔄 Sync'}</button>
                    <button onClick={bulkImport} disabled={importing} style={{ flex: 1, padding: '8px', borderRadius: 8, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text2)', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'DM Sans' }}>{importing ? '⏳' : '📥 Import'}</button>
                    <button onClick={() => setShowCompose(s => !s)} style={{ flex: 1, padding: '8px', borderRadius: 8, background: 'transparent', border: '1px solid var(--border)', color: 'var(--text2)', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'DM Sans' }}>📋 Paste</button>
                  </div>
                )}
                <select value={emailSort} onChange={e => setEmailSort(e.target.value)} style={{ width: '100%', padding: '9px 10px', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)', fontSize: 12, fontFamily: 'DM Sans', outline: 'none' }}>
                  <option value="newest">Newest first</option>
                  <option value="oldest">Oldest first</option>
                  <option value="name_az">Name A–Z</option>
                  <option value="name_za">Name Z–A</option>
                  <option value="unread">Unread first</option>
                  <option value="priority">Priority</option>
                </select>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {filterDefs.map(f => (
                    <button
                      key={f.id}
                      onClick={() => setFilter(f.id)}
                      style={{
                        padding: '6px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'DM Sans',
                        border: filter === f.id ? '1px solid var(--primary)' : '1px solid var(--border)',
                        background: filter === f.id ? 'rgba(0,212,160,0.12)' : 'transparent',
                        color: filter === f.id ? 'var(--primary)' : 'var(--text2)'
                      }}
                    >{f.icon} {f.label}</button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {importing && <div style={{ padding: '6px 20px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--primary)', marginBottom: 4 }}>
            <span>Importing...</span><span>{importProgress.done}{importProgress.total ? ` / ~${importProgress.total}` : ''}</span>
          </div>
          <div style={{ height: 3, background: 'var(--bg2)', borderRadius: 2 }}><div style={{ height: '100%', borderRadius: 2, background: 'var(--primary)', width: importProgress.total ? `${Math.min((importProgress.done / importProgress.total) * 100, 100)}%` : '30%' }} /></div>
        </div>}

        {/* Bulk actions toolbar — replaces the old tab strip */}
        <div className="inbox-toolbar">
          {selectedEmails.size > 0 ? (
            <>
              <span className="toolbar-count">{selectedEmails.size} selected</span>
              <button className="toolbar-btn" onClick={bulkArchiveSelected} title="Archive">📥 Archive</button>
              <button className="toolbar-btn" onClick={() => showToast('Assign coming soon')} title="Assign">👤 Assign</button>
              <button className="toolbar-btn" onClick={() => bulkMoveSelected('spam')} title="Mark as spam">🛑 Spam</button>
              <button className="toolbar-btn danger" onClick={() => bulkMoveSelected('trash')} title="Move to trash">🗑 Trash</button>
              <button className="toolbar-btn" onClick={clearSelection} title="Clear selection">✕ Clear</button>
            </>
          ) : (
            <>
              <label className="toolbar-select-all">
                <input
                  type="checkbox"
                  checked={displayEmails.length > 0 && displayEmails.every(e => selectedEmails.has(e.id))}
                  onChange={e => {
                    if (e.target.checked) setSelectedEmails(new Set(displayEmails.map(em => em.id)))
                    else clearSelection()
                  }}
                />
                <span>Select all</span>
              </label>
              <span className="toolbar-spacer" />
              <span className="toolbar-subtle">
                {selectedView === 'assigned' ? 'Assigned to me'
                  : selectedView === 'archived' ? 'Archived'
                  : `${totalEmails.toLocaleString()} emails`}
              </span>
            </>
          )}
        </div>

        {/* Email list */}
        <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
        {displayEmails.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">{selectedView === 'archived' ? '📥' : selectedView === 'assigned' ? '👤' : '📬'}</div>
            <div className="empty-title">
              {selectedView === 'archived' ? 'Nothing archived' : selectedView === 'assigned' ? 'Nothing assigned to you' : 'No emails'}
            </div>
            <div className="empty-sub">
              {selectedView === 'archived' ? 'Emails you archive show up here' :
               selectedView === 'assigned' ? 'Emails assigned to you appear here' :
               gmailConnected ? 'Emails sync automatically' : 'Connect Gmail or paste an email'}
            </div>
          </div>
        ) : displayEmails.map(email => {
          const cat = (email.categories || [])[0] || 'client'
          const catStyle = CAT_COLORS[cat] || CAT_COLORS.client
          const isLinked = email.metadata?.linked_job_id
          const linkedJob = isLinked ? jobs.find(j => j.id === isLinked) : null
          const init = (email.from_name || email.from_address || '?').charAt(0).toUpperCase()
          // Real: show the dot in unified view when we have 2+ mailboxes
          const emailAccount = isUnifiedView && mailboxes.length > 1 ? accountForEmail(email) : null

          const isSelected = selectedEmails.has(email.id)
          return (
            <div
              key={email.id}
              className={`email-row ${email.status === 'unread' ? 'unread' : ''} ${showDetail?.id === email.id ? 'selected' : ''} ${isSelected ? 'checked' : ''}`}
              onClick={(e) => {
                // Don't open detail if user clicked the checkbox or a quick action
                if (e.target.closest('.email-row-checkbox, .email-row-actions')) return
                openEmail(email)
              }}
            >
              {/* Checkbox (shows on hover or when in selection mode) */}
              <label
                className="email-row-checkbox"
                onClick={e => e.stopPropagation()}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleSelectEmail(email.id)}
                />
              </label>
              <div className="email-av-wrap">
                <div className="email-av" style={{ background: avColors[cat] || '#00D4A0' }}>{init}</div>
                {emailAccount && (
                  <span
                    className="email-av-account-dot"
                    style={{ background: emailAccount.color }}
                    title={emailAccount.email}
                  />
                )}
              </div>
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
              <div className="email-right">
                <div className="email-time">{formatEmailDate(email)}</div>
                <div className="email-row-actions">
                  <button title="Assign" onClick={e => { e.stopPropagation(); showToast('Assign coming soon') }}>👤</button>
                  <button title="Snooze" onClick={e => { e.stopPropagation(); showToast('Snooze coming soon') }}>⏰</button>
                  <button title="Archive" onClick={e => { e.stopPropagation(); archiveEmail(email.id) }}>✓</button>
                </div>
              </div>
            </div>
          )
        })}

        {/* Infinite scroll sentinel */}
        {!searchResults && hasMore && (
          <div ref={sentinelRef} className="inbox-sentinel">
            {loadingMore ? (
              <><div className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> Loading more...</>
            ) : (
              <span style={{ fontSize: 11, color: 'var(--text3)' }}>Scroll for more</span>
            )}
          </div>
        )}
        {!searchResults && !hasMore && displayEmails.length > 0 && (
          <div style={{ padding: 20, textAlign: 'center', fontSize: 11, color: 'var(--text3)' }}>
            End of list • {displayEmails.length.toLocaleString()} shown
          </div>
        )}
        </div>
      </div>

      {/* RIGHT SIDEBAR — compose, search, sort, filters */}
      <aside className="inbox-sidebar">
        {/* Compose (primary CTA) */}
        <button
          onClick={openCompose}
          disabled={!gmailConnected}
          className="sidebar-compose"
        >
          <span style={{ fontSize: 18 }}>✍️</span>
          <span>Compose</span>
        </button>

        {/* VIEWS — workflow hierarchy (top of sidebar) */}
        <div className="sidebar-section">
          <div className="sidebar-label">Views</div>
          <div className="mailbox-list">
            <button
              onClick={() => { setSelectedView('inbox'); setSelectedFolder(null); setSelectedAccountId(selectedAccountId || 'unified') }}
              className={`mailbox-row ${selectedView === 'inbox' && !selectedFolder ? 'active' : ''}`}
            >
              <span className="mailbox-icon">📥</span>
              <span className="mailbox-label">All Inbox</span>
            </button>
            <button
              onClick={() => { setSelectedView('assigned'); setSelectedFolder(null); setSelectedAccountId('unified') }}
              className={`mailbox-row prominent ${selectedView === 'assigned' ? 'active' : ''}`}
            >
              <span className="mailbox-icon">👤</span>
              <span className="mailbox-label">Assigned to me</span>
            </button>
            <button
              onClick={() => { setSelectedView('archived'); setSelectedFolder(null); setSelectedAccountId('unified') }}
              className={`mailbox-row ${selectedView === 'archived' ? 'active' : ''}`}
            >
              <span className="mailbox-icon">✅</span>
              <span className="mailbox-label">Archived / Done</span>
            </button>
          </div>
        </div>

        {/* FOLDERS — standard email folders (sent/drafts/spam/trash) */}
        <div className="sidebar-section">
          <div className="sidebar-label">Folders</div>
          <div className="mailbox-list">
            {[
              { id: 'sent', label: 'Sent', icon: '📤' },
              { id: 'drafts', label: 'Drafts', icon: '📝' },
              { id: 'spam', label: 'Spam / Junk', icon: '🛑' },
              { id: 'trash', label: 'Trash', icon: '🗑' }
            ].map(f => {
              const active = selectedFolder === f.id
              return (
                <button
                  key={f.id}
                  onClick={() => {
                    setSelectedFolder(f.id)
                    setSelectedView('inbox') // folders are scoped within inbox view
                  }}
                  className={`mailbox-row ${active ? 'active' : ''}`}
                >
                  <span className="mailbox-icon">{f.icon}</span>
                  <span className="mailbox-label">{f.label}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* INBOXES — real mailboxes from DB */}
        <div className="sidebar-section">
          <div className="sidebar-label">Inboxes</div>
          <div className="mailbox-list">
            {connectedAccounts
              // Hide the Unified row when there's only one real mailbox
              .filter(a => a.type !== 'unified' || mailboxes.length > 1)
              .map(acct => {
                const active = selectedView === 'inbox' && !selectedFolder && selectedAccountId === acct.id
                const isUnified = acct.type === 'unified'
                return (
                  <button
                    key={acct.id}
                    onClick={() => { setSelectedView('inbox'); setSelectedFolder(null); setSelectedAccountId(acct.id) }}
                    className={`mailbox-row ${active ? 'active' : ''}`}
                    title={isUnified ? 'All accounts' : acct.email}
                  >
                    {isUnified ? (
                      <span className="mailbox-icon">{acct.icon}</span>
                    ) : (
                      <span className="mailbox-dot" style={{ background: acct.color }} />
                    )}
                    <span className="mailbox-label">
                      {isUnified ? 'Unified Inbox' : acct.email}
                    </span>
                  </button>
                )
              })}
            {mailboxes.length === 0 && (
              <div style={{ padding: '10px 12px', fontSize: 11, color: 'var(--text3)' }}>
                No mailboxes connected. Use "Connect Gmail" below.
              </div>
            )}
            <button
              onClick={() => connectGmail('add')}
              className="mailbox-row add-row"
            >
              <span className="mailbox-icon">＋</span>
              <span className="mailbox-label">Add Gmail account</span>
            </button>
          </div>
        </div>

        {/* Gmail actions — apply to the currently-selected account */}
        {gmailConnected && !isUnifiedView && (
          <div className="sidebar-section">
            <div className="sidebar-label">Account actions</div>
            <button onClick={() => fetchGmailEmails(false)} disabled={syncing} className="sidebar-btn">
              {syncing ? '⏳ Syncing...' : '🔄 Sync now'}
            </button>
            <button onClick={bulkImport} disabled={importing} className="sidebar-btn">
              {importing ? '⏳ Importing...' : '📥 Bulk import'}
            </button>
            <button onClick={() => setShowCompose(s => !s)} className="sidebar-btn">
              📋 Paste manually
            </button>
          </div>
        )}

        {/* Paste manually inline panel */}
        {showCompose && (
          <div className="sidebar-section">
            <textarea
              value={inputText}
              onChange={e => setInputText(e.target.value)}
              placeholder="Paste email text..."
              style={{ width: '100%', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, padding: 10, fontSize: 12, color: 'var(--text)', fontFamily: 'DM Sans', outline: 'none', resize: 'none', minHeight: 100, lineHeight: 1.5, marginBottom: 6 }}
            />
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={analyzeAndSave} disabled={analyzing} className="sidebar-btn" style={{ flex: 1, background: analyzing ? 'var(--card2)' : 'var(--primary)', color: analyzing ? 'var(--text3)' : '#000', fontWeight: 700, border: 'none' }}>{analyzing ? '⏳' : '🤖 Analyze'}</button>
              <button onClick={() => setShowCompose(false)} className="sidebar-btn" style={{ flex: 'none' }}>✕</button>
            </div>
          </div>
        )}

        {/* Search */}
        <div className="sidebar-section">
          <div className="sidebar-label">Search</div>
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 12, color: 'var(--text3)' }}>🔍</span>
            <input
              value={emailSearch}
              onChange={e => setEmailSearch(e.target.value)}
              placeholder="Search emails..."
              style={{
                width: '100%', padding: '9px 10px 9px 30px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, color: 'var(--text)', outline: 'none', fontFamily: 'DM Sans', boxSizing: 'border-box'
              }}
            />
          </div>
        </div>

        {/* Sort */}
        <div className="sidebar-section">
          <div className="sidebar-label">Sort by</div>
          <select value={emailSort} onChange={e => setEmailSort(e.target.value)} className="sidebar-select">
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="name_az">Name A–Z</option>
            <option value="name_za">Name Z–A</option>
            <option value="unread">Unread first</option>
            <option value="priority">Priority</option>
          </select>
        </div>

        {/* Filters */}
        <div className="sidebar-section">
          <div className="sidebar-label">Filter</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {filterDefs.map(f => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                className={`sidebar-filter ${filter === f.id ? 'active' : ''}`}
              >
                <span>{f.icon}</span>
                <span>{f.label}</span>
              </button>
            ))}
          </div>
        </div>
      </aside>

      {/* DESKTOP PREVIEW PANE — takes ~60% of screen */}
      {isDesktop && (
        <div className="inbox-preview">
          {showDetail ? (
            <div className="inbox-preview-inner">
              {emailDetailContent}
            </div>
          ) : (
            <div className="inbox-preview-empty">
              <div style={{ fontSize: 48, marginBottom: 12 }}>📬</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text2)', marginBottom: 4 }}>Select an email</div>
              <div style={{ fontSize: 12, color: 'var(--text3)' }}>Click any email in the list to preview it here</div>
            </div>
          )}
        </div>
      )}

      {/* EMAIL DETAIL — Modal on mobile only */}
      {showDetail && !isDesktop && (
        <Modal title={null} onClose={() => setShowDetail(null)}>
          {emailDetailContent}
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

      {/* COMPOSER MODAL — real Gmail compose */}
      {composer && (() => {
        const currentMb = mailboxes.find(m => m.id === composer.mailboxId)
        const originalMb = composer.originalMailboxId ? mailboxes.find(m => m.id === composer.originalMailboxId) : null
        const switchedFromOriginal = !!(composer.replyToId && composer.originalMailboxId && composer.mailboxId !== composer.originalMailboxId)
        return (
        <Modal title={composer.replyToId ? 'Reply' : 'New Message'} onClose={() => !sending && setComposer(null)}>
          {/* From picker */}
          <div className="form-field">
            <label className="form-label">From</label>
            {mailboxes.length === 1 ? (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '10px 12px', background: 'var(--bg2)', borderRadius: 8,
                border: '1px solid var(--border)', fontSize: 13, color: 'var(--text2)'
              }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: currentMb?.color || '#00D4A0' }} />
                <span>{currentMb?.email_address || 'Not connected'}</span>
              </div>
            ) : (
              <select
                className="form-input"
                value={composer.mailboxId || ''}
                onChange={e => {
                  const newId = e.target.value
                  if (composer.replyToId && composer.originalMailboxId && newId !== composer.originalMailboxId) {
                    const ok = confirm('Replies usually send from the account that received the email. Switch to a different account anyway?')
                    if (!ok) return
                  }
                  setComposer(c => ({ ...c, mailboxId: newId }))
                }}
              >
                {mailboxes.map(m => (
                  <option key={m.id} value={m.id}>
                    {m.email_address}{m.is_primary ? ' (primary)' : ''}
                  </option>
                ))}
              </select>
            )}
            {switchedFromOriginal && originalMb && (
              <div style={{ fontSize: 10, color: 'var(--yellow)', marginTop: 4 }}>
                ⚠ Original email came in on <strong>{originalMb.email_address}</strong>
              </div>
            )}
          </div>

          {/* To */}
          <div className="form-field">
            <label className="form-label">To *</label>
            <input
              className="form-input"
              placeholder="recipient@example.com"
              value={composer.to}
              onChange={e => setComposer(c => ({ ...c, to: e.target.value }))}
              list="compose-contacts"
            />
            <datalist id="compose-contacts">
              {clients.filter(c => c.email).map(c => (
                <option key={c.id} value={c.email}>{c.name}</option>
              ))}
            </datalist>
          </div>

          {/* Cc/Bcc toggle */}
          {!composer.showCcBcc && (
            <button
              onClick={() => setComposer(c => ({ ...c, showCcBcc: true }))}
              style={{ background: 'none', border: 'none', color: 'var(--text3)', fontSize: 11, cursor: 'pointer', padding: '0 0 8px', fontFamily: 'DM Sans' }}
            >+ Add Cc / Bcc</button>
          )}
          {composer.showCcBcc && <>
            <div className="form-field">
              <label className="form-label">Cc</label>
              <input className="form-input" placeholder="cc@example.com" value={composer.cc} onChange={e => setComposer(c => ({ ...c, cc: e.target.value }))} />
            </div>
            <div className="form-field">
              <label className="form-label">Bcc</label>
              <input className="form-input" placeholder="bcc@example.com" value={composer.bcc} onChange={e => setComposer(c => ({ ...c, bcc: e.target.value }))} />
            </div>
          </>}

          {/* Subject */}
          <div className="form-field">
            <label className="form-label">Subject</label>
            <input className="form-input" placeholder="Subject" value={composer.subject} onChange={e => setComposer(c => ({ ...c, subject: e.target.value }))} />
          </div>

          {/* Template picker */}
          {replyTemplates.length > 0 && (
            <div className="form-field">
              <label className="form-label">Insert template</label>
              <select
                className="form-input"
                value=""
                onChange={e => {
                  if (!e.target.value) return
                  const tpl = replyTemplates.find(t => t.id === e.target.value)
                  if (tpl) {
                    const ctx = composer.replyToId ? emails.find(em => em.id === composer.replyToId) : null
                    const applied = ctx ? applyTemplate(tpl, ctx) : (tpl.body || '')
                    setComposer(c => ({ ...c, body: applied + (c.body ? '\n\n' + c.body : '') }))
                  }
                  e.target.value = ''
                }}
              >
                <option value="">-- Pick a template --</option>
                {replyTemplates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          )}

          {/* Body */}
          <div className="form-field">
            <label className="form-label">Message</label>
            <textarea
              className="form-input"
              style={{ minHeight: 240, fontFamily: 'DM Sans', lineHeight: 1.6 }}
              placeholder="Write your message..."
              value={composer.body}
              onChange={e => setComposer(c => ({ ...c, body: e.target.value }))}
            />
          </div>

          {/* Attachments */}
          <div className="form-field">
            <label className="form-label">Attachments</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {composer.attachments.map((att, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: 'var(--bg2)', borderRadius: 8, fontSize: 12 }}>
                  <span>{att.mimeType?.includes('image') ? '🖼️' : att.mimeType?.includes('pdf') ? '📄' : '📎'}</span>
                  <span style={{ flex: 1, color: 'var(--text2)' }}>{att.filename}</span>
                  <span style={{ fontSize: 10, color: 'var(--text3)' }}>{(att.size / 1024).toFixed(0)} KB</span>
                  <button
                    onClick={() => setComposer(c => ({ ...c, attachments: c.attachments.filter((_, j) => j !== i) }))}
                    style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', fontSize: 14 }}
                  >×</button>
                </div>
              ))}
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 12px', border: '1px dashed var(--border)', borderRadius: 8, cursor: 'pointer', fontSize: 11, color: 'var(--text3)', fontFamily: 'DM Sans', alignSelf: 'flex-start' }}>
                📎 Attach files
                <input type="file" multiple onChange={handleAttachFile} style={{ display: 'none' }} />
              </label>
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button
              className="btn btn-primary"
              style={{ flex: 1, padding: 14, fontWeight: 700 }}
              disabled={sending || !composer.to.trim()}
              onClick={sendComposer}
            >{sending ? 'Sending...' : '📤 Send'}</button>
            <button
              className="btn btn-secondary"
              style={{ padding: '14px 20px' }}
              disabled={sending}
              onClick={() => setComposer(null)}
            >Cancel</button>
          </div>
        </Modal>
        )
      })()}
    </div>
  )
}

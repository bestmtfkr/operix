import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useToast } from '../shared/Toast'
import Modal from '../shared/Modal'
import { JOB_STAGES, STAGE_LABELS, STAGE_COLORS, JOB_TYPES, JOB_TYPE_LABELS, PRIORITIES, PRIORITY_LABELS, PRIORITY_COLORS } from '../../lib/constants'
import TasksList from '../tasks/TasksList'
import JobDetail from './JobDetail'
import AIJobAssistant from '../shared/AIJobAssistant'
import CalendarView from './CalendarView'
import DispatchBoard from './DispatchBoard'
import './Jobs.css'

export default function JobsList() {
  const { companyId, profile } = useAuth()
  const showToast = useToast()
  const [jobs, setJobs] = useState([])
  const [clients, setClients] = useState([])
  const [workers, setWorkers] = useState([])
  const [assignedWorkers, setAssignedWorkers] = useState([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState('list') // 'list', 'pipeline', 'tasks'
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [search, setSearch] = useState('')
  const [stageFilter, setStageFilter] = useState('all')
  const [clientFilter, setClientFilter] = useState('all')
  const [sortBy, setSortBy] = useState('newest')
  const [detailJobId, setDetailJobId] = useState(null)
  const [showAI, setShowAI] = useState(false)

  const [form, setForm] = useState({
    name: '', client_id: '', description: '', stage: 'lead', priority: 'normal',
    job_type: '', estimated_value: '', site_address: '', site_city: '',
    site_province_state: '', scheduled_start: '', scheduled_end: '',
    insurance_claim_number: '', insurance_company: '', unit_numbers: '', notes: '',
    is_recurring: false, recurrence_frequency: 'weekly', recurrence_interval: 1
  })

  useEffect(() => { if (companyId) { loadJobs(); loadClients(); loadWorkers() } }, [companyId])

  async function loadJobs() {
    const { data } = await supabase
      .from('jobs')
      .select('*, clients(name)')
      .eq('company_id', companyId)
      .is('archived_at', null)
      .order('created_at', { ascending: false })
    setJobs(data || [])
    setLoading(false)
  }

  async function loadClients() {
    const { data } = await supabase
      .from('clients')
      .select('id, name')
      .eq('company_id', companyId)
      .is('archived_at', null)
      .order('name')
    setClients(data || [])
  }

  async function loadWorkers() {
    const { data } = await supabase
      .from('workers')
      .select('id, first_name, last_name, role')
      .eq('company_id', companyId)
      .is('archived_at', null)
      .order('first_name')
    setWorkers(data || [])
  }

  async function loadAssignedWorkers(jobId) {
    const { data } = await supabase
      .from('job_workers')
      .select('*, workers(first_name, last_name, role)')
      .eq('job_id', jobId)
      .is('removed_at', null)
    setAssignedWorkers(data || [])
  }

  async function assignWorker(workerId) {
    if (!editing) return
    const exists = assignedWorkers.find(aw => aw.worker_id === workerId)
    if (exists) { showToast('Already assigned'); return }
    const { error } = await supabase.from('job_workers').insert({
      company_id: companyId, job_id: editing.id, worker_id: workerId, role_on_job: 'crew'
    })
    if (error) { showToast('Error assigning worker'); return }
    showToast('Worker assigned')
    loadAssignedWorkers(editing.id)
  }

  async function removeWorker(jwId) {
    await supabase.from('job_workers').update({ removed_at: new Date().toISOString() }).eq('id', jwId)
    showToast('Worker removed from job')
    loadAssignedWorkers(editing.id)
  }

  function openNew() {
    setEditing(null)
    setAssignedWorkers([])
    setForm({
      name: '', client_id: '', description: '', stage: 'lead', priority: 'normal',
      job_type: '', estimated_value: '', site_address: '', site_city: '',
      site_province_state: '', scheduled_start: '', scheduled_end: '',
      insurance_claim_number: '', insurance_company: '', unit_numbers: '', notes: '',
    is_recurring: false, recurrence_frequency: 'weekly', recurrence_interval: 1
    })
    setShowModal(true)
  }

  function openEdit(job) {
    setEditing(job)
    setForm({
      name: job.name || '',
      client_id: job.client_id || '',
      description: job.description || '',
      stage: job.stage || 'lead',
      priority: job.priority || 'normal',
      job_type: job.job_type || '',
      estimated_value: job.estimated_value || '',
      site_address: job.site_address || '',
      site_city: job.site_city || '',
      site_province_state: job.site_province_state || '',
      scheduled_start: job.scheduled_start ? job.scheduled_start.slice(0, 16) : '',
      scheduled_end: job.scheduled_end ? job.scheduled_end.slice(0, 16) : '',
      insurance_claim_number: job.insurance_claim_number || '',
      insurance_company: job.insurance_company || '',
      unit_numbers: job.unit_numbers || '',
      notes: job.notes || '',
      is_recurring: job.is_recurring || false,
      recurrence_frequency: job.recurrence_rule?.frequency || 'weekly',
      recurrence_interval: job.recurrence_rule?.interval || 1
    })
    loadAssignedWorkers(job.id)
    setShowModal(true)
  }

  async function saveJob() {
    if (!form.name.trim()) { showToast('Please enter a job name'); return }
    if (!form.client_id) { showToast('Please select a client'); return }

    let clientId = form.client_id

    // Quick-add client if needed
    if (clientId === '__new__') {
      const quickName = document.getElementById('quick-client-name')?.value?.trim()
      if (!quickName) { showToast('Please enter client name'); return }
      const { data: newClient, error: clientErr } = await supabase.from('clients').insert({
        company_id: companyId, name: quickName, type: 'commercial',
        contact_phone: document.getElementById('quick-client-phone')?.value?.trim() || null,
        contact_email: document.getElementById('quick-client-email')?.value?.trim() || null
      }).select().single()
      if (clientErr || !newClient) { showToast('Error creating client'); return }
      clientId = newClient.id
      loadClients()
    }

    const payload = {
      ...form,
      client_id: clientId,
      estimated_value: form.estimated_value ? parseFloat(form.estimated_value) : null,
      scheduled_start: form.scheduled_start || null,
      scheduled_end: form.scheduled_end || null,
      is_recurring: form.is_recurring,
      recurrence_rule: form.is_recurring ? {
        frequency: form.recurrence_frequency,
        interval: parseInt(form.recurrence_interval) || 1
      } : null,
      company_id: companyId,
      updated_at: new Date().toISOString()
    }
    // Remove UI-only fields from payload
    delete payload.recurrence_frequency
    delete payload.recurrence_interval

    let error
    if (editing) {
      ({ error } = await supabase.from('jobs').update(payload).eq('id', editing.id))
    } else {
      // Generate job number
      const { data: numData } = await supabase.rpc('generate_job_number', { p_company_id: companyId })
      payload.job_number = numData || ('JOB-' + Date.now())
      payload.created_by = profile?.id;
      ({ error } = await supabase.from('jobs').insert(payload))
    }

    if (error) { showToast('Error saving job'); console.error(error); return }
    showToast(editing ? 'Job updated' : 'Job created')
    setShowModal(false)
    loadJobs()
  }

  async function archiveJob() {
    if (!editing || !confirm('Archive this job?')) return
    const { error } = await supabase.from('jobs')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', editing.id)
    if (error) { showToast('Error archiving job'); return }
    showToast('Job archived')
    setShowModal(false)
    loadJobs()
  }

  async function archiveJobFromKanban(jobId) {
    if (!confirm('Archive/cancel this job?')) return
    const { error } = await supabase.from('jobs')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', jobId)
    if (error) { showToast('Error archiving job'); return }
    showToast('Job archived')
    loadJobs()
  }

  // Reminder modal
  const [showReminderModal, setShowReminderModal] = useState(false)
  const [reminderJob, setReminderJob] = useState(null)
  const [reminderDate, setReminderDate] = useState('')
  const [reminderNote, setReminderNote] = useState('')

  function openReminderModal(job) {
    setReminderJob(job)
    setReminderDate(job.reminder_date || '')
    setReminderNote(job.reminder_note || '')
    setShowReminderModal(true)
  }

  async function saveReminder() {
    if (!reminderJob) return
    const { error } = await supabase.from('jobs').update({
      reminder_date: reminderDate || null,
      reminder_note: reminderNote.trim() || null,
      updated_at: new Date().toISOString()
    }).eq('id', reminderJob.id)
    if (error) { showToast('Error saving reminder'); return }
    showToast(reminderDate ? 'Reminder set for ' + reminderDate : 'Reminder cleared')
    setShowReminderModal(false)
    loadJobs()
  }

  async function clearReminder() {
    if (!reminderJob) return
    await supabase.from('jobs').update({
      reminder_date: null, reminder_note: null, updated_at: new Date().toISOString()
    }).eq('id', reminderJob.id)
    showToast('Reminder cleared')
    setShowReminderModal(false)
    loadJobs()
  }

  async function moveJob(jobId, newStage) {
    const { error } = await supabase.from('jobs')
      .update({ stage: newStage, stage_changed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', jobId)
    if (error) { showToast('Error moving job'); return }
    showToast('Moved to ' + STAGE_LABELS[newStage])
    loadJobs()
  }

  function updateForm(field, value) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  // Stage counts
  const stageCounts = {}
  jobs.forEach(j => { stageCounts[j.stage] = (stageCounts[j.stage] || 0) + 1 })

  // Filter and sort
  let filtered = jobs
  if (stageFilter !== 'all') filtered = filtered.filter(j => j.stage === stageFilter)
  if (clientFilter !== 'all') filtered = filtered.filter(j => j.client_id === clientFilter)
  if (search.trim()) {
    const q = search.toLowerCase()
    filtered = filtered.filter(j =>
      j.name.toLowerCase().includes(q) ||
      (j.clients?.name || '').toLowerCase().includes(q) ||
      (j.job_number || '').toLowerCase().includes(q)
    )
  }
  filtered = [...filtered].sort((a, b) => {
    if (sortBy === 'newest') return new Date(b.created_at) - new Date(a.created_at)
    if (sortBy === 'oldest') return new Date(a.created_at) - new Date(b.created_at)
    if (sortBy === 'value_high') return (parseFloat(b.estimated_value) || 0) - (parseFloat(a.estimated_value) || 0)
    if (sortBy === 'value_low') return (parseFloat(a.estimated_value) || 0) - (parseFloat(b.estimated_value) || 0)
    if (sortBy === 'client') return (a.clients?.name || '').localeCompare(b.clients?.name || '')
    return 0
  })

  if (detailJobId) {
    return <JobDetail jobId={detailJobId} onBack={() => { setDetailJobId(null); loadJobs() }} />
  }

  if (loading) return <div className="loading-center"><div className="spinner" /></div>

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Jobs</div>
          <div className="page-subtitle">{jobs.length} total</div>
        </div>
      </div>

      {/* View Toggle */}
      <div className="view-toggle">
        <button className={`view-toggle-btn ${view === 'list' ? 'active' : ''}`} onClick={() => setView('list')}>
          List
        </button>
        <button className={`view-toggle-btn ${view === 'pipeline' ? 'active' : ''}`} onClick={() => setView('pipeline')}>
          Pipeline
        </button>
        <button className={`view-toggle-btn ${view === 'tasks' ? 'active' : ''}`} onClick={() => setView('tasks')}>
          Tasks
        </button>
        <button className={`view-toggle-btn ${view === 'calendar' ? 'active' : ''}`} onClick={() => setView('calendar')}>
          Calendar
        </button>
        <button className={`view-toggle-btn ${view === 'dispatch' ? 'active' : ''}`} onClick={() => setView('dispatch')}>
          Dispatch
        </button>
      </div>

      {view === 'dispatch' ? (
        <DispatchBoard onJobClick={id => setDetailJobId(id)} />
      ) : view === 'calendar' ? (
        <CalendarView onJobClick={id => setDetailJobId(id)} />
      ) : view === 'tasks' ? (
        <TasksList />
      ) : view === 'list' ? (
        <>
          <div className="search-bar">
            <span className="search-icon">🔍</span>
            <input placeholder="Search jobs..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>

          {/* Stage Filter Pills */}
          <div style={{ display: 'flex', gap: 6, padding: '4px 16px 8px', overflowX: 'auto', scrollbarWidth: 'none' }}>
            <div onClick={() => setStageFilter('all')} style={{
              padding: '5px 12px', borderRadius: 10, fontSize: 11, fontWeight: 700,
              cursor: 'pointer', whiteSpace: 'nowrap',
              border: `1px solid ${stageFilter === 'all' ? 'rgba(0,212,160,0.3)' : 'var(--border)'}`,
              background: stageFilter === 'all' ? 'rgba(0,212,160,0.1)' : 'var(--card)',
              color: stageFilter === 'all' ? 'var(--primary)' : 'var(--text2)'
            }}>All ({jobs.length})</div>
            {JOB_STAGES.filter(s => stageCounts[s]).map(s => (
              <div key={s} onClick={() => setStageFilter(stageFilter === s ? 'all' : s)} style={{
                padding: '5px 12px', borderRadius: 10, fontSize: 11, fontWeight: 700,
                cursor: 'pointer', whiteSpace: 'nowrap',
                border: `1px solid ${stageFilter === s ? STAGE_COLORS[s] + '50' : 'var(--border)'}`,
                background: stageFilter === s ? STAGE_COLORS[s] + '18' : 'var(--card)',
                color: stageFilter === s ? STAGE_COLORS[s] : 'var(--text2)'
              }}>{STAGE_LABELS[s]} ({stageCounts[s]})</div>
            ))}
          </div>

          {/* Client filter + Sort */}
          <div style={{ padding: '0 16px 8px', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <select value={clientFilter} onChange={e => setClientFilter(e.target.value)} style={{
              background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8,
              padding: '4px 10px', fontSize: 11, color: clientFilter !== 'all' ? 'var(--primary)' : 'var(--text2)',
              outline: 'none', fontFamily: 'DM Sans', cursor: 'pointer', flex: 1, minWidth: 0
            }}>
              <option value="all">All Clients</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={{
              background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8,
              padding: '4px 10px', fontSize: 11, color: 'var(--text2)', outline: 'none',
              fontFamily: 'DM Sans', cursor: 'pointer'
            }}>
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="value_high">Highest value</option>
              <option value="value_low">Lowest value</option>
              <option value="client">By client</option>
            </select>
          </div>

          <div className="sec">
            {filtered.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">📋</div>
                <div className="empty-title">{search ? 'No matches' : 'No jobs yet'}</div>
                <div className="empty-sub">Tap + to create your first job</div>
              </div>
            ) : (
              filtered.map(job => (
                <div key={job.id} className="card" onClick={() => setDetailJobId(job.id)}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 700 }}>{job.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 3 }}>
                        {job.clients?.name || 'No client'} {job.site_address ? '· ' + job.site_address : ''}
                      </div>
                    </div>
                    <span className="badge" style={{ background: STAGE_COLORS[job.stage] + '18', color: STAGE_COLORS[job.stage] }}>
                      {STAGE_LABELS[job.stage]}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ fontSize: 11, color: 'var(--text3)' }}>{job.job_number}</span>
                    {job.estimated_value && (
                      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--primary)' }}>
                        ${parseFloat(job.estimated_value).toLocaleString()}
                      </span>
                    )}
                    {job.priority !== 'normal' && (
                      <span className="badge" style={{ background: PRIORITY_COLORS[job.priority] + '18', color: PRIORITY_COLORS[job.priority] }}>
                        {PRIORITY_LABELS[job.priority]}
                      </span>
                    )}
                    {job.is_recurring && (
                      <span className="badge purple">🔄 RECURRING</span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      ) : (
        /* Pipeline View */
        <div className="pipeline-container">
          {/* Stage stats */}
          <div className="pipeline-stats">
            {JOB_STAGES.map(stage => {
              const count = jobs.filter(j => j.stage === stage).length
              return (
                <div key={stage} className="pipeline-stat">
                  <div className="pipeline-stat-val" style={{ color: STAGE_COLORS[stage] }}>{count}</div>
                  <div className="pipeline-stat-lbl">{STAGE_LABELS[stage]}</div>
                </div>
              )
            })}
          </div>

          {/* Kanban */}
          <div className="kanban">
            {JOB_STAGES.map(stage => {
              const stageJobs = jobs.filter(j => j.stage === stage)
              const stageIdx = JOB_STAGES.indexOf(stage)
              return (
                <div key={stage} className="kanban-col">
                  <div className="kanban-col-header">
                    <div className="kanban-col-title">
                      <div className="kanban-col-dot" style={{ background: STAGE_COLORS[stage] }} />
                      {STAGE_LABELS[stage]}
                    </div>
                    <div className="kanban-col-count">{stageJobs.length}</div>
                  </div>
                  <div className="kanban-col-body">
                    {stageJobs.length === 0 ? (
                      <div className="kanban-empty">No jobs here</div>
                    ) : (
                      stageJobs.map(job => {
                        const today = new Date().toISOString().split('T')[0]
                        const hasReminder = job.reminder_date
                        const reminderOverdue = hasReminder && job.reminder_date <= today
                        const schedDate = job.scheduled_start ? new Date(job.scheduled_start).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }) : null

                        return (
                          <div key={job.id} className="kanban-card" onClick={() => setDetailJobId(job.id)}>
                            {/* Top bar — date/reminder + archive */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                                {schedDate && (
                                  <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--blue)', display: 'flex', alignItems: 'center', gap: 3 }}>
                                    📅 {schedDate}
                                  </span>
                                )}
                                {hasReminder && (
                                  <span style={{
                                    fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 3,
                                    color: reminderOverdue ? 'var(--red)' : 'var(--yellow)',
                                    background: reminderOverdue ? 'rgba(255,59,92,0.1)' : 'rgba(255,184,0,0.1)',
                                    padding: '2px 6px', borderRadius: 5
                                  }}>
                                    🔔 {job.reminder_date}
                                  </span>
                                )}
                                {job.priority !== 'normal' && (
                                  <span style={{
                                    fontSize: 9, fontWeight: 800, padding: '2px 5px', borderRadius: 4,
                                    background: PRIORITY_COLORS[job.priority] + '18', color: PRIORITY_COLORS[job.priority]
                                  }}>{PRIORITY_LABELS[job.priority].toUpperCase()}</span>
                                )}
                              </div>
                              {/* Archive button */}
                              <button onClick={e => { e.stopPropagation(); archiveJobFromKanban(job.id) }} style={{
                                background: 'none', border: 'none', color: 'var(--text3)',
                                cursor: 'pointer', fontSize: 14, padding: '0 2px', opacity: 0.6
                              }} title="Archive / Cancel">✕</button>
                            </div>

                            <div className="kanban-card-name">{job.name}</div>
                            <div className="kanban-card-client">{job.clients?.name || ''}</div>
                            {job.reminder_note && (
                              <div style={{ fontSize: 11, color: reminderOverdue ? 'var(--red)' : 'var(--yellow)', marginTop: 4, fontStyle: 'italic', lineHeight: 1.4 }}>
                                💬 {job.reminder_note}
                              </div>
                            )}
                            <div className="kanban-card-bottom">
                              <div className="kanban-card-value">
                                {job.estimated_value ? '$' + parseFloat(job.estimated_value).toLocaleString() : ''}
                              </div>
                              <div className="kanban-card-date">{job.job_number}</div>
                            </div>
                            <div className="kanban-card-actions" onClick={e => e.stopPropagation()}>
                              {stageIdx > 0 && (
                                <button className="kanban-move-btn" onClick={() => moveJob(job.id, JOB_STAGES[stageIdx - 1])}>
                                  ← {STAGE_LABELS[JOB_STAGES[stageIdx - 1]]}
                                </button>
                              )}
                              <button className="kanban-move-btn" onClick={() => openReminderModal(job)}
                                style={{ background: 'rgba(255,184,0,0.08)', color: 'var(--yellow)', border: '1px solid rgba(255,184,0,0.2)', flex: 'none', padding: '8px 10px' }}>
                                🔔
                              </button>
                              {stageIdx < JOB_STAGES.length - 1 && (
                                <button className="kanban-move-btn forward" onClick={() => moveJob(job.id, JOB_STAGES[stageIdx + 1])}>
                                  → {STAGE_LABELS[JOB_STAGES[stageIdx + 1]]}
                                </button>
                              )}
                            </div>
                          </div>
                        )
                      })
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* FAB (hide when tasks view is active — tasks has its own) */}
      {!['tasks', 'calendar', 'dispatch'].includes(view) && <button className="fab" onClick={openNew}>+</button>}

      {/* Modal */}
      {showModal && (
        <Modal title={editing ? 'Edit Job' : 'New Job'} onClose={() => { setShowModal(false); setShowAI(false) }}>
          {/* AI Assistant */}
          {!editing && !showAI && (
            <button onClick={() => setShowAI(true)} style={{
              width: '100%', padding: 12, marginBottom: 16, borderRadius: 12,
              background: 'linear-gradient(135deg, rgba(0,212,160,0.08), rgba(0,153,255,0.08))',
              border: '1px solid rgba(0,212,160,0.2)', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 10,
              fontFamily: 'DM Sans', fontSize: 13, fontWeight: 700, color: 'var(--primary)'
            }}>
              🤖 Use AI — paste a call, email, or notes to auto-fill
            </button>
          )}
          {showAI && (
            <AIJobAssistant
              onClose={() => setShowAI(false)}
              onResult={(data) => {
                if (data.name) updateForm('name', data.name)
                if (data.description) updateForm('description', data.description)
                if (data.notes) updateForm('notes', data.notes)
                if (data.job_type) updateForm('job_type', data.job_type)
                if (data.priority) updateForm('priority', data.priority)
                if (data.estimated_value) updateForm('estimated_value', data.estimated_value.toString())
                if (data.site_address) updateForm('site_address', data.site_address)
                if (data.site_city) updateForm('site_city', data.site_city)
                if (data.site_province_state) updateForm('site_province_state', data.site_province_state)
                if (data.insurance_company) updateForm('insurance_company', data.insurance_company)
                if (data.insurance_claim_number) updateForm('insurance_claim_number', data.insurance_claim_number)
                if (data.unit_numbers) updateForm('unit_numbers', data.unit_numbers)
                // Try to match client by name
                if (data.client_name) {
                  const match = clients.find(c => c.name.toLowerCase().includes(data.client_name.toLowerCase()))
                  if (match) updateForm('client_id', match.id)
                }
                setShowAI(false)
              }}
            />
          )}

          <div className="form-field">
            <label className="form-label">Job Name *</label>
            <input className="form-input" placeholder="e.g. Water Damage — 45 King St"
              value={form.name} onChange={e => updateForm('name', e.target.value)} />
          </div>

          <div className="form-field">
            <label className="form-label">Client *</label>
            <select className="form-input" value={form.client_id} onChange={e => {
              if (e.target.value === '__new__') {
                updateForm('client_id', '__new__')
              } else {
                updateForm('client_id', e.target.value)
              }
            }}>
              <option value="">Select client...</option>
              <option value="__new__">+ Create New Client</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          {form.client_id === '__new__' && (
            <div style={{ background: 'var(--bg2)', border: '1px solid rgba(0,212,160,0.2)', borderRadius: 14, padding: 14, marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--primary)', letterSpacing: 1, marginBottom: 10 }}>QUICK ADD CLIENT</div>
              <div className="form-field" style={{ marginBottom: 10 }}>
                <input className="form-input" placeholder="Client name *" id="quick-client-name" style={{ fontSize: 13, padding: '10px 14px' }} />
              </div>
              <div className="form-row" style={{ marginBottom: 0 }}>
                <div className="form-field" style={{ marginBottom: 0 }}>
                  <input className="form-input" placeholder="Phone" id="quick-client-phone" style={{ fontSize: 13, padding: '10px 14px' }} />
                </div>
                <div className="form-field" style={{ marginBottom: 0 }}>
                  <input className="form-input" placeholder="Email" id="quick-client-email" style={{ fontSize: 13, padding: '10px 14px' }} />
                </div>
              </div>
            </div>
          )}

          <div className="form-row">
            <div className="form-field">
              <label className="form-label">Stage</label>
              <select className="form-input" value={form.stage} onChange={e => updateForm('stage', e.target.value)}>
                {JOB_STAGES.map(s => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
              </select>
            </div>
            <div className="form-field">
              <label className="form-label">Priority</label>
              <select className="form-input" value={form.priority} onChange={e => updateForm('priority', e.target.value)}>
                {PRIORITIES.map(p => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
              </select>
            </div>
          </div>

          <div className="form-row">
            <div className="form-field">
              <label className="form-label">Job Type</label>
              <select className="form-input" value={form.job_type} onChange={e => updateForm('job_type', e.target.value)}>
                <option value="">Select type...</option>
                {JOB_TYPES.map(t => <option key={t} value={t}>{JOB_TYPE_LABELS[t]}</option>)}
              </select>
            </div>
            <div className="form-field">
              <label className="form-label">Estimated Value ($)</label>
              <input className="form-input" type="number" placeholder="0.00"
                value={form.estimated_value} onChange={e => updateForm('estimated_value', e.target.value)} />
            </div>
          </div>

          <div className="form-field">
            <label className="form-label">Site Address</label>
            <input className="form-input" placeholder="Street address"
              value={form.site_address} onChange={e => updateForm('site_address', e.target.value)} />
          </div>

          <div className="form-row">
            <div className="form-field">
              <label className="form-label">City</label>
              <input className="form-input" placeholder="City"
                value={form.site_city} onChange={e => updateForm('site_city', e.target.value)} />
            </div>
            <div className="form-field">
              <label className="form-label">Province/State</label>
              <input className="form-input" placeholder="ON"
                value={form.site_province_state} onChange={e => updateForm('site_province_state', e.target.value)} />
            </div>
          </div>

          <div className="form-row">
            <div className="form-field">
              <label className="form-label">Scheduled Start</label>
              <input className="form-input" type="datetime-local"
                value={form.scheduled_start} onChange={e => updateForm('scheduled_start', e.target.value)} />
            </div>
            <div className="form-field">
              <label className="form-label">Scheduled End</label>
              <input className="form-input" type="datetime-local"
                value={form.scheduled_end} onChange={e => updateForm('scheduled_end', e.target.value)} />
            </div>
          </div>

          <div className="form-field">
            <label className="form-label">Unit Numbers</label>
            <input className="form-input" placeholder="e.g. 820, 416, 1003, 310, 813"
              value={form.unit_numbers} onChange={e => updateForm('unit_numbers', e.target.value)} />
            <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 3 }}>Comma-separated unit/apartment numbers</div>
          </div>

          <div className="form-row">
            <div className="form-field">
              <label className="form-label">Insurance Company</label>
              <input className="form-input" placeholder="Optional"
                value={form.insurance_company} onChange={e => updateForm('insurance_company', e.target.value)} />
            </div>
            <div className="form-field">
              <label className="form-label">Claim #</label>
              <input className="form-input" placeholder="Optional"
                value={form.insurance_claim_number} onChange={e => updateForm('insurance_claim_number', e.target.value)} />
            </div>
          </div>

          {/* Recurring */}
          <div style={{
            background: form.is_recurring ? 'rgba(0,212,160,0.04)' : 'var(--bg2)',
            border: `1px solid ${form.is_recurring ? 'rgba(0,212,160,0.2)' : 'var(--border)'}`,
            borderRadius: 14, padding: 14, marginBottom: 16
          }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', marginBottom: form.is_recurring ? 12 : 0 }}>
              <input type="checkbox" checked={form.is_recurring}
                onChange={e => updateForm('is_recurring', e.target.checked)} />
              <span style={{ fontSize: 13, fontWeight: 700, color: form.is_recurring ? 'var(--primary)' : 'var(--text2)' }}>
                Recurring Job
              </span>
              <span style={{ fontSize: 11, color: 'var(--text3)' }}>Weekly cleaning, monthly maintenance, etc.</span>
            </label>
            {form.is_recurring && (
              <div className="form-row" style={{ marginBottom: 0 }}>
                <div className="form-field" style={{ marginBottom: 0 }}>
                  <label className="form-label">Frequency</label>
                  <select className="form-input" value={form.recurrence_frequency}
                    onChange={e => updateForm('recurrence_frequency', e.target.value)}>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="biweekly">Every 2 Weeks</option>
                    <option value="monthly">Monthly</option>
                    <option value="quarterly">Quarterly</option>
                  </select>
                </div>
                <div className="form-field" style={{ marginBottom: 0 }}>
                  <label className="form-label">Every X occurrences</label>
                  <input className="form-input" type="number" min="1" value={form.recurrence_interval}
                    onChange={e => updateForm('recurrence_interval', e.target.value)} />
                </div>
              </div>
            )}
          </div>

          <div className="form-field">
            <label className="form-label">Description</label>
            <textarea className="form-input" placeholder="Scope of work, details..."
              value={form.description} onChange={e => updateForm('description', e.target.value)} />
          </div>

          <div className="form-field">
            <label className="form-label">Notes</label>
            <textarea className="form-input" placeholder="Internal notes..."
              value={form.notes} onChange={e => updateForm('notes', e.target.value)} />
          </div>

          {/* Worker Assignment (only when editing) */}
          {editing && (
            <div style={{ marginTop: 16, marginBottom: 16 }}>
              <label className="form-label">ASSIGNED WORKERS</label>
              {assignedWorkers.length > 0 && (
                <div style={{ marginBottom: 10 }}>
                  {assignedWorkers.map(aw => (
                    <div key={aw.id} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 12,
                      padding: '10px 14px', marginBottom: 6
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{
                          width: 32, height: 32, borderRadius: 10, flexShrink: 0,
                          background: 'linear-gradient(135deg, var(--primary), var(--primary2))',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 12, fontWeight: 800, color: '#000'
                        }}>
                          {aw.workers?.first_name?.charAt(0)}{aw.workers?.last_name?.charAt(0)}
                        </div>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 700 }}>
                            {aw.workers?.first_name} {aw.workers?.last_name}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text3)' }}>{aw.role_on_job}</div>
                        </div>
                      </div>
                      <button onClick={() => removeWorker(aw.id)} style={{
                        background: 'none', border: 'none', color: 'var(--red)',
                        cursor: 'pointer', fontSize: 16, padding: '0 4px'
                      }}>×</button>
                    </div>
                  ))}
                </div>
              )}
              <select className="form-input" value="" onChange={e => { if (e.target.value) assignWorker(e.target.value) }}
                style={{ fontSize: 13 }}>
                <option value="">+ Assign a worker...</option>
                {workers
                  .filter(w => !assignedWorkers.find(aw => aw.worker_id === w.id))
                  .map(w => <option key={w.id} value={w.id}>{w.first_name} {w.last_name} — {w.role}</option>)
                }
              </select>
            </div>
          )}

          <button className="btn btn-primary btn-full" onClick={saveJob}>
            {editing ? 'Update Job' : 'Create Job'}
          </button>
          {editing && (
            <button className="btn btn-danger btn-full" style={{ marginTop: 8 }} onClick={archiveJob}>
              Archive Job
            </button>
          )}
          <button className="btn btn-secondary btn-full" style={{ marginTop: 8 }} onClick={() => setShowModal(false)}>
            Cancel
          </button>
        </Modal>
      )}

      {/* Reminder Modal */}
      {showReminderModal && reminderJob && (
        <Modal title="Set Reminder" onClose={() => setShowReminderModal(false)}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{reminderJob.name}</div>
          <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 16 }}>{reminderJob.job_number} · {reminderJob.clients?.name}</div>

          <div className="form-field">
            <label className="form-label">Reminder Date</label>
            <input className="form-input" type="date" value={reminderDate} max="2099-12-31"
              onChange={e => setReminderDate(e.target.value)} />
          </div>

          <div className="form-field">
            <label className="form-label">Reminder Note</label>
            <textarea className="form-input" value={reminderNote}
              onChange={e => setReminderNote(e.target.value)}
              placeholder="e.g. Follow up with client on flooring selection&#10;e.g. Confirm start date with crew&#10;e.g. Client needs to approve quote by this date" />
          </div>

          <button className="btn btn-primary btn-full" onClick={saveReminder}>
            {reminderDate ? '🔔 Set Reminder' : 'Save Note'}
          </button>
          {(reminderJob.reminder_date || reminderJob.reminder_note) && (
            <button className="btn btn-danger btn-full" style={{ marginTop: 8 }} onClick={clearReminder}>
              Clear Reminder
            </button>
          )}
          <button className="btn btn-secondary btn-full" style={{ marginTop: 8 }} onClick={() => setShowReminderModal(false)}>
            Cancel
          </button>
        </Modal>
      )}
    </div>
  )
}

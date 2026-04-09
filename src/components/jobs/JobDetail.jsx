import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useToast } from '../shared/Toast'
import Modal from '../shared/Modal'
import { STAGE_LABELS, STAGE_COLORS, JOB_STAGES, PRIORITY_LABELS, PRIORITY_COLORS, JOB_TYPE_LABELS, JOB_TYPES, PRIORITIES } from '../../lib/constants'
import FileUpload from '../shared/FileUpload'
import JobChecklist from './JobChecklist'

export default function JobDetail({ jobId, onBack }) {
  const { companyId, profile } = useAuth()
  const showToast = useToast()
  const [job, setJob] = useState(null)
  const [assignedWorkers, setAssignedWorkers] = useState([])
  const [allWorkers, setAllWorkers] = useState([])
  const [timeEntries, setTimeEntries] = useState([])
  const [tasks, setTasks] = useState([])
  const [invoices, setInvoices] = useState([])
  const [activity, setActivity] = useState([])
  const [loading, setLoading] = useState(true)
  const [showNoteModal, setShowNoteModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [noteText, setNoteText] = useState('')
  const [activeSection, setActiveSection] = useState('overview')
  const [editForm, setEditForm] = useState({})

  useEffect(() => { if (jobId) loadAll() }, [jobId])

  async function loadAll() {
    const [jobRes, workersRes, allWRes, timeRes, tasksRes, invRes, actRes] = await Promise.all([
      supabase.from('jobs').select('*, clients(name, contact_phone, contact_email)').eq('id', jobId).single(),
      supabase.from('job_workers').select('*, workers(first_name, last_name, role, hourly_rate)').eq('job_id', jobId).is('removed_at', null),
      supabase.from('workers').select('id, first_name, last_name, role').eq('company_id', companyId).is('archived_at', null),
      supabase.from('time_entries').select('*, workers(first_name, last_name)').eq('job_id', jobId).order('date', { ascending: false }),
      supabase.from('tasks').select('*').eq('job_id', jobId).order('sort_order'),
      supabase.from('invoices').select('id, invoice_number, total, status, due_date').eq('job_id', jobId).is('archived_at', null),
      supabase.from('job_activity').select('*').eq('job_id', jobId).order('created_at', { ascending: false }).limit(30)
    ])
    setJob(jobRes.data)
    setAssignedWorkers(workersRes.data || [])
    setAllWorkers(allWRes.data || [])
    setTimeEntries(timeRes.data || [])
    setTasks(tasksRes.data || [])
    setInvoices(invRes.data || [])
    // Generate signed URLs for files
    const activityData = actRes.data || []
    for (const a of activityData) {
      if (a.file_url && !a.file_url.startsWith('http')) {
        const { data: signedData } = await supabase.storage.from('documents')
          .createSignedUrl(a.file_url, 3600) // 1 hour expiry
        if (signedData) a.signed_url = signedData.signedUrl
      }
    }
    setActivity(activityData)
    setLoading(false)
  }

  async function moveStage(newStage) {
    await supabase.from('jobs').update({
      stage: newStage, stage_changed_at: new Date().toISOString(), updated_at: new Date().toISOString()
    }).eq('id', jobId)
    // Log activity
    await supabase.from('job_activity').insert({
      company_id: companyId, job_id: jobId, author_id: profile?.id,
      type: 'status_change', content: `Stage changed to ${STAGE_LABELS[newStage]}`,
      metadata: { new_stage: newStage, old_stage: job.stage }
    })
    showToast('Moved to ' + STAGE_LABELS[newStage])
    loadAll()
  }

  async function assignWorker(workerId) {
    const exists = assignedWorkers.find(aw => aw.worker_id === workerId)
    if (exists) return
    await supabase.from('job_workers').insert({
      company_id: companyId, job_id: jobId, worker_id: workerId, role_on_job: 'crew'
    })
    const w = allWorkers.find(w => w.id === workerId)
    await supabase.from('job_activity').insert({
      company_id: companyId, job_id: jobId, author_id: profile?.id,
      type: 'note', content: `Assigned ${w?.first_name} ${w?.last_name} to this job`
    })
    showToast('Worker assigned')
    loadAll()
  }

  async function removeWorker(jwId) {
    await supabase.from('job_workers').update({ removed_at: new Date().toISOString() }).eq('id', jwId)
    loadAll()
  }

  async function addNote() {
    if (!noteText.trim()) return
    await supabase.from('job_activity').insert({
      company_id: companyId, job_id: jobId, author_id: profile?.id,
      type: 'note', content: noteText.trim()
    })
    showToast('Note added')
    setNoteText('')
    setShowNoteModal(false)
    loadAll()
  }

  function openEditJob() {
    setEditForm({
      name: job.name || '', description: job.description || '',
      stage: job.stage || 'lead', priority: job.priority || 'normal',
      job_type: job.job_type || '', estimated_value: job.estimated_value || '',
      site_address: job.site_address || '', site_city: job.site_city || '',
      site_province_state: job.site_province_state || '',
      scheduled_start: job.scheduled_start ? job.scheduled_start.slice(0, 16) : '',
      scheduled_end: job.scheduled_end ? job.scheduled_end.slice(0, 16) : '',
      insurance_claim_number: job.insurance_claim_number || '',
      insurance_company: job.insurance_company || '',
      unit_numbers: job.unit_numbers || '',
      notes: job.notes || ''
    })
    setShowEditModal(true)
  }

  async function saveEditJob() {
    if (!editForm.name.trim()) { showToast('Job name required'); return }
    const { error } = await supabase.from('jobs').update({
      ...editForm,
      estimated_value: editForm.estimated_value ? parseFloat(editForm.estimated_value) : null,
      scheduled_start: editForm.scheduled_start || null,
      scheduled_end: editForm.scheduled_end || null,
      updated_at: new Date().toISOString()
    }).eq('id', jobId)
    if (error) { showToast('Error saving'); console.error(error); return }
    showToast('Job updated')
    setShowEditModal(false)
    loadAll()
  }

  async function archiveJob() {
    if (!confirm('Archive this job?')) return
    await supabase.from('jobs').update({ archived_at: new Date().toISOString() }).eq('id', jobId)
    showToast('Job archived')
    onBack()
  }

  function updateEdit(f, v) { setEditForm(prev => ({ ...prev, [f]: v })) }

  async function generateInvoiceFromJob() {
    if (!job || timeEntries.length === 0) return
    if (!confirm(`Generate invoice from ${timeEntries.length} time entries ($${totalLabor.toFixed(2)})?`)) return

    // Get company settings for tax
    const { data: comp } = await supabase.from('companies').select('settings').eq('id', companyId).single()
    const settings = comp?.settings || {}
    const rate1 = settings.tax_rate_1 || 0
    const rate2 = settings.tax_rate_2 || 0
    const dueDate = new Date(Date.now() + (settings.default_payment_terms_days || 30) * 86400000).toISOString().split('T')[0]

    // Generate invoice number
    const { data: invNum } = await supabase.rpc('generate_invoice_number', { p_company_id: companyId })

    // Group time entries by worker
    const byWorker = {}
    timeEntries.forEach(e => {
      const name = e.workers ? `${e.workers.first_name} ${e.workers.last_name}` : 'Labor'
      if (!byWorker[name]) byWorker[name] = { hours: 0, rate: 0 }
      byWorker[name].hours += parseFloat(e.total_hours || 0)
      byWorker[name].rate = parseFloat(e.hourly_rate_at_time || 0)
    })

    // Create line items from grouped entries
    const lines = Object.entries(byWorker).map(([name, { hours, rate }]) => ({
      line_type: 'service',
      description: `Labor — ${name} (${hours.toFixed(1)} hrs @ $${rate.toFixed(2)}/hr)`,
      quantity: hours,
      unit: 'hour',
      unit_price: rate,
      amount: hours * rate,
      taxable: true
    }))

    const subtotal = lines.reduce((s, l) => s + l.amount, 0)
    const tax1 = subtotal * rate1
    const tax2 = rate2 ? subtotal * rate2 : 0
    const total = subtotal + tax1 + tax2

    // Create invoice
    const { data: inv, error } = await supabase.from('invoices').insert({
      company_id: companyId,
      client_id: job.client_id,
      job_id: jobId,
      invoice_number: invNum || ('INV-' + Date.now()),
      status: 'draft',
      issue_date: new Date().toISOString().split('T')[0],
      due_date: dueDate,
      currency: settings.currency || 'CAD',
      subtotal, total, amount_due: total,
      tax1_label: settings.tax_label_1, tax1_rate: rate1, tax1_amount: tax1,
      tax2_label: settings.tax_label_2, tax2_rate: rate2, tax2_amount: tax2
    }).select().single()

    if (error || !inv) { showToast('Error creating invoice'); console.error(error); return }

    // Create line items
    await supabase.from('invoice_lines').insert(
      lines.map((l, i) => ({ ...l, invoice_id: inv.id, company_id: companyId, sort_order: i }))
    )

    // Log activity
    await supabase.from('job_activity').insert({
      company_id: companyId, job_id: jobId, author_id: profile?.id,
      type: 'note', content: `Invoice ${inv.invoice_number} generated — $${total.toFixed(2)}`
    })

    showToast(`Invoice ${inv.invoice_number} created — $${total.toFixed(2)}`)
    loadAll()
  }

  async function toggleTask(task) {
    const newStatus = task.status === 'done' ? 'todo' : 'done'
    await supabase.from('tasks').update({
      status: newStatus, completed_at: newStatus === 'done' ? new Date().toISOString() : null
    }).eq('id', task.id)
    loadAll()
  }

  if (loading) return <div className="loading-center"><div className="spinner" /></div>
  if (!job) return <div className="empty-state"><div className="empty-title">Job not found</div></div>

  const stageIdx = JOB_STAGES.indexOf(job.stage)
  const totalHours = timeEntries.reduce((s, e) => s + (parseFloat(e.total_hours) || 0), 0)
  const totalLabor = timeEntries.reduce((s, e) => s + ((parseFloat(e.total_hours) || 0) * (parseFloat(e.hourly_rate_at_time) || 0)), 0)
  const totalInvoiced = invoices.reduce((s, i) => s + (parseFloat(i.total) || 0), 0)

  const sections = [
    { id: 'overview', label: 'Overview' },
    { id: 'crew', label: `Crew (${assignedWorkers.length})` },
    { id: 'tasks', label: `Tasks (${tasks.length})` },
    { id: 'time', label: `Time (${timeEntries.length})` },
    { id: 'billing', label: `Billing (${invoices.length})` },
    { id: 'checklist', label: `Checklist (${(job.checklist || []).filter(i => i.done).length}/${(job.checklist || []).length})` },
    { id: 'activity', label: 'Activity' },
  ]

  return (
    <div>
      {/* Header */}
      <div style={{ padding: '16px 16px 0', display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={onBack} style={{
          background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10,
          width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', fontSize: 18, color: 'var(--text2)'
        }}>←</button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 700, letterSpacing: 1 }}>{job.job_number}</div>
          <div style={{ fontSize: 18, fontWeight: 800 }}>{job.name}</div>
        </div>
        <button onClick={openEditJob} style={{
          background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10,
          width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', fontSize: 16, color: 'var(--text2)'
        }}>✏️</button>
        <span className="badge" style={{
          background: STAGE_COLORS[job.stage] + '18', color: STAGE_COLORS[job.stage], fontSize: 11, padding: '6px 12px'
        }}>{STAGE_LABELS[job.stage]}</span>
      </div>

      {/* Stage Progress */}
      <div style={{ display: 'flex', gap: 3, padding: '12px 16px 0' }}>
        {JOB_STAGES.map((s, i) => (
          <div key={s} onClick={() => moveStage(s)} style={{
            flex: 1, height: 4, borderRadius: 2, cursor: 'pointer',
            background: i <= stageIdx ? STAGE_COLORS[job.stage] : 'var(--border2)',
            transition: 'background 0.2s'
          }} title={STAGE_LABELS[s]} />
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 16px 8px', fontSize: 9, color: 'var(--text3)', letterSpacing: 0.5 }}>
        <span>Lead</span><span>Closed</span>
      </div>

      {/* Client + Job Info */}
      <div style={{ padding: '0 16px 8px' }}>
        <div className="card" style={{ cursor: 'default' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{job.clients?.name || 'No client'}</div>
              {job.clients?.contact_phone && <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>{job.clients.contact_phone}</div>}
              {job.site_address && <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 4 }}>📍 {job.site_address}{job.site_city ? ', ' + job.site_city : ''}</div>}
            </div>
            <div style={{ textAlign: 'right' }}>
              {job.estimated_value && <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--primary)' }}>${parseFloat(job.estimated_value).toLocaleString()}</div>}
              {job.job_type && <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>{JOB_TYPE_LABELS[job.job_type] || job.job_type}</div>}
            </div>
          </div>
          {job.priority !== 'normal' && (
            <span className="badge" style={{ background: PRIORITY_COLORS[job.priority] + '18', color: PRIORITY_COLORS[job.priority], marginTop: 8, display: 'inline-flex' }}>
              {PRIORITY_LABELS[job.priority]}
            </span>
          )}
        </div>
      </div>

      {/* Quick Stats */}
      <div style={{ display: 'flex', gap: 8, padding: '0 16px 8px' }}>
        <div style={{ flex: 1, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: '12px', textAlign: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--primary)' }}>{totalHours.toFixed(1)}h</div>
          <div style={{ fontSize: 9, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 }}>Hours</div>
        </div>
        <div style={{ flex: 1, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: '12px', textAlign: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--blue)' }}>${totalLabor.toFixed(0)}</div>
          <div style={{ fontSize: 9, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 }}>Labor Cost</div>
        </div>
        <div style={{ flex: 1, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: '12px', textAlign: 'center' }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--yellow)' }}>${totalInvoiced.toFixed(0)}</div>
          <div style={{ fontSize: 9, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 }}>Invoiced</div>
        </div>
      </div>

      {/* Section Tabs */}
      <div style={{ display: 'flex', gap: 6, padding: '8px 16px', overflowX: 'auto', scrollbarWidth: 'none' }}>
        {sections.map(s => (
          <div key={s.id} onClick={() => setActiveSection(s.id)} style={{
            padding: '6px 12px', borderRadius: 10, fontSize: 11, fontWeight: 700,
            cursor: 'pointer', whiteSpace: 'nowrap',
            border: `1px solid ${activeSection === s.id ? 'rgba(0,212,160,0.3)' : 'var(--border)'}`,
            background: activeSection === s.id ? 'rgba(0,212,160,0.1)' : 'var(--card)',
            color: activeSection === s.id ? 'var(--primary)' : 'var(--text2)'
          }}>
            {s.label}
          </div>
        ))}
      </div>

      {/* Section Content */}
      <div className="sec" style={{ marginTop: 4 }}>

        {/* OVERVIEW */}
        {activeSection === 'overview' && (
          <div>
            {job.unit_numbers && (
              <div className="card" style={{ cursor: 'default', borderLeft: '3px solid var(--blue)' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 }}>Units</div>
                <div style={{ fontSize: 13, color: 'var(--text)', fontWeight: 600 }}>{job.unit_numbers}</div>
              </div>
            )}
            {job.description && (
              <div className="card" style={{ cursor: 'default' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 }}>Scope</div>
                <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.6 }}>{job.description}</div>
              </div>
            )}
            {(job.insurance_company || job.insurance_claim_number) && (
              <div className="card" style={{ cursor: 'default', borderLeft: '3px solid var(--purple)' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 }}>Insurance</div>
                {job.insurance_company && <div style={{ fontSize: 13, color: 'var(--text2)' }}>{job.insurance_company}</div>}
                {job.insurance_claim_number && <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>Claim #{job.insurance_claim_number}</div>}
                {job.insurance_deductible && <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>Deductible: ${job.insurance_deductible}</div>}
              </div>
            )}
            {job.scheduled_start && (
              <div className="card" style={{ cursor: 'default' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 }}>Schedule</div>
                <div style={{ fontSize: 13, color: 'var(--text2)' }}>
                  Start: {new Date(job.scheduled_start).toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </div>
                {job.scheduled_end && (
                  <div style={{ fontSize: 13, color: 'var(--text2)', marginTop: 2 }}>
                    End: {new Date(job.scheduled_end).toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </div>
                )}
              </div>
            )}
            {job.notes && (
              <div className="card" style={{ cursor: 'default' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 }}>Notes</div>
                <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{job.notes}</div>
              </div>
            )}
          </div>
        )}

        {/* CREW */}
        {activeSection === 'crew' && (
          <div>
            {assignedWorkers.map(aw => (
              <div key={aw.id} className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{
                    width: 38, height: 38, borderRadius: 12,
                    background: 'linear-gradient(135deg, var(--primary), var(--primary2))',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 13, fontWeight: 800, color: '#000'
                  }}>{aw.workers?.first_name?.charAt(0)}{aw.workers?.last_name?.charAt(0)}</div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>{aw.workers?.first_name} {aw.workers?.last_name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text3)' }}>{aw.role_on_job} · {aw.workers?.role}</div>
                  </div>
                </div>
                <button onClick={(e) => { e.stopPropagation(); removeWorker(aw.id) }} style={{
                  background: 'rgba(255,59,92,0.08)', border: '1px solid rgba(255,59,92,0.2)',
                  borderRadius: 8, padding: '4px 10px', color: 'var(--red)', fontSize: 11,
                  fontWeight: 700, cursor: 'pointer', fontFamily: 'DM Sans'
                }}>Remove</button>
              </div>
            ))}
            <select className="form-input" value="" onChange={e => { if (e.target.value) assignWorker(e.target.value) }}
              style={{ marginTop: 8 }}>
              <option value="">+ Assign worker...</option>
              {allWorkers.filter(w => !assignedWorkers.find(aw => aw.worker_id === w.id))
                .map(w => <option key={w.id} value={w.id}>{w.first_name} {w.last_name}</option>)}
            </select>
          </div>
        )}

        {/* TASKS */}
        {activeSection === 'tasks' && (
          <div>
            {tasks.length === 0 ? (
              <div style={{ color: 'var(--text3)', fontSize: 13, padding: 16, textAlign: 'center' }}>No tasks for this job</div>
            ) : tasks.map(t => (
              <div key={t.id} className="card" style={{ display: 'flex', gap: 12, alignItems: 'flex-start', opacity: t.status === 'done' ? 0.45 : 1 }}>
                <div onClick={() => toggleTask(t)} style={{
                  width: 22, height: 22, borderRadius: '50%', flexShrink: 0, marginTop: 1,
                  border: `2px solid ${t.status === 'done' ? 'var(--primary)' : 'var(--text3)'}`,
                  background: t.status === 'done' ? 'var(--primary)' : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer', fontSize: 12, color: t.status === 'done' ? '#000' : 'transparent'
                }}>{t.status === 'done' ? '✓' : ''}</div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, textDecoration: t.status === 'done' ? 'line-through' : 'none' }}>{t.title}</div>
                  {t.due_date && <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 3 }}>📅 {t.due_date}</div>}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* TIME */}
        {activeSection === 'time' && (
          <div>
            {timeEntries.length === 0 ? (
              <div style={{ color: 'var(--text3)', fontSize: 13, padding: 16, textAlign: 'center' }}>No time entries for this job</div>
            ) : timeEntries.map(e => (
              <div key={e.id} className="card" style={{ cursor: 'default' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>{e.workers?.first_name} {e.workers?.last_name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>{e.date}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--primary)' }}>{parseFloat(e.total_hours || 0).toFixed(1)}h</div>
                    {e.hourly_rate_at_time && <div style={{ fontSize: 11, color: 'var(--text3)' }}>${(parseFloat(e.total_hours || 0) * parseFloat(e.hourly_rate_at_time)).toFixed(2)}</div>}
                  </div>
                </div>
                {e.description && <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 6 }}>{e.description}</div>}
              </div>
            ))}
          </div>
        )}

        {/* BILLING */}
        {activeSection === 'checklist' && (
          <JobChecklist jobId={jobId} checklist={job.checklist || []} onUpdate={() => loadAll()} />
        )}

        {activeSection === 'billing' && (
          <div>
            {/* Generate Invoice from Time Entries */}
            {timeEntries.length > 0 && (
              <button className="btn btn-primary btn-full" style={{ marginBottom: 12 }}
                onClick={generateInvoiceFromJob}>
                💰 Generate Invoice from Time Entries ({totalHours.toFixed(1)}h · ${totalLabor.toFixed(2)})
              </button>
            )}
            {invoices.length === 0 && timeEntries.length === 0 ? (
              <div style={{ color: 'var(--text3)', fontSize: 13, padding: 16, textAlign: 'center' }}>No invoices or time entries for this job</div>
            ) : invoices.length === 0 ? null : invoices.map(inv => (
              <div key={inv.id} className="card" style={{ cursor: 'default' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>{inv.invoice_number}</div>
                    <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>Due {inv.due_date || '—'}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 18, fontWeight: 800 }}>${parseFloat(inv.total || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
                    <span className="badge" style={{
                      background: (inv.status === 'paid' ? 'var(--green)' : inv.status === 'overdue' ? 'var(--red)' : 'var(--blue)') + '18',
                      color: inv.status === 'paid' ? 'var(--green)' : inv.status === 'overdue' ? 'var(--red)' : 'var(--blue)',
                      marginTop: 4, display: 'inline-flex'
                    }}>{inv.status.toUpperCase()}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ACTIVITY */}
        {activeSection === 'activity' && (
          <div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <button className="btn btn-secondary" style={{ flex: 1, fontSize: 13 }}
                onClick={() => setShowNoteModal(true)}>📝 Note</button>
            </div>
            <FileUpload jobId={jobId} onUpload={loadAll} />
            {activity.length === 0 ? (
              <div style={{ color: 'var(--text3)', fontSize: 13, padding: 16, textAlign: 'center' }}>No activity yet</div>
            ) : activity.map(a => (
              <div key={a.id} style={{
                padding: '12px 0', borderBottom: '1px solid var(--border)',
                display: 'flex', gap: 10
              }}>
                <div style={{
                  width: 28, height: 28, borderRadius: 8, flexShrink: 0,
                  background: a.type === 'status_change' ? 'rgba(33,150,243,0.1)' :
                    a.type === 'photo' ? 'rgba(139,92,246,0.1)' :
                    a.type === 'document' ? 'rgba(255,184,0,0.1)' : 'rgba(0,212,160,0.1)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13
                }}>
                  {a.type === 'status_change' ? '🔄' : a.type === 'photo' ? '📷' : a.type === 'document' ? '📎' : a.type === 'call' ? '📞' : '📝'}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.5 }}>{a.content}</div>
                  {a.signed_url && a.type === 'photo' && (
                    <img src={a.signed_url} alt={a.file_name || 'Photo'} style={{
                      maxWidth: '100%', maxHeight: 200, borderRadius: 10, marginTop: 8,
                      border: '1px solid var(--border)', cursor: 'pointer'
                    }} onClick={() => window.open(a.signed_url, '_blank')} />
                  )}
                  {a.signed_url && a.type === 'document' && (
                    <a href={a.signed_url} target="_blank" rel="noopener noreferrer" style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 6,
                      padding: '6px 12px', background: 'var(--bg2)', border: '1px solid var(--border)',
                      borderRadius: 8, fontSize: 12, color: 'var(--primary)', fontWeight: 600, textDecoration: 'none'
                    }}>📄 {a.file_name || 'Download'}</a>
                  )}
                  <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 4 }}>
                    {new Date(a.created_at).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Note Modal */}
      {showNoteModal && (
        <Modal title="Add Note" onClose={() => setShowNoteModal(false)}>
          <div className="form-field">
            <label className="form-label">Note</label>
            <textarea className="form-input" placeholder="What happened on this job..."
              value={noteText} onChange={e => setNoteText(e.target.value)} style={{ minHeight: 120 }} />
          </div>
          <button className="btn btn-primary btn-full" onClick={addNote}>Save Note</button>
          <button className="btn btn-secondary btn-full" style={{ marginTop: 8 }} onClick={() => setShowNoteModal(false)}>Cancel</button>
        </Modal>
      )}

      {/* Edit Job Modal */}
      {showEditModal && (
        <Modal title="Edit Job" onClose={() => setShowEditModal(false)}>
          <div className="form-field">
            <label className="form-label">Job Name *</label>
            <input className="form-input" value={editForm.name} onChange={e => updateEdit('name', e.target.value)} />
          </div>
          <div className="form-row">
            <div className="form-field">
              <label className="form-label">Stage</label>
              <select className="form-input" value={editForm.stage} onChange={e => updateEdit('stage', e.target.value)}>
                {JOB_STAGES.map(s => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
              </select>
            </div>
            <div className="form-field">
              <label className="form-label">Priority</label>
              <select className="form-input" value={editForm.priority} onChange={e => updateEdit('priority', e.target.value)}>
                {PRIORITIES.map(p => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
              </select>
            </div>
          </div>
          <div className="form-row">
            <div className="form-field">
              <label className="form-label">Job Type</label>
              <select className="form-input" value={editForm.job_type} onChange={e => updateEdit('job_type', e.target.value)}>
                <option value="">Select...</option>
                {JOB_TYPES.map(t => <option key={t} value={t}>{JOB_TYPE_LABELS[t]}</option>)}
              </select>
            </div>
            <div className="form-field">
              <label className="form-label">Est. Value ($)</label>
              <input className="form-input" type="number" value={editForm.estimated_value} onChange={e => updateEdit('estimated_value', e.target.value)} />
            </div>
          </div>
          <div className="form-field">
            <label className="form-label">Site Address</label>
            <input className="form-input" value={editForm.site_address} onChange={e => updateEdit('site_address', e.target.value)} />
          </div>
          <div className="form-row">
            <div className="form-field">
              <label className="form-label">City</label>
              <input className="form-input" value={editForm.site_city} onChange={e => updateEdit('site_city', e.target.value)} />
            </div>
            <div className="form-field">
              <label className="form-label">Province</label>
              <input className="form-input" value={editForm.site_province_state} onChange={e => updateEdit('site_province_state', e.target.value)} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-field">
              <label className="form-label">Start</label>
              <input className="form-input" type="datetime-local" value={editForm.scheduled_start} onChange={e => updateEdit('scheduled_start', e.target.value)} />
            </div>
            <div className="form-field">
              <label className="form-label">End</label>
              <input className="form-input" type="datetime-local" value={editForm.scheduled_end} onChange={e => updateEdit('scheduled_end', e.target.value)} />
            </div>
          </div>
          <div className="form-field">
            <label className="form-label">Unit Numbers</label>
            <input className="form-input" placeholder="e.g. 820, 416, 1003" value={editForm.unit_numbers || ''} onChange={e => updateEdit('unit_numbers', e.target.value)} />
          </div>
          <div className="form-row">
            <div className="form-field">
              <label className="form-label">Insurance Co.</label>
              <input className="form-input" value={editForm.insurance_company} onChange={e => updateEdit('insurance_company', e.target.value)} />
            </div>
            <div className="form-field">
              <label className="form-label">Claim #</label>
              <input className="form-input" value={editForm.insurance_claim_number} onChange={e => updateEdit('insurance_claim_number', e.target.value)} />
            </div>
          </div>
          <div className="form-field">
            <label className="form-label">Description</label>
            <textarea className="form-input" value={editForm.description} onChange={e => updateEdit('description', e.target.value)} />
          </div>
          <div className="form-field">
            <label className="form-label">Notes</label>
            <textarea className="form-input" value={editForm.notes} onChange={e => updateEdit('notes', e.target.value)} />
          </div>
          <button className="btn btn-primary btn-full" onClick={saveEditJob}>Update Job</button>
          <button className="btn btn-danger btn-full" style={{ marginTop: 8 }} onClick={archiveJob}>Archive Job</button>
          <button className="btn btn-secondary btn-full" style={{ marginTop: 8 }} onClick={() => setShowEditModal(false)}>Cancel</button>
        </Modal>
      )}
    </div>
  )
}

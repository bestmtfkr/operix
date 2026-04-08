import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useToast } from '../shared/Toast'
import Modal from '../shared/Modal'

const PRIORITY_COLORS = { urgent: '#FF3B5C', high: '#FF6B35', normal: '#2196F3', low: '#3D4A5C' }
const PRIORITY_LABELS = { urgent: 'Urgent', high: 'High', normal: 'Normal', low: 'Low' }

export default function TasksList() {
  const { companyId, profile } = useAuth()
  const showToast = useToast()
  const [tasks, setTasks] = useState([])
  const [jobs, setJobs] = useState([])
  const [workers, setWorkers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [filter, setFilter] = useState('active')

  const [form, setForm] = useState({
    title: '', description: '', priority: 'normal', status: 'todo',
    due_date: '', due_time: '', job_id: '', assigned_to: ''
  })

  useEffect(() => {
    if (companyId) { loadTasks(); loadJobs(); loadWorkers() }
  }, [companyId])

  async function loadTasks() {
    const { data } = await supabase
      .from('tasks')
      .select('*, jobs(name, job_number), workers:assigned_to(first_name, last_name)')
      .eq('company_id', companyId)
      .order('sort_order')
      .order('created_at', { ascending: false })
    setTasks(data || [])
    setLoading(false)
  }

  async function loadJobs() {
    const { data } = await supabase.from('jobs').select('id, name, job_number')
      .eq('company_id', companyId).is('archived_at', null).order('created_at', { ascending: false })
    setJobs(data || [])
  }

  async function loadWorkers() {
    const { data } = await supabase.from('workers').select('id, first_name, last_name')
      .eq('company_id', companyId).is('archived_at', null).order('first_name')
    setWorkers(data || [])
  }

  function openNew() {
    setEditing(null)
    setForm({
      title: '', description: '', priority: 'normal', status: 'todo',
      due_date: '', due_time: '', job_id: '', assigned_to: ''
    })
    setShowModal(true)
  }

  function openEdit(task) {
    setEditing(task)
    setForm({
      title: task.title || '',
      description: task.description || '',
      priority: task.priority || 'normal',
      status: task.status || 'todo',
      due_date: task.due_date || '',
      due_time: task.due_time || '',
      job_id: task.job_id || '',
      assigned_to: task.assigned_to || ''
    })
    setShowModal(true)
  }

  async function saveTask() {
    if (!form.title.trim()) { showToast('Please enter a task title'); return }

    const payload = {
      title: form.title.trim(),
      description: form.description.trim(),
      priority: form.priority,
      status: form.status,
      due_date: form.due_date || null,
      due_time: form.due_time || null,
      job_id: form.job_id || null,
      assigned_to: form.assigned_to || null,
      company_id: companyId,
      updated_at: new Date().toISOString()
    }

    if (form.status === 'done' && (!editing || editing.status !== 'done')) {
      payload.completed_at = new Date().toISOString()
    }

    let error
    if (editing) {
      ({ error } = await supabase.from('tasks').update(payload).eq('id', editing.id))
    } else {
      payload.created_by = profile?.id;
      ({ error } = await supabase.from('tasks').insert(payload))
    }

    if (error) { showToast('Error saving task'); console.error(error); return }
    showToast(editing ? 'Task updated' : 'Task added')
    setShowModal(false)
    loadTasks()
  }

  async function toggleTask(task) {
    const newStatus = task.status === 'done' ? 'todo' : 'done'
    const { error } = await supabase.from('tasks').update({
      status: newStatus,
      completed_at: newStatus === 'done' ? new Date().toISOString() : null,
      updated_at: new Date().toISOString()
    }).eq('id', task.id)
    if (error) { showToast('Error updating task'); return }
    showToast(newStatus === 'done' ? 'Task completed' : 'Task reopened')
    loadTasks()
  }

  async function deleteTask() {
    if (!editing || !confirm('Delete this task?')) return
    await supabase.from('tasks').delete().eq('id', editing.id)
    showToast('Task deleted')
    setShowModal(false)
    loadTasks()
  }

  function updateForm(field, value) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  function formatDue(dateStr) {
    if (!dateStr) return null
    const today = new Date().toISOString().split('T')[0]
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0]
    if (dateStr < today) return { text: 'Overdue', cls: 'var(--red)' }
    if (dateStr === today) return { text: 'Today', cls: 'var(--yellow)' }
    if (dateStr === tomorrow) return { text: 'Tomorrow', cls: 'var(--text2)' }
    return { text: new Date(dateStr + 'T00:00:00').toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }), cls: 'var(--text2)' }
  }

  const today = new Date().toISOString().split('T')[0]
  let filtered = tasks
  if (filter === 'active') filtered = tasks.filter(t => t.status !== 'done' && t.status !== 'cancelled')
  else if (filter === 'today') filtered = tasks.filter(t => t.due_date === today && t.status !== 'done')
  else if (filter === 'done') filtered = tasks.filter(t => t.status === 'done')

  // Sort: incomplete first, then priority, then due date
  const priWeight = { urgent: 0, high: 1, normal: 2, low: 3 }
  filtered.sort((a, b) => {
    if ((a.status === 'done') !== (b.status === 'done')) return a.status === 'done' ? 1 : -1
    if (priWeight[a.priority] !== priWeight[b.priority]) return priWeight[a.priority] - priWeight[b.priority]
    if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date)
    if (a.due_date) return -1
    return 1
  })

  if (loading) return <div className="loading-center"><div className="spinner" /></div>

  return (
    <div>
      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 8, padding: '12px 16px 4px', overflowX: 'auto', scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}>
        {['active', 'today', 'all', 'done'].map(f => (
          <div key={f} onClick={() => setFilter(f)} style={{
            padding: '6px 14px', borderRadius: 10, fontSize: 12, fontWeight: 700,
            cursor: 'pointer', whiteSpace: 'nowrap',
            border: `1px solid ${filter === f ? 'rgba(0,212,160,0.3)' : 'var(--border)'}`,
            background: filter === f ? 'rgba(0,212,160,0.1)' : 'var(--card)',
            color: filter === f ? 'var(--primary)' : 'var(--text2)'
          }}>
            {f === 'active' ? 'Active' : f === 'today' ? 'Today' : f === 'all' ? 'All' : 'Done'}
          </div>
        ))}
      </div>

      <div className="sec" style={{ marginTop: 4 }}>
        <div className="sec-hdr">
          <div className="sec-title">Tasks</div>
          <div style={{ fontSize: 12, color: 'var(--text2)' }}>
            {filtered.filter(t => t.status !== 'done').length} active
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">✅</div>
            <div className="empty-title">No tasks</div>
            <div className="empty-sub">Tap + to add a task</div>
          </div>
        ) : (
          filtered.map(task => {
            const due = formatDue(task.due_date)
            const isDone = task.status === 'done'
            return (
              <div key={task.id} className="card" style={{ opacity: isDone ? 0.45 : 1 }}
                onClick={() => openEdit(task)}>
                <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                  {/* Checkbox */}
                  <div onClick={e => { e.stopPropagation(); toggleTask(task) }} style={{
                    width: 22, height: 22, borderRadius: '50%', flexShrink: 0, marginTop: 1,
                    border: `2px solid ${isDone ? 'var(--primary)' : PRIORITY_COLORS[task.priority]}`,
                    background: isDone ? 'var(--primary)' : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer', fontSize: 12, color: isDone ? '#000' : 'transparent',
                    transition: 'all 0.2s'
                  }}>
                    {isDone ? '✓' : ''}
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 14, fontWeight: 700,
                      textDecoration: isDone ? 'line-through' : 'none',
                      color: isDone ? 'var(--text3)' : 'var(--text)'
                    }}>
                      {task.title}
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
                      {due && (
                        <span style={{ fontSize: 11, fontWeight: 600, color: due.cls }}>
                          📅 {due.text}
                        </span>
                      )}
                      {(task.priority === 'urgent' || task.priority === 'high') && (
                        <span className="badge" style={{ background: PRIORITY_COLORS[task.priority] + '18', color: PRIORITY_COLORS[task.priority] }}>
                          {PRIORITY_LABELS[task.priority]}
                        </span>
                      )}
                      {task.jobs && (
                        <span style={{ fontSize: 10, background: 'rgba(33,150,243,0.12)', color: 'var(--blue)', padding: '2px 8px', borderRadius: 6, fontWeight: 700 }}>
                          {task.jobs.name}
                        </span>
                      )}
                      {task.workers && (
                        <span style={{ fontSize: 10, background: 'rgba(139,92,246,0.12)', color: 'var(--purple)', padding: '2px 8px', borderRadius: 6, fontWeight: 700 }}>
                          {task.workers.first_name} {task.workers.last_name}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>

      <button className="fab" onClick={openNew}>+</button>

      {showModal && (
        <Modal title={editing ? 'Edit Task' : 'New Task'} onClose={() => setShowModal(false)}>
          <div className="form-field">
            <label className="form-label">Task *</label>
            <input className="form-input" placeholder="e.g. Follow up on insurance claim"
              value={form.title} onChange={e => updateForm('title', e.target.value)} />
          </div>

          <div className="form-field">
            <label className="form-label">Description</label>
            <textarea className="form-input" placeholder="Details..."
              value={form.description} onChange={e => updateForm('description', e.target.value)} />
          </div>

          <div className="form-row">
            <div className="form-field">
              <label className="form-label">Due Date</label>
              <input className="form-input" type="date" value={form.due_date}
                onChange={e => updateForm('due_date', e.target.value)} />
            </div>
            <div className="form-field">
              <label className="form-label">Priority</label>
              <select className="form-input" value={form.priority}
                onChange={e => updateForm('priority', e.target.value)}>
                <option value="urgent">Urgent</option>
                <option value="high">High</option>
                <option value="normal">Normal</option>
                <option value="low">Low</option>
              </select>
            </div>
          </div>

          <div className="form-row">
            <div className="form-field">
              <label className="form-label">Link to Job</label>
              <select className="form-input" value={form.job_id}
                onChange={e => updateForm('job_id', e.target.value)}>
                <option value="">None</option>
                {jobs.map(j => <option key={j.id} value={j.id}>{j.job_number} — {j.name}</option>)}
              </select>
            </div>
            <div className="form-field">
              <label className="form-label">Assign to</label>
              <select className="form-input" value={form.assigned_to}
                onChange={e => updateForm('assigned_to', e.target.value)}>
                <option value="">Unassigned</option>
                {workers.map(w => <option key={w.id} value={w.id}>{w.first_name} {w.last_name}</option>)}
              </select>
            </div>
          </div>

          {editing && (
            <div className="form-field">
              <label className="form-label">Status</label>
              <select className="form-input" value={form.status}
                onChange={e => updateForm('status', e.target.value)}>
                <option value="todo">To Do</option>
                <option value="in_progress">In Progress</option>
                <option value="done">Done</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
          )}

          <button className="btn btn-primary btn-full" onClick={saveTask}>
            {editing ? 'Update Task' : 'Add Task'}
          </button>
          {editing && (
            <button className="btn btn-danger btn-full" style={{ marginTop: 8 }} onClick={deleteTask}>
              Delete Task
            </button>
          )}
          <button className="btn btn-secondary btn-full" style={{ marginTop: 8 }} onClick={() => setShowModal(false)}>
            Cancel
          </button>
        </Modal>
      )}
    </div>
  )
}

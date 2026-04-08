import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'

export default function NotificationCenter({ onClose, onNavigate }) {
  const { companyId } = useAuth()
  const [notifications, setNotifications] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadNotifications() }, [])

  async function loadNotifications() {
    const today = new Date().toISOString().split('T')[0]
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0]

    // Build notifications from real data
    const [overdueRes, tasksDueRes, recentActivityRes, unapprovedTimeRes, jobRemindersRes] = await Promise.all([
      // Overdue invoices
      supabase.from('invoices').select('id, invoice_number, total, due_date, clients(name)')
        .eq('company_id', companyId).eq('status', 'overdue').is('archived_at', null),
      // Tasks due today or overdue
      supabase.from('tasks').select('id, title, due_date, priority')
        .eq('company_id', companyId).in('status', ['todo', 'in_progress'])
        .lte('due_date', today),
      // Recent activity (last 24h)
      supabase.from('job_activity').select('id, type, content, created_at, jobs(name, job_number)')
        .eq('company_id', companyId)
        .gte('created_at', new Date(Date.now() - 24 * 3600000).toISOString())
        .order('created_at', { ascending: false }).limit(10),
      // Unapproved time entries
      supabase.from('time_entries').select('id, date, total_hours, workers(first_name, last_name)')
        .eq('company_id', companyId).eq('is_approved', false),
      // Job reminders due today or overdue
      supabase.from('jobs').select('id, name, job_number, reminder_date, reminder_note, clients(name)')
        .eq('company_id', companyId).is('archived_at', null)
        .not('reminder_date', 'is', null)
        .lte('reminder_date', today)
    ])

    const notifs = []

    // Job reminders (highest priority — these are user-set follow-ups)
    ;(jobRemindersRes.data || []).forEach(j => {
      const isOverdue = j.reminder_date < today
      notifs.push({
        id: 'reminder-' + j.id,
        type: 'reminder',
        icon: '🔔',
        title: j.reminder_note || `Follow up on ${j.name}`,
        subtitle: `${j.job_number} · ${j.clients?.name || ''} · ${isOverdue ? 'Overdue' : 'Due today'}`,
        color: isOverdue ? 'var(--red)' : 'var(--yellow)',
        action: () => { onClose(); onNavigate('jobs') }
      })
    })

    // Overdue invoices
    ;(overdueRes.data || []).forEach(inv => {
      notifs.push({
        id: 'inv-' + inv.id,
        type: 'overdue',
        icon: '🚨',
        title: `Invoice ${inv.invoice_number} is overdue`,
        subtitle: `${inv.clients?.name} — $${parseFloat(inv.total).toLocaleString()} due ${inv.due_date}`,
        color: 'var(--red)',
        action: () => { onClose(); onNavigate('billing') }
      })
    })

    // Tasks due
    ;(tasksDueRes.data || []).forEach(t => {
      const isOverdue = t.due_date < today
      notifs.push({
        id: 'task-' + t.id,
        type: 'task',
        icon: t.priority === 'urgent' ? '🔴' : isOverdue ? '⚠️' : '📅',
        title: t.title,
        subtitle: isOverdue ? `Overdue since ${t.due_date}` : 'Due today',
        color: isOverdue ? 'var(--red)' : 'var(--yellow)',
        action: () => { onClose(); onNavigate('jobs') }
      })
    })

    // Unapproved time entries
    const unapproved = unapprovedTimeRes.data || []
    if (unapproved.length > 0) {
      notifs.push({
        id: 'time-approval',
        type: 'approval',
        icon: '⏱',
        title: `${unapproved.length} time ${unapproved.length === 1 ? 'entry' : 'entries'} need approval`,
        subtitle: unapproved.slice(0, 3).map(e => `${e.workers?.first_name} ${e.workers?.last_name}`).join(', '),
        color: 'var(--yellow)',
        action: () => { onClose(); onNavigate('team') }
      })
    }

    // Recent activity
    ;(recentActivityRes.data || []).forEach(a => {
      notifs.push({
        id: 'act-' + a.id,
        type: 'activity',
        icon: a.type === 'status_change' ? '🔄' : a.type === 'photo' ? '📷' : '📝',
        title: a.content,
        subtitle: `${a.jobs?.job_number || ''} · ${timeAgo(a.created_at)}`,
        color: 'var(--text2)',
        action: () => { onClose(); onNavigate('jobs') }
      })
    })

    setNotifications(notifs)
    setLoading(false)
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

  const urgentCount = notifications.filter(n => ['overdue', 'task', 'reminder'].includes(n.type)).length

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 250,
      background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)',
      display: 'flex', flexDirection: 'column'
    }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{
        width: '100%', maxWidth: 480, margin: '0 auto',
        flex: 1, overflow: 'auto', padding: 16
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800 }}>Notifications</div>
            {urgentCount > 0 && (
              <div style={{ fontSize: 12, color: 'var(--red)', fontWeight: 600, marginTop: 2 }}>
                {urgentCount} need attention
              </div>
            )}
          </div>
          <button onClick={onClose} style={{
            background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10,
            width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', fontSize: 16, color: 'var(--text2)'
          }}>✕</button>
        </div>

        {loading ? (
          <div className="loading-center"><div className="spinner" /></div>
        ) : notifications.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">✅</div>
            <div className="empty-title">All clear</div>
            <div className="empty-sub">No notifications right now</div>
          </div>
        ) : (
          notifications.map(n => (
            <div key={n.id} onClick={n.action} style={{
              background: 'var(--card)', border: '1px solid var(--border)',
              borderRadius: 16, padding: '14px 16px', marginBottom: 8,
              display: 'flex', gap: 12, alignItems: 'flex-start', cursor: 'pointer',
              borderLeft: n.type === 'overdue' ? '3px solid var(--red)' :
                n.type === 'task' ? '3px solid var(--yellow)' :
                n.type === 'approval' ? '3px solid var(--yellow)' :
                n.type === 'reminder' ? '3px solid var(--yellow)' : '3px solid var(--border)',
              transition: 'background 0.15s'
            }}>
              <span style={{ fontSize: 20, flexShrink: 0 }}>{n.icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.4 }}>{n.title}</div>
                <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 3 }}>{n.subtitle}</div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

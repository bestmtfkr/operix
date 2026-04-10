import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useToast } from '../shared/Toast'
import Modal from '../shared/Modal'

export default function EmailSettings({ settings, onSave }) {
  const { companyId } = useAuth()
  const showToast = useToast()

  const [emailSettings, setEmailSettings] = useState({
    assignment_enabled: settings?.email_assignment ?? true,
    comments_enabled: settings?.email_comments ?? true,
    sla_enabled: settings?.email_sla ?? false,
    sla_hours: settings?.email_sla_hours ?? 4,
    templates_enabled: settings?.email_templates ?? true,
    collision_enabled: settings?.email_collision ?? false,
  })

  const [templates, setTemplates] = useState([])
  const [showTemplateModal, setShowTemplateModal] = useState(false)
  const [editTemplate, setEditTemplate] = useState(null)
  const [tplForm, setTplForm] = useState({ name: '', body: '' })

  useEffect(() => { loadTemplates() }, [companyId])

  async function loadTemplates() {
    const { data } = await supabase.from('reply_templates')
      .select('*').eq('company_id', companyId).order('name')
    setTemplates(data || [])
  }

  function toggle(key) {
    setEmailSettings(prev => ({ ...prev, [key]: !prev[key] }))
  }

  async function save() {
    const updated = {
      ...settings,
      email_assignment: emailSettings.assignment_enabled,
      email_comments: emailSettings.comments_enabled,
      email_sla: emailSettings.sla_enabled,
      email_sla_hours: emailSettings.sla_hours,
      email_templates: emailSettings.templates_enabled,
      email_collision: emailSettings.collision_enabled,
    }
    await onSave(updated)
    showToast('Email settings saved')
  }

  async function saveTemplate() {
    if (!tplForm.name.trim() || !tplForm.body.trim()) { showToast('Name and body required'); return }
    if (editTemplate) {
      await supabase.from('reply_templates').update({ name: tplForm.name.trim(), body: tplForm.body.trim() }).eq('id', editTemplate.id)
    } else {
      await supabase.from('reply_templates').insert({ company_id: companyId, name: tplForm.name.trim(), body: tplForm.body.trim() })
    }
    showToast(editTemplate ? 'Template updated' : 'Template created')
    setShowTemplateModal(false)
    loadTemplates()
  }

  async function deleteTemplate() {
    if (!editTemplate || !confirm('Delete?')) return
    await supabase.from('reply_templates').delete().eq('id', editTemplate.id)
    showToast('Deleted')
    setShowTemplateModal(false)
    loadTemplates()
  }

  const features = [
    { key: 'assignment_enabled', label: 'Email Assignment', desc: 'Assign emails to team members. Track who\'s handling what.' },
    { key: 'comments_enabled', label: 'Internal Comments', desc: 'Team members can comment on emails. Not visible to the sender.' },
    { key: 'sla_enabled', label: 'SLA Timers', desc: 'Track response time. Emails go yellow then red if unanswered.' },
    { key: 'templates_enabled', label: 'Reply Templates', desc: 'Pre-written replies with variables like {client_name}, {address}.' },
    { key: 'collision_enabled', label: 'Collision Detection', desc: 'Prevent two people from replying to the same email.' },
  ]

  return (
    <div>
      <div className="sec-hdr"><div className="sec-title">Email Features</div></div>
      <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 12 }}>Toggle features on/off based on your workflow.</div>

      {features.map(f => (
        <div key={f.key} onClick={() => toggle(f.key)} style={{
          display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
          background: emailSettings[f.key] ? 'rgba(0,212,160,0.04)' : 'var(--bg2)',
          border: `1px solid ${emailSettings[f.key] ? 'rgba(0,212,160,0.15)' : 'var(--border)'}`,
          borderRadius: 12, marginBottom: 6, cursor: 'pointer'
        }}>
          <div style={{
            width: 38, height: 21, borderRadius: 11, position: 'relative', flexShrink: 0,
            background: emailSettings[f.key] ? 'var(--primary)' : 'var(--text3)', transition: 'background 0.2s'
          }}>
            <div style={{
              width: 15, height: 15, borderRadius: '50%', background: '#fff', position: 'absolute',
              top: 3, left: emailSettings[f.key] ? 20 : 3, transition: 'left 0.2s'
            }} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>{f.label}</div>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 1 }}>{f.desc}</div>
          </div>
        </div>
      ))}

      {emailSettings.sla_enabled && (
        <div style={{ marginTop: 8, marginBottom: 12 }}>
          <label className="form-label">SLA Response Time (hours)</label>
          <input type="number" className="form-input" value={emailSettings.sla_hours}
            onChange={e => setEmailSettings(prev => ({ ...prev, sla_hours: parseInt(e.target.value) || 4 }))}
            min="1" max="72" />
        </div>
      )}

      <button onClick={save} className="btn btn-primary btn-full" style={{ marginTop: 12 }}>Save Email Settings</button>

      {/* Reply Templates */}
      {emailSettings.templates_enabled && (
        <div style={{ marginTop: 20 }}>
          <div className="sec-hdr">
            <div className="sec-title">Reply Templates</div>
            <div className="sec-more" onClick={() => { setEditTemplate(null); setTplForm({ name: '', body: '' }); setShowTemplateModal(true) }}>+ New</div>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 8 }}>
            Variables: {'{client_name}'}, {'{address}'}, {'{job_number}'}, {'{date}'}, {'{worker_name}'}
          </div>

          {templates.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 16, color: 'var(--text3)', fontSize: 12 }}>No templates yet</div>
          ) : templates.map(t => (
            <div key={t.id} className="card" onClick={() => { setEditTemplate(t); setTplForm({ name: t.name, body: t.body }); setShowTemplateModal(true) }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{t.name}</div>
              <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.body}</div>
            </div>
          ))}
        </div>
      )}

      {showTemplateModal && (
        <Modal title={editTemplate ? 'Edit Template' : 'New Template'} onClose={() => setShowTemplateModal(false)}>
          <div className="form-field">
            <label className="form-label">Template Name</label>
            <input className="form-input" placeholder="e.g. Job Confirmation"
              value={tplForm.name} onChange={e => setTplForm(f => ({ ...f, name: e.target.value }))} />
          </div>
          <div className="form-field">
            <label className="form-label">Reply Body</label>
            <textarea className="form-input" style={{ minHeight: 150, lineHeight: 1.7 }}
              placeholder={"Hi {client_name},\n\nYour job at {address} is confirmed for {date}.\n\nBest regards"}
              value={tplForm.body} onChange={e => setTplForm(f => ({ ...f, body: e.target.value }))} />
            <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 4 }}>
              Use {'{client_name}'}, {'{address}'}, {'{job_number}'}, {'{date}'}, {'{worker_name}'} as variables
            </div>
          </div>
          <button onClick={saveTemplate} className="btn btn-primary btn-full">
            {editTemplate ? 'Update' : 'Create'} Template
          </button>
          {editTemplate && (
            <button onClick={deleteTemplate} className="btn btn-danger btn-full" style={{ marginTop: 8 }}>Delete</button>
          )}
          <button onClick={() => setShowTemplateModal(false)} className="btn btn-secondary btn-full" style={{ marginTop: 8 }}>Cancel</button>
        </Modal>
      )}
    </div>
  )
}

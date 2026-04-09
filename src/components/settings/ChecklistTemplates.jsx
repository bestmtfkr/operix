import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useToast } from '../shared/Toast'
import Modal from '../shared/Modal'
import { JOB_TYPES, JOB_TYPE_LABELS } from '../../lib/constants'

export default function ChecklistTemplates() {
  const { companyId } = useAuth()
  const showToast = useToast()
  const [templates, setTemplates] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({ name: '', job_type: '', items: [] })
  const [newItem, setNewItem] = useState({ label: '', tag: 'field', required: false })

  useEffect(() => { if (companyId) loadTemplates() }, [companyId])

  async function loadTemplates() {
    const { data } = await supabase.from('checklist_templates')
      .select('*').eq('company_id', companyId).order('name')
    setTemplates(data || [])
    setLoading(false)
  }

  function openNew() {
    setEditing(null)
    setForm({ name: '', job_type: '', items: [] })
    setShowModal(true)
  }

  function openEdit(tpl) {
    setEditing(tpl)
    setForm({ name: tpl.name, job_type: tpl.job_type || '', items: tpl.items || [] })
    setShowModal(true)
  }

  function addItem() {
    if (!newItem.label.trim()) return
    setForm(f => ({ ...f, items: [...f.items, { ...newItem, label: newItem.label.trim(), done: false }] }))
    setNewItem({ label: '', tag: 'field', required: false })
  }

  function removeItem(idx) {
    setForm(f => ({ ...f, items: f.items.filter((_, i) => i !== idx) }))
  }

  async function save() {
    if (!form.name.trim()) { showToast('Template name required'); return }
    const payload = { name: form.name.trim(), job_type: form.job_type || null, items: form.items, company_id: companyId }

    let error
    if (editing) {
      ({ error } = await supabase.from('checklist_templates').update(payload).eq('id', editing.id))
    } else {
      ({ error } = await supabase.from('checklist_templates').insert(payload))
    }
    if (error) { showToast('Error saving'); return }
    showToast(editing ? 'Template updated' : 'Template created')
    setShowModal(false)
    loadTemplates()
  }

  async function deleteTemplate() {
    if (!editing || !confirm('Delete this template?')) return
    await supabase.from('checklist_templates').delete().eq('id', editing.id)
    showToast('Template deleted')
    setShowModal(false)
    loadTemplates()
  }

  if (loading) return <div className="loading-center"><div className="spinner" /></div>

  return (
    <div>
      <div className="sec-hdr">
        <div className="sec-title">Checklist Templates</div>
        <div className="sec-more" onClick={openNew}>+ New Template</div>
      </div>

      {templates.length === 0 ? (
        <div style={{ color: 'var(--text3)', fontSize: 13, padding: 16, textAlign: 'center' }}>
          No templates yet. Create one to auto-fill checklists on new jobs.
        </div>
      ) : templates.map(tpl => (
        <div key={tpl.id} className="card" onClick={() => openEdit(tpl)}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{tpl.name}</div>
              <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
                {tpl.items?.length || 0} items {tpl.job_type ? '· ' + (JOB_TYPE_LABELS[tpl.job_type] || tpl.job_type) : ''}
              </div>
            </div>
            <span className="badge green">{tpl.items?.length || 0}</span>
          </div>
        </div>
      ))}

      {showModal && (
        <Modal title={editing ? 'Edit Template' : 'New Template'} onClose={() => setShowModal(false)}>
          <div className="form-field">
            <label className="form-label">Template Name *</label>
            <input className="form-input" placeholder="e.g. Water Damage Standard"
              value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </div>

          <div className="form-field">
            <label className="form-label">Job Type (optional)</label>
            <select className="form-input" value={form.job_type}
              onChange={e => setForm(f => ({ ...f, job_type: e.target.value }))}>
              <option value="">Any type</option>
              {JOB_TYPES.map(t => <option key={t} value={t}>{JOB_TYPE_LABELS[t]}</option>)}
            </select>
          </div>

          {/* Checklist items */}
          <div style={{ marginTop: 12 }}>
            <label className="form-label">ITEMS ({form.items.length})</label>
            <div style={{ background: 'var(--bg2)', borderRadius: 12, overflow: 'hidden', marginBottom: 10 }}>
              {form.items.map((item, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '8px 12px', borderBottom: '1px solid var(--border)'
                }}>
                  <span style={{ flex: 1, fontSize: 12 }}>{item.label}</span>
                  <span style={{
                    fontSize: 9, padding: '2px 6px', borderRadius: 5, fontWeight: 700,
                    background: item.tag === 'field' ? 'rgba(33,150,243,0.1)' : 'rgba(139,92,246,0.1)',
                    color: item.tag === 'field' ? 'var(--blue)' : 'var(--purple)'
                  }}>{item.tag === 'field' ? 'FIELD' : 'ADMIN'}</span>
                  {item.required && <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 5, background: 'rgba(255,59,92,0.1)', color: 'var(--red)', fontWeight: 700 }}>REQ</span>}
                  <button onClick={() => removeItem(i)} style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: 14 }}>×</button>
                </div>
              ))}
              {form.items.length === 0 && (
                <div style={{ padding: 12, textAlign: 'center', fontSize: 11, color: 'var(--text3)' }}>No items yet</div>
              )}
            </div>

            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input value={newItem.label} onChange={e => setNewItem(n => ({ ...n, label: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Enter') addItem() }}
                placeholder="Add item..." style={{
                  flex: 1, padding: '8px 12px', background: 'var(--card)', border: '1px solid var(--border)',
                  borderRadius: 8, fontSize: 12, color: 'var(--text)', outline: 'none', fontFamily: 'DM Sans'
                }} />
              <select value={newItem.tag} onChange={e => setNewItem(n => ({ ...n, tag: e.target.value }))} style={{
                padding: '8px 6px', background: 'var(--card)', border: '1px solid var(--border)',
                borderRadius: 8, fontSize: 10, color: 'var(--text2)', outline: 'none', fontFamily: 'DM Sans'
              }}>
                <option value="field">Field</option>
                <option value="admin">Admin</option>
              </select>
              <label style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: 'var(--text3)', cursor: 'pointer' }}>
                <input type="checkbox" checked={newItem.required} onChange={e => setNewItem(n => ({ ...n, required: e.target.checked }))} />
                Req
              </label>
              <button onClick={addItem} style={{
                padding: '8px 12px', borderRadius: 8, fontSize: 11, fontWeight: 700,
                background: 'var(--primary)', border: 'none', color: '#000', cursor: 'pointer', fontFamily: 'DM Sans'
              }}>+</button>
            </div>
          </div>

          <button className="btn btn-primary btn-full" style={{ marginTop: 16 }} onClick={save}>
            {editing ? 'Update Template' : 'Create Template'}
          </button>
          {editing && (
            <button className="btn btn-danger btn-full" style={{ marginTop: 8 }} onClick={deleteTemplate}>Delete Template</button>
          )}
          <button className="btn btn-secondary btn-full" style={{ marginTop: 8 }} onClick={() => setShowModal(false)}>Cancel</button>
        </Modal>
      )}
    </div>
  )
}

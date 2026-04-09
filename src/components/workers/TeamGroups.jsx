import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useToast } from '../shared/Toast'
import Modal from '../shared/Modal'

export default function TeamGroups() {
  const { companyId } = useAuth()
  const showToast = useToast()
  const [teams, setTeams] = useState([])
  const [workers, setWorkers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({ name: '', worker_ids: [], whatsapp_group_link: '' })

  useEffect(() => { if (companyId) { loadTeams(); loadWorkers() } }, [companyId])

  async function loadTeams() {
    const { data } = await supabase.from('teams').select('*').eq('company_id', companyId).order('name')
    setTeams(data || [])
    setLoading(false)
  }

  async function loadWorkers() {
    const { data } = await supabase.from('workers').select('id, first_name, last_name, phone')
      .eq('company_id', companyId).is('archived_at', null).eq('status', 'active').order('first_name')
    setWorkers(data || [])
  }

  function openNew() {
    setEditing(null)
    setForm({ name: '', worker_ids: [], whatsapp_group_link: '' })
    setShowModal(true)
  }

  function openEdit(team) {
    setEditing(team)
    setForm({
      name: team.name || '',
      worker_ids: team.worker_ids || [],
      whatsapp_group_link: team.whatsapp_group_link || ''
    })
    setShowModal(true)
  }

  function toggleWorker(workerId) {
    setForm(f => ({
      ...f,
      worker_ids: f.worker_ids.includes(workerId)
        ? f.worker_ids.filter(id => id !== workerId)
        : [...f.worker_ids, workerId]
    }))
  }

  async function save() {
    if (!form.name.trim()) { showToast('Team name required'); return }
    if (form.worker_ids.length === 0) { showToast('Add at least one worker'); return }

    const payload = { ...form, company_id: companyId }
    let error
    if (editing) {
      ({ error } = await supabase.from('teams').update(payload).eq('id', editing.id))
    } else {
      ({ error } = await supabase.from('teams').insert(payload))
    }
    if (error) { showToast('Error saving'); console.error(error); return }
    showToast(editing ? 'Team updated' : 'Team created')
    setShowModal(false)
    loadTeams()
  }

  async function deleteTeam() {
    if (!editing || !confirm('Delete this team?')) return
    await supabase.from('teams').delete().eq('id', editing.id)
    showToast('Team deleted')
    setShowModal(false)
    loadTeams()
  }

  function getWorkerName(id) {
    const w = workers.find(w => w.id === id)
    return w ? `${w.first_name} ${w.last_name}` : 'Unknown'
  }

  function getWorkerInitials(id) {
    const w = workers.find(w => w.id === id)
    return w ? `${w.first_name?.charAt(0) || ''}${w.last_name?.charAt(0) || ''}` : '?'
  }

  // Generate WhatsApp group link from worker phone numbers
  function generateWhatsAppLink(team) {
    const phones = (team.worker_ids || [])
      .map(id => workers.find(w => w.id === id)?.phone)
      .filter(Boolean)
      .map(p => p.replace(/[^0-9]/g, ''))

    if (phones.length === 0) { showToast('No phone numbers found'); return }
    if (phones.length === 1) {
      window.open(`https://wa.me/${phones[0]}`, '_blank')
      return
    }
    // WhatsApp doesn't have a direct API to create groups from a link
    // But we can open a multi-person message
    // For now, copy all numbers
    navigator.clipboard.writeText(phones.join(', ')).then(() => {
      showToast('Phone numbers copied — create a WhatsApp group manually')
    })
  }

  if (loading) return <div className="loading-center"><div className="spinner" /></div>

  return (
    <div>
      <div className="sec-hdr" style={{ marginTop: 12 }}>
        <div className="sec-title">Teams</div>
        <div className="sec-more" onClick={openNew}>+ New Team</div>
      </div>

      {teams.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 24, color: 'var(--text3)', fontSize: 13 }}>
          No teams yet. Group workers together for quick scheduling.
        </div>
      ) : teams.map(team => (
        <div key={team.id} className="card" onClick={() => openEdit(team)}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{team.name}</div>
            <span className="badge green">{(team.worker_ids || []).length} members</span>
          </div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
            {(team.worker_ids || []).map(id => (
              <div key={id} style={{
                width: 30, height: 30, borderRadius: 10,
                background: 'linear-gradient(135deg, var(--primary), var(--primary2))',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 10, fontWeight: 800, color: '#000'
              }}>{getWorkerInitials(id)}</div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {team.whatsapp_group_link ? (
              <a href={team.whatsapp_group_link} target="_blank" rel="noopener" onClick={e => e.stopPropagation()}
                style={{
                  padding: '5px 12px', borderRadius: 8, fontSize: 11, fontWeight: 700,
                  background: 'rgba(37,211,102,0.1)', border: '1px solid rgba(37,211,102,0.2)',
                  color: '#25D366', textDecoration: 'none'
                }}>💬 WhatsApp Group</a>
            ) : (
              <button onClick={e => { e.stopPropagation(); generateWhatsAppLink(team) }} style={{
                padding: '5px 12px', borderRadius: 8, fontSize: 11, fontWeight: 700,
                background: 'rgba(37,211,102,0.08)', border: '1px solid rgba(37,211,102,0.15)',
                color: '#25D366', cursor: 'pointer', fontFamily: 'DM Sans'
              }}>💬 Message Team</button>
            )}
          </div>
        </div>
      ))}

      {showModal && (
        <Modal title={editing ? 'Edit Team' : 'New Team'} onClose={() => setShowModal(false)}>
          <div className="form-field">
            <label className="form-label">Team Name *</label>
            <input className="form-input" placeholder="e.g. Crew A, Night Shift"
              value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </div>

          <div className="form-field">
            <label className="form-label">WhatsApp Group Link (optional)</label>
            <input className="form-input" placeholder="https://chat.whatsapp.com/..."
              value={form.whatsapp_group_link} onChange={e => setForm(f => ({ ...f, whatsapp_group_link: e.target.value }))} />
            <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 3 }}>
              Create a WhatsApp group, tap Group Info → Invite via link → paste here
            </div>
          </div>

          <div style={{ marginTop: 8 }}>
            <label className="form-label">MEMBERS ({form.worker_ids.length})</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {workers.map(w => {
                const selected = form.worker_ids.includes(w.id)
                return (
                  <div key={w.id} onClick={() => toggleWorker(w.id)} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 12px', borderRadius: 10, cursor: 'pointer',
                    background: selected ? 'rgba(0,212,160,0.06)' : 'var(--bg2)',
                    border: `1px solid ${selected ? 'rgba(0,212,160,0.2)' : 'var(--border)'}`
                  }}>
                    <div style={{
                      width: 20, height: 20, borderRadius: 6,
                      background: selected ? 'var(--primary)' : 'transparent',
                      border: `2px solid ${selected ? 'var(--primary)' : 'var(--text3)'}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 12, color: selected ? '#000' : 'transparent'
                    }}>{selected ? '✓' : ''}</div>
                    <div style={{
                      width: 32, height: 32, borderRadius: 10,
                      background: 'linear-gradient(135deg, var(--primary), var(--primary2))',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 11, fontWeight: 800, color: '#000'
                    }}>{w.first_name?.charAt(0)}{w.last_name?.charAt(0)}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{w.first_name} {w.last_name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text3)' }}>{w.role || 'Worker'}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          <button className="btn btn-primary btn-full" style={{ marginTop: 16 }} onClick={save}>
            {editing ? 'Update Team' : 'Create Team'}
          </button>
          {editing && (
            <button className="btn btn-danger btn-full" style={{ marginTop: 8 }} onClick={deleteTeam}>Delete Team</button>
          )}
          <button className="btn btn-secondary btn-full" style={{ marginTop: 8 }} onClick={() => setShowModal(false)}>Cancel</button>
        </Modal>
      )}
    </div>
  )
}

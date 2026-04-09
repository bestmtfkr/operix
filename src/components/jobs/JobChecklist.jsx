import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useToast } from '../shared/Toast'

export default function JobChecklist({ jobId, checklist, onUpdate }) {
  const { companyId } = useAuth()
  const showToast = useToast()
  const [items, setItems] = useState(checklist || [])
  const [newItem, setNewItem] = useState('')
  const [newTag, setNewTag] = useState('field')
  const [newRequired, setNewRequired] = useState(false)

  const done = items.filter(i => i.done).length
  const total = items.length
  const pct = total > 0 ? Math.round((done / total) * 100) : 0

  async function saveChecklist(updated) {
    setItems(updated)
    await supabase.from('jobs').update({ checklist: updated }).eq('id', jobId)
    if (onUpdate) onUpdate(updated)
  }

  async function toggleItem(idx) {
    const updated = items.map((item, i) => i === idx ? { ...item, done: !item.done } : item)
    await saveChecklist(updated)
  }

  async function addItem() {
    if (!newItem.trim()) return
    const updated = [...items, {
      label: newItem.trim(),
      done: false,
      tag: newTag,
      required: newRequired
    }]
    await saveChecklist(updated)
    setNewItem('')
    setNewRequired(false)
    showToast('Item added')
  }

  async function removeItem(idx) {
    const updated = items.filter((_, i) => i !== idx)
    await saveChecklist(updated)
  }

  return (
    <div>
      {/* Progress */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 700 }}>Checklist</span>
        <span style={{ fontSize: 11, color: 'var(--text3)' }}>{done}/{total} ({pct}%)</span>
      </div>
      <div style={{ height: 4, background: 'var(--bg2)', borderRadius: 2, marginBottom: 12, overflow: 'hidden' }}>
        <div style={{
          height: '100%', borderRadius: 2,
          background: pct === 100 ? 'var(--green)' : 'linear-gradient(90deg, var(--primary), var(--primary2))',
          width: `${pct}%`, transition: 'width 0.3s'
        }} />
      </div>

      {/* Items */}
      <div style={{ background: 'var(--bg2)', borderRadius: 12, overflow: 'hidden' }}>
        {items.length === 0 ? (
          <div style={{ padding: 16, textAlign: 'center', fontSize: 12, color: 'var(--text3)' }}>
            No checklist items. Add one below.
          </div>
        ) : items.map((item, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '10px 14px',
            borderBottom: i < items.length - 1 ? '1px solid var(--border)' : 'none'
          }}>
            <input
              type="checkbox" checked={item.done}
              onChange={() => toggleItem(i)}
              style={{ width: 16, height: 16, cursor: 'pointer', accentColor: 'var(--primary)', flexShrink: 0 }}
            />
            <span style={{
              flex: 1, fontSize: 13,
              textDecoration: item.done ? 'line-through' : 'none',
              color: item.done ? 'var(--text3)' : 'var(--text)'
            }}>{item.label}</span>
            <span style={{
              fontSize: 9, padding: '2px 6px', borderRadius: 5,
              background: item.tag === 'field' ? 'rgba(33,150,243,0.1)' : 'rgba(139,92,246,0.1)',
              color: item.tag === 'field' ? 'var(--blue)' : 'var(--purple)',
              fontWeight: 700
            }}>{item.tag === 'field' ? 'FIELD' : 'ADMIN'}</span>
            {item.required && (
              <span style={{
                fontSize: 9, padding: '2px 6px', borderRadius: 5,
                background: 'rgba(255,59,92,0.1)', color: 'var(--red)', fontWeight: 700
              }}>REQ</span>
            )}
            <button onClick={() => removeItem(i)} style={{
              background: 'none', border: 'none', color: 'var(--text3)',
              cursor: 'pointer', fontSize: 14, padding: '0 2px'
            }}>×</button>
          </div>
        ))}
      </div>

      {/* Add item */}
      <div style={{ marginTop: 10, display: 'flex', gap: 6, alignItems: 'center' }}>
        <input
          value={newItem} onChange={e => setNewItem(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') addItem() }}
          placeholder="Add checklist item..."
          style={{
            flex: 1, padding: '8px 12px', background: 'var(--card)',
            border: '1px solid var(--border)', borderRadius: 8,
            fontSize: 12, color: 'var(--text)', outline: 'none', fontFamily: 'DM Sans'
          }}
        />
        <select value={newTag} onChange={e => setNewTag(e.target.value)} style={{
          padding: '8px 6px', background: 'var(--card)', border: '1px solid var(--border)',
          borderRadius: 8, fontSize: 10, color: 'var(--text2)', outline: 'none', fontFamily: 'DM Sans'
        }}>
          <option value="field">Field</option>
          <option value="admin">Admin</option>
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, color: 'var(--text3)', cursor: 'pointer', flexShrink: 0 }}>
          <input type="checkbox" checked={newRequired} onChange={e => setNewRequired(e.target.checked)} />
          Req
        </label>
        <button onClick={addItem} style={{
          padding: '8px 12px', borderRadius: 8, fontSize: 11, fontWeight: 700,
          background: 'var(--primary)', border: 'none', color: '#000',
          cursor: 'pointer', fontFamily: 'DM Sans', flexShrink: 0
        }}>+</button>
      </div>
    </div>
  )
}

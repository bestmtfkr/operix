import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useToast } from '../shared/Toast'

const DEFAULT_STAGES = [
  { id: 'lead', label: 'Lead', color: '#8B5CF6', enabled: true },
  { id: 'quoted', label: 'Quoted', color: '#2196F3', enabled: true },
  { id: 'active', label: 'Active', color: '#00D4A0', enabled: true },
  { id: 'completed', label: 'Completed', color: '#FFB800', enabled: true },
  { id: 'invoiced', label: 'Invoiced', color: '#FF6B35', enabled: true },
  { id: 'closed', label: 'Closed', color: '#3D4A5C', enabled: true },
]

export default function PipelineSettings() {
  const { companyId } = useAuth()
  const showToast = useToast()
  const [settings, setSettings] = useState(null)
  const [stages, setStages] = useState(DEFAULT_STAGES)
  const [scheduleRule, setScheduleRule] = useState('any') // 'any' or 'accepted'
  const [acceptedStages, setAcceptedStages] = useState(['active', 'completed', 'invoiced', 'closed'])
  const [saving, setSaving] = useState(false)

  useEffect(() => { if (companyId) loadSettings() }, [companyId])

  async function loadSettings() {
    const { data } = await supabase.from('companies').select('settings').eq('id', companyId).single()
    const s = data?.settings || {}
    setSettings(s)

    if (s.pipeline_stages) {
      setStages(s.pipeline_stages)
    }
    if (s.schedule_rule) {
      setScheduleRule(s.schedule_rule)
    }
    if (s.accepted_stages) {
      setAcceptedStages(s.accepted_stages)
    }
  }

  function updateStage(idx, field, value) {
    setStages(prev => prev.map((s, i) => i === idx ? { ...s, [field]: value } : s))
  }

  function toggleStageEnabled(idx) {
    // Don't allow disabling 'active' — it's required
    if (stages[idx].id === 'active') { showToast("Active stage can't be disabled"); return }
    setStages(prev => prev.map((s, i) => i === idx ? { ...s, enabled: !s.enabled } : s))
  }

  function moveStage(idx, dir) {
    const newStages = [...stages]
    const newIdx = idx + dir
    if (newIdx < 0 || newIdx >= newStages.length) return
    ;[newStages[idx], newStages[newIdx]] = [newStages[newIdx], newStages[idx]]
    setStages(newStages)
  }

  function addStage() {
    const id = 'custom_' + Date.now()
    setStages(prev => [...prev.slice(0, -1), { id, label: 'New Stage', color: '#7A8799', enabled: true }, prev[prev.length - 1]])
  }

  function removeStage(idx) {
    if (['active'].includes(stages[idx].id)) { showToast("Can't remove required stages"); return }
    if (!confirm('Remove this stage?')) return
    setStages(prev => prev.filter((_, i) => i !== idx))
  }

  async function save() {
    setSaving(true)
    const updatedSettings = {
      ...settings,
      pipeline_stages: stages,
      schedule_rule: scheduleRule,
      accepted_stages: acceptedStages
    }

    const { error } = await supabase.from('companies').update({ settings: updatedSettings }).eq('id', companyId)
    setSaving(false)
    if (error) { showToast('Error saving'); return }
    showToast('Pipeline settings saved')
  }

  return (
    <div>
      <div className="sec-hdr">
        <div className="sec-title">Pipeline Stages</div>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 12, lineHeight: 1.5 }}>
        Customize your workflow stages. Rename, reorder, show/hide, or add custom stages.
      </div>

      {/* Stages */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
        {stages.map((stage, i) => (
          <div key={stage.id} style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '10px 12px', borderRadius: 12,
            background: stage.enabled ? 'var(--card)' : 'var(--bg2)',
            border: `1px solid ${stage.enabled ? 'var(--border)' : 'var(--border)'}`,
            opacity: stage.enabled ? 1 : 0.5
          }}>
            {/* Color dot */}
            <input type="color" value={stage.color} onChange={e => updateStage(i, 'color', e.target.value)}
              style={{ width: 24, height: 24, border: 'none', borderRadius: 6, cursor: 'pointer', padding: 0 }} />

            {/* Label */}
            <input value={stage.label} onChange={e => updateStage(i, 'label', e.target.value)}
              style={{
                flex: 1, background: 'transparent', border: 'none', outline: 'none',
                fontSize: 14, fontWeight: 600, color: 'var(--text)', fontFamily: 'DM Sans'
              }} />

            {/* Move buttons */}
            <button onClick={() => moveStage(i, -1)} disabled={i === 0} style={{
              width: 24, height: 24, borderRadius: 6, background: 'var(--bg2)',
              border: '1px solid var(--border)', cursor: 'pointer', fontSize: 12,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--text3)', opacity: i === 0 ? 0.3 : 1
            }}>↑</button>
            <button onClick={() => moveStage(i, 1)} disabled={i === stages.length - 1} style={{
              width: 24, height: 24, borderRadius: 6, background: 'var(--bg2)',
              border: '1px solid var(--border)', cursor: 'pointer', fontSize: 12,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--text3)', opacity: i === stages.length - 1 ? 0.3 : 1
            }}>↓</button>

            {/* Enable/disable */}
            <button onClick={() => toggleStageEnabled(i)} style={{
              padding: '4px 8px', borderRadius: 6, fontSize: 10, fontWeight: 700,
              background: stage.enabled ? 'rgba(0,212,160,0.1)' : 'rgba(255,59,92,0.08)',
              border: 'none', color: stage.enabled ? 'var(--primary)' : 'var(--red)',
              cursor: 'pointer', fontFamily: 'DM Sans'
            }}>{stage.enabled ? 'ON' : 'OFF'}</button>

            {/* Remove custom stages */}
            {stage.id.startsWith('custom_') && (
              <button onClick={() => removeStage(i)} style={{
                background: 'none', border: 'none', color: 'var(--red)',
                cursor: 'pointer', fontSize: 14
              }}>×</button>
            )}
          </div>
        ))}
      </div>

      <button onClick={addStage} style={{
        width: '100%', padding: 10, borderRadius: 10, fontSize: 12, fontWeight: 700,
        background: 'var(--bg2)', border: '1px dashed var(--border2)',
        color: 'var(--text3)', cursor: 'pointer', fontFamily: 'DM Sans', marginBottom: 20
      }}>+ Add Custom Stage</button>

      {/* Scheduling Rules */}
      <div className="sec-hdr" style={{ marginTop: 8 }}>
        <div className="sec-title">Scheduling Rules</div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
        <label onClick={() => setScheduleRule('any')} style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px',
          borderRadius: 12, cursor: 'pointer',
          background: scheduleRule === 'any' ? 'rgba(0,212,160,0.06)' : 'var(--bg2)',
          border: `1px solid ${scheduleRule === 'any' ? 'rgba(0,212,160,0.2)' : 'var(--border)'}`
        }}>
          <div style={{
            width: 18, height: 18, borderRadius: '50%',
            border: `2px solid ${scheduleRule === 'any' ? 'var(--primary)' : 'var(--text3)'}`,
            background: scheduleRule === 'any' ? 'var(--primary)' : 'transparent',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 10, color: '#000'
          }}>{scheduleRule === 'any' ? '✓' : ''}</div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700 }}>Schedule any job</div>
            <div style={{ fontSize: 11, color: 'var(--text3)' }}>Jobs can be scheduled at any stage</div>
          </div>
        </label>

        <label onClick={() => setScheduleRule('accepted')} style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px',
          borderRadius: 12, cursor: 'pointer',
          background: scheduleRule === 'accepted' ? 'rgba(0,212,160,0.06)' : 'var(--bg2)',
          border: `1px solid ${scheduleRule === 'accepted' ? 'rgba(0,212,160,0.2)' : 'var(--border)'}`
        }}>
          <div style={{
            width: 18, height: 18, borderRadius: '50%',
            border: `2px solid ${scheduleRule === 'accepted' ? 'var(--primary)' : 'var(--text3)'}`,
            background: scheduleRule === 'accepted' ? 'var(--primary)' : 'transparent',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 10, color: '#000'
          }}>{scheduleRule === 'accepted' ? '✓' : ''}</div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700 }}>Only accepted jobs</div>
            <div style={{ fontSize: 11, color: 'var(--text3)' }}>Jobs must reach Active stage before scheduling</div>
          </div>
        </label>

        <label onClick={() => setScheduleRule('custom')} style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px',
          borderRadius: 12, cursor: 'pointer',
          background: scheduleRule === 'custom' ? 'rgba(0,212,160,0.06)' : 'var(--bg2)',
          border: `1px solid ${scheduleRule === 'custom' ? 'rgba(0,212,160,0.2)' : 'var(--border)'}`
        }}>
          <div style={{
            width: 18, height: 18, borderRadius: '50%',
            border: `2px solid ${scheduleRule === 'custom' ? 'var(--primary)' : 'var(--text3)'}`,
            background: scheduleRule === 'custom' ? 'var(--primary)' : 'transparent',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 10, color: '#000'
          }}>{scheduleRule === 'custom' ? '✓' : ''}</div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700 }}>Custom</div>
            <div style={{ fontSize: 11, color: 'var(--text3)' }}>Choose exactly which stages allow scheduling</div>
          </div>
        </label>
      </div>

      {(scheduleRule === 'accepted' || scheduleRule === 'custom') && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', letterSpacing: 1, marginBottom: 8 }}>
            {scheduleRule === 'custom' ? 'WHICH STAGES CAN BE SCHEDULED?' : 'WHICH STAGES COUNT AS "ACCEPTED"?'}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {stages.filter(s => s.enabled).map(stage => {
              const selected = acceptedStages.includes(stage.id)
              return (
                <div key={stage.id} onClick={() => {
                  setAcceptedStages(prev => selected ? prev.filter(s => s !== stage.id) : [...prev, stage.id])
                }} style={{
                  padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 700,
                  cursor: 'pointer',
                  background: selected ? stage.color + '18' : 'var(--bg2)',
                  border: `1px solid ${selected ? stage.color : 'var(--border)'}`,
                  color: selected ? stage.color : 'var(--text3)'
                }}>{stage.label}</div>
              )
            })}
          </div>
        </div>
      )}

      <button onClick={save} disabled={saving} className="btn btn-primary btn-full" style={{ marginTop: 8 }}>
        {saving ? 'Saving...' : 'Save Pipeline Settings'}
      </button>
    </div>
  )
}

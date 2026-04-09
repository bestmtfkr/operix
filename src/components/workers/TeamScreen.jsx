import { useState } from 'react'
import WorkersList from './WorkersList'
import TimeTracking from './TimeTracking'
import EquipmentList from '../equipment/EquipmentList'
import TeamGroups from './TeamGroups'

export default function TeamScreen() {
  const [view, setView] = useState('workers')

  const views = [
    { id: 'workers', label: 'Workers' },
    { id: 'teams', label: 'Teams' },
    { id: 'time', label: 'Time' },
    { id: 'equipment', label: 'Equipment' },
  ]

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Team & Resources</div>
        </div>
      </div>

      <div style={{
        display: 'flex', background: 'var(--card)', border: '1px solid var(--border)',
        borderRadius: 12, margin: '0 16px 8px', overflow: 'hidden'
      }}>
        {views.map(v => (
          <button key={v.id} onClick={() => setView(v.id)} style={{
            flex: 1, padding: 10, textAlign: 'center', fontSize: 11, fontWeight: 800,
            cursor: 'pointer', border: 'none', fontFamily: 'DM Sans',
            background: view === v.id ? 'rgba(0,212,160,0.1)' : 'none',
            color: view === v.id ? 'var(--primary)' : 'var(--text2)'
          }}>{v.label}</button>
        ))}
      </div>

      {view === 'workers' && <WorkersList hideHeader />}
      {view === 'teams' && <TeamGroups />}
      {view === 'time' && <TimeTracking />}
      {view === 'equipment' && <EquipmentList />}
    </div>
  )
}

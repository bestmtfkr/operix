import { useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import GlobalSearch from '../shared/GlobalSearch'
import NotificationCenter from '../shared/NotificationCenter'
import { canAccessModule } from '../../lib/permissions'
import './AppLayout.css'

const TABS = [
  { id: 'dashboard', icon: '📊', label: 'Home', module: 'dashboard' },
  { id: 'jobs', icon: '📋', label: 'Jobs', module: 'jobs' },
  { id: 'clients', icon: '👥', label: 'Clients', module: 'clients' },
  { id: 'billing', icon: '💰', label: 'Billing', module: 'billing' },
  { id: 'team', icon: '👷', label: 'Team', module: 'team' },
]

export default function AppLayout({ activeTab, onTabChange, children }) {
  const { profile, signOut } = useAuth()
  const [showSearch, setShowSearch] = useState(false)
  const [showNotifications, setShowNotifications] = useState(false)
  const name = profile?.full_name || 'User'
  const initial = name.charAt(0).toUpperCase()

  const h = new Date().getHours()
  const greeting = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'

  return (
    <div className="app-layout">
      {/* Global Search */}
      {showSearch && (
        <GlobalSearch
          onClose={() => setShowSearch(false)}
          onNavigate={(tab) => { setShowSearch(false); onTabChange(tab) }}
        />
      )}

      {/* Notifications */}
      {showNotifications && (
        <NotificationCenter
          onClose={() => setShowNotifications(false)}
          onNavigate={(tab) => { setShowNotifications(false); onTabChange(tab) }}
        />
      )}

      {/* Topbar */}
      <div className="topbar">
        <div className="topbar-left">
          <div className="topbar-greet">{greeting}</div>
          <div className="topbar-name">{name}</div>
        </div>
        <div className="topbar-right">
          <div className="icon-btn" onClick={() => setShowSearch(true)}>
            🔍
          </div>
          <div className="icon-btn" onClick={() => setShowNotifications(true)}>
            🔔
          </div>
          <div className="user-btn" onClick={() => onTabChange('profile')}>
            {initial}
          </div>
        </div>
      </div>

      {/* Live bar */}
      <div className="livebar">
        <div className="live-dot" />
        <div className="live-label">LIVE</div>
        <div className="live-time">
          {new Date().toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit' })} — data synced
        </div>
      </div>

      {/* Main content */}
      <div className="main-content">
        {children}
      </div>

      {/* Bottom tabs */}
      <div className="tabs">
        {TABS.filter(tab => canAccessModule(profile?.role || 'member', tab.module)).map(tab => (
          <div
            key={tab.id}
            className={`tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => onTabChange(tab.id)}
          >
            <div className="tab-ico">{tab.icon}</div>
            <div className="tab-lbl">{tab.label}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

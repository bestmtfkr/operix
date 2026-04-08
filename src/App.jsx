import { useState, lazy, Suspense } from 'react'
import { AuthProvider, useAuth } from './hooks/useAuth'
import { ToastProvider } from './components/shared/Toast'
import LoginScreen from './components/auth/LoginScreen'
import AppLayout from './components/layout/AppLayout'

// Lazy load heavy screens — only download when user navigates to them
const Dashboard = lazy(() => import('./components/dashboard/Dashboard'))
const ClientsList = lazy(() => import('./components/clients/ClientsList'))
const JobsList = lazy(() => import('./components/jobs/JobsList'))
const TeamScreen = lazy(() => import('./components/workers/TeamScreen'))
const BillingScreen = lazy(() => import('./components/billing/BillingScreen'))
const CompanySettings = lazy(() => import('./components/settings/CompanySettings'))
const OnboardingScreen = lazy(() => import('./components/auth/OnboardingScreen'))
const ReportsScreen = lazy(() => import('./components/reports/ReportsScreen'))

function LazyScreen({ children }) {
  return (
    <Suspense fallback={<div className="loading-center"><div className="spinner" /></div>}>
      {children}
    </Suspense>
  )
}

function AppContent() {
  const { user, profile, loading } = useAuth()
  const [activeTab, setActiveTab] = useState('dashboard')

  if (loading) {
    return (
      <div style={{
        height: '100vh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', background: 'var(--bg)'
      }}>
        <div style={{
          width: 90, height: 90, borderRadius: 24,
          background: 'linear-gradient(135deg, rgba(0,212,160,0.12), rgba(0,153,255,0.12))',
          border: '1px solid rgba(0,212,160,0.25)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginBottom: 22
        }}>
          <div style={{
            width: 36, height: 36,
            background: 'linear-gradient(135deg, var(--primary), var(--primary2))',
            transform: 'rotate(45deg)', borderRadius: 7
          }} />
        </div>
        <div style={{
          fontSize: 30, fontWeight: 800, letterSpacing: 7,
          background: 'linear-gradient(135deg, var(--primary), var(--primary2))',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent'
        }}>OPERIX</div>
        <div style={{ fontSize: 11, color: 'var(--text3)', letterSpacing: 3, marginTop: 6 }}>
          FACILITY INTELLIGENCE
        </div>
      </div>
    )
  }

  if (!user) return <LoginScreen />

  // User is logged in but has no profile — show onboarding
  if (user && !profile) {
    return <LazyScreen><OnboardingScreen user={user} onComplete={() => window.location.reload()} /></LazyScreen>
  }

  function renderScreen() {
    switch (activeTab) {
      case 'dashboard': return <LazyScreen><Dashboard onNavigate={setActiveTab} /></LazyScreen>
      case 'clients': return <LazyScreen><ClientsList /></LazyScreen>
      case 'jobs': return <LazyScreen><JobsList /></LazyScreen>
      case 'billing': return <LazyScreen><BillingScreen /></LazyScreen>
      case 'team': return <LazyScreen><TeamScreen /></LazyScreen>
      case 'inbox': return <ComingSoon title="Inbox" icon="📬" desc="AI Smart Inbox — building next" />
      case 'reports': return <LazyScreen><ReportsScreen /></LazyScreen>
      case 'profile': return <LazyScreen><CompanySettings onNavigate={setActiveTab} /></LazyScreen>
      default: return <LazyScreen><Dashboard onNavigate={setActiveTab} /></LazyScreen>
    }
  }

  return (
    <AppLayout activeTab={activeTab} onTabChange={setActiveTab}>
      {renderScreen()}
    </AppLayout>
  )
}

function ComingSoon({ title, icon, desc }) {
  return (
    <div className="empty-state" style={{ paddingTop: 80 }}>
      <div className="empty-icon">{icon}</div>
      <div className="empty-title">{title}</div>
      <div className="empty-sub">{desc}</div>
    </div>
  )
}

function ProfileScreen() {
  const { profile, signOut } = useAuth()
  return (
    <div>
      <div style={{
        background: 'linear-gradient(135deg, var(--card), var(--card2))',
        borderBottom: '1px solid var(--border)', padding: '24px 20px',
        display: 'flex', alignItems: 'center', gap: 18
      }}>
        <div style={{
          width: 68, height: 68, borderRadius: 20,
          background: 'linear-gradient(135deg, var(--primary), var(--primary2))',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 26, fontWeight: 800, color: '#000', flexShrink: 0
        }}>
          {(profile?.full_name || 'U').charAt(0).toUpperCase()}
        </div>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800 }}>{profile?.full_name}</div>
          <div style={{ fontSize: 13, color: 'var(--text2)', marginTop: 3 }}>{profile?.email}</div>
          <span className="badge green" style={{ marginTop: 8, display: 'inline-block' }}>
            {(profile?.role || 'member').toUpperCase()}
          </span>
        </div>
      </div>
      <div style={{ padding: 16 }}>
        <div className="card" style={{ cursor: 'default' }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>Company</div>
          <div style={{ fontSize: 13, color: 'var(--text2)', marginTop: 4 }}>
            {profile?.companies?.name || 'Not set'}
          </div>
        </div>
        <button className="btn btn-danger btn-full" style={{ marginTop: 16 }} onClick={signOut}>
          Sign Out
        </button>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <AppContent />
      </ToastProvider>
    </AuthProvider>
  )
}

import { useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import './LoginScreen.css'

export default function LoginScreen() {
  const { signIn, signUp, signInWithGoogle } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState('login') // 'login' or 'signup'

  async function handleSubmit(e) {
    e.preventDefault()
    if (!email || !password) {
      setError('Please enter your email and password.')
      return
    }
    if (mode === 'signup' && password.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }

    setError('')
    setSuccess('')
    setLoading(true)

    try {
      if (mode === 'signup') {
        await signUp(email, password)
        setSuccess('Account created! Check your email to confirm, then sign in.')
        setMode('login')
      } else {
        await signIn(email, password)
      }
    } catch (err) {
      setError(mode === 'signup'
        ? 'Error creating account. Email may already be in use.'
        : 'Incorrect email or password. Please try again.')
    }
    setLoading(false)
  }

  return (
    <div className="login-screen">
      <div className="login-logo">
        <div className="login-icon">
          <div className="login-diamond" />
        </div>
        <div className="login-wordmark">OPERIX</div>
        <div className="login-tagline">FACILITY INTELLIGENCE</div>
      </div>

      <form className="login-card" onSubmit={handleSubmit}>
        <h2>{mode === 'signup' ? 'Create Account' : 'Welcome back'}</h2>
        <p>{mode === 'signup'
          ? 'Sign up to start managing your operations.'
          : 'Sign in to your dashboard to manage operations.'
        }</p>

        <div className="form-field">
          <label className="form-label">Email</label>
          <input
            className="form-input"
            type="email"
            placeholder="your@email.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
            autoComplete="email"
          />
        </div>

        <div className="form-field">
          <label className="form-label">Password</label>
          <input
            className="form-input"
            type="password"
            placeholder={mode === 'signup' ? 'Min 6 characters' : 'Your password'}
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          />
        </div>

        <button className="btn btn-primary btn-full" type="submit" disabled={loading}>
          {loading ? (mode === 'signup' ? 'Creating account...' : 'Signing in...') :
            (mode === 'signup' ? 'Create Account' : 'Sign In →')}
        </button>

        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, margin: '18px 0',
          color: 'var(--text3)', fontSize: 11
        }}>
          <div style={{ flex: 1, height: 1, background: 'var(--border2)' }} />
          <span>OR</span>
          <div style={{ flex: 1, height: 1, background: 'var(--border2)' }} />
        </div>

        <button type="button" className="btn btn-secondary btn-full"
          onClick={signInWithGoogle} style={{ fontSize: 13 }}>
          Sign in with Google
        </button>

        <div style={{ textAlign: 'center', marginTop: 16, fontSize: 13, color: 'var(--text2)' }}>
          {mode === 'login' ? (
            <>Don't have an account? <span style={{ color: 'var(--primary)', cursor: 'pointer', fontWeight: 700 }}
              onClick={() => { setMode('signup'); setError(''); setSuccess('') }}>Sign Up</span></>
          ) : (
            <>Already have an account? <span style={{ color: 'var(--primary)', cursor: 'pointer', fontWeight: 700 }}
              onClick={() => { setMode('login'); setError(''); setSuccess('') }}>Sign In</span></>
          )}
        </div>

        {success && (
          <div style={{
            color: 'var(--green)', fontSize: 13, textAlign: 'center', marginTop: 14,
            padding: '10px 14px', background: 'rgba(0,212,160,0.08)', borderRadius: 10,
            border: '1px solid rgba(0,212,160,0.2)'
          }}>{success}</div>
        )}

        {error && <div className="login-error">{error}</div>}
      </form>
    </div>
  )
}

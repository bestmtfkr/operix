import { useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import './LoginScreen.css'

export default function LoginScreen() {
  const { signIn, signInWithGoogle } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleLogin(e) {
    e.preventDefault()
    if (!email || !password) {
      setError('Please enter your email and password.')
      return
    }

    setError('')
    setLoading(true)

    try {
      await signIn(email, password)
    } catch (err) {
      setError('Incorrect email or password. Please try again.')
      setLoading(false)
    }
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

      <form className="login-card" onSubmit={handleLogin}>
        <h2>Welcome back</h2>
        <p>Sign in to your dashboard to manage operations.</p>

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
            placeholder="Your password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </div>

        <button className="btn btn-primary btn-full" type="submit" disabled={loading}>
          {loading ? 'Signing in...' : 'Sign In →'}
        </button>

        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, margin: '20px 0',
          color: 'var(--text3)', fontSize: 12
        }}>
          <div style={{ flex: 1, height: 1, background: 'var(--border2)' }} />
          <span>OR</span>
          <div style={{ flex: 1, height: 1, background: 'var(--border2)' }} />
        </div>

        <button
          type="button"
          className="btn btn-secondary btn-full"
          onClick={signInWithGoogle}
          style={{ fontSize: 14 }}
        >
          Sign in with Google
        </button>

        {error && <div className="login-error">{error}</div>}
      </form>
    </div>
  )
}

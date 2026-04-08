import { Component } from 'react'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    console.error('App error:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          height: '100vh', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', padding: 40,
          background: 'var(--bg)', color: 'var(--text)', textAlign: 'center'
        }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>⚠️</div>
          <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 8 }}>Something went wrong</div>
          <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 24, lineHeight: 1.6 }}>
            {this.state.error?.message || 'An unexpected error occurred'}
          </div>
          <button onClick={() => { this.setState({ hasError: false }); window.location.reload() }} style={{
            padding: '12px 24px', borderRadius: 12,
            background: 'linear-gradient(135deg, var(--primary), var(--primary2))',
            border: 'none', color: '#000', fontSize: 14, fontWeight: 800,
            cursor: 'pointer', fontFamily: 'DM Sans'
          }}>Reload App</button>
        </div>
      )
    }
    return this.props.children
  }
}

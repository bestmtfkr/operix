import { useState } from 'react'
import { generateJobFromDescription } from '../../lib/ai'

export default function AIJobAssistant({ onResult, onClose }) {
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function analyze() {
    if (!input.trim()) return
    setLoading(true)
    setError('')

    const result = await generateJobFromDescription(input)
    if (result) {
      onResult(result)
    } else {
      setError('AI could not process this. Try adding more details.')
    }
    setLoading(false)
  }

  return (
    <div style={{
      background: 'rgba(0,212,160,0.04)', border: '1px solid rgba(0,212,160,0.2)',
      borderRadius: 16, padding: 16, marginBottom: 16
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <div style={{
          width: 28, height: 28, borderRadius: 8,
          background: 'linear-gradient(135deg, var(--primary), var(--primary2))',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14
        }}>🤖</div>
        <div>
          <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--primary)', letterSpacing: 0.5 }}>AI JOB ASSISTANT</div>
          <div style={{ fontSize: 10, color: 'var(--text3)' }}>Paste a call summary, email, or notes — AI fills the form</div>
        </div>
        <button onClick={onClose} style={{
          marginLeft: 'auto', background: 'none', border: 'none',
          color: 'var(--text3)', cursor: 'pointer', fontSize: 16
        }}>✕</button>
      </div>

      <textarea
        style={{
          width: '100%', background: 'var(--bg2)', border: '1px solid var(--border2)',
          borderRadius: 12, padding: '12px 14px', fontSize: 13, color: 'var(--text)',
          fontFamily: 'DM Sans', outline: 'none', resize: 'none', minHeight: 100,
          lineHeight: 1.6
        }}
        placeholder={"Paste anything here...\n\nExamples:\n• \"Got a call from John at Maple Properties about water damage in the basement at 123 Main St. Needs emergency service. Insurance claim #4892 with Intact.\"\n• Forward an email about a new job\n• Quick notes from a phone call"}
        value={input}
        onChange={e => setInput(e.target.value)}
      />

      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button
          onClick={analyze}
          disabled={loading || !input.trim()}
          style={{
            flex: 1, padding: 12, borderRadius: 10,
            background: loading ? 'var(--card2)' : 'linear-gradient(135deg, var(--primary), var(--primary2))',
            border: 'none', color: loading ? 'var(--text2)' : '#000',
            fontSize: 13, fontWeight: 800, cursor: loading ? 'default' : 'pointer',
            fontFamily: 'DM Sans', display: 'flex', alignItems: 'center',
            justifyContent: 'center', gap: 8
          }}
        >
          {loading ? (
            <><div className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> Analyzing...</>
          ) : (
            '🤖 Analyze & Fill Form'
          )}
        </button>
        <button onClick={() => setInput('')} style={{
          padding: '12px 16px', borderRadius: 10, background: 'var(--card2)',
          border: '1px solid var(--border)', color: 'var(--text2)', fontSize: 12,
          fontWeight: 700, cursor: 'pointer', fontFamily: 'DM Sans'
        }}>Clear</button>
      </div>

      {error && (
        <div style={{
          color: 'var(--red)', fontSize: 12, marginTop: 8,
          padding: '8px 12px', background: 'rgba(255,59,92,0.08)',
          borderRadius: 8, border: '1px solid rgba(255,59,92,0.2)'
        }}>{error}</div>
      )}
    </div>
  )
}

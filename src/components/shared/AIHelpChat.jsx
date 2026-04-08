import { useState, useRef, useEffect } from 'react'
import { askAI } from '../../lib/ai'
import { useAuth } from '../../hooks/useAuth'

export default function AIHelpChat({ onClose }) {
  const { profile } = useAuth()
  const [messages, setMessages] = useState([
    { role: 'ai', text: `Hey ${profile?.full_name?.split(' ')[0] || 'there'}! 👋\n\nI'm your Operix assistant. Ask me anything:\n\n• How to use a feature\n• Help creating jobs or invoices\n• Troubleshooting\n• Tips & shortcuts` }
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const chatRef = useRef(null)

  useEffect(() => {
    chatRef.current?.scrollTo(0, chatRef.current.scrollHeight)
  }, [messages])

  async function send() {
    if (!input.trim() || loading) return
    const userMsg = input.trim()
    setInput('')
    setMessages(prev => [...prev, { role: 'user', text: userMsg }])
    setLoading(true)

    const context = messages.slice(-6).map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`).join('\n')

    const result = await askAI(
      `${context}\nUser: ${userMsg}`,
      `You are the AI help assistant for Operix, a facility management and restoration SaaS platform.
You help users navigate the app and answer questions about features.

The app has these modules:
- Dashboard: revenue, pipeline breakdown, weekly stats, tasks due
- Jobs: create jobs linked to clients, pipeline kanban (lead→quoted→active→completed→invoiced→closed), calendar view, tasks view
- Clients: manage client contacts, see their full job/invoice history
- Billing: invoices with line items and tax (GST+QST for Quebec), quotes that convert to invoices, PDF generation
- Team: workers with hourly rates, time tracking with approval, equipment tracking
- Inbox: AI-powered email analysis, Gmail integration, email-to-job linking
- Settings: company info, tax rates, invoice numbering
- Reports: revenue by client, worker productivity, invoice aging, pipeline by stage

Users can also use AI to auto-fill job forms by pasting call summaries or emails.

Be helpful, concise, and friendly. Keep answers short — 2-3 sentences max unless they ask for detail.
Answer in the same language the user writes in (English or French).`,
      512, 'haiku'
    )

    setMessages(prev => [...prev, { role: 'ai', text: result || "Sorry, couldn't process that. Try again or contact support." }])
    setLoading(false)
  }

  return (
    <div style={{
      position: 'fixed',
      bottom: 'calc(56px + env(safe-area-inset-bottom, 0px) + 12px)',
      left: 12, right: 12,
      maxWidth: 380,
      height: 440,
      maxHeight: 'calc(100vh - 56px - env(safe-area-inset-top, 44px) - env(safe-area-inset-bottom, 0px) - 80px)',
      background: 'var(--bg)', border: '1px solid var(--border2)',
      borderRadius: 24, display: 'flex', flexDirection: 'column',
      boxShadow: '0 20px 60px rgba(0,0,0,0.6)', zIndex: 200, overflow: 'hidden'
    }}>
      {/* Header */}
      <div style={{
        padding: '16px 18px', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: 'linear-gradient(135deg, rgba(0,212,160,0.08), rgba(0,153,255,0.06))',
        flexShrink: 0
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 34, height: 34, borderRadius: 10,
            background: 'linear-gradient(135deg, var(--primary), var(--primary2))',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18
          }}>🤖</div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 800 }}>Operix AI</div>
            <div style={{ fontSize: 10, color: 'var(--primary)', fontWeight: 600 }}>Online · Ready to help</div>
          </div>
        </div>
        <button onClick={onClose} style={{
          background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10,
          width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', fontSize: 14, color: 'var(--text2)'
        }}>✕</button>
      </div>

      {/* Messages */}
      <div ref={chatRef} style={{
        flex: 1, overflow: 'auto', padding: 14,
        display: 'flex', flexDirection: 'column', gap: 10,
        WebkitOverflowScrolling: 'touch'
      }}>
        {messages.map((m, i) => (
          <div key={i} style={{
            alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
            maxWidth: '85%',
          }}>
            {m.role === 'ai' && (
              <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 4, fontWeight: 600 }}>Operix AI</div>
            )}
            <div style={{
              padding: '12px 16px',
              borderRadius: m.role === 'user' ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
              background: m.role === 'user'
                ? 'linear-gradient(135deg, var(--primary), var(--primary2))'
                : 'var(--card)',
              border: m.role === 'user' ? 'none' : '1px solid var(--border)',
              color: m.role === 'user' ? '#000' : 'var(--text)',
              fontSize: 14, lineHeight: 1.6, fontWeight: m.role === 'user' ? 600 : 400,
              whiteSpace: 'pre-wrap'
            }}>
              {m.text}
            </div>
          </div>
        ))}
        {loading && (
          <div style={{ alignSelf: 'flex-start' }}>
            <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 4, fontWeight: 600 }}>Operix AI</div>
            <div style={{
              padding: '12px 16px', background: 'var(--card)', border: '1px solid var(--border)',
              borderRadius: '18px 18px 18px 4px',
              display: 'flex', alignItems: 'center', gap: 8
            }}>
              <div className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
              <span style={{ fontSize: 12, color: 'var(--text3)' }}>Thinking...</span>
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div style={{
        padding: 12, borderTop: '1px solid var(--border)',
        display: 'flex', gap: 8, flexShrink: 0,
        background: 'var(--bg)'
      }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') send() }}
          placeholder="Ask anything..."
          style={{
            flex: 1, background: 'var(--card)', border: '1px solid var(--border)',
            borderRadius: 14, padding: '12px 16px', fontSize: 14, color: 'var(--text)',
            outline: 'none', fontFamily: 'DM Sans'
          }}
        />
        <button onClick={send} disabled={loading} style={{
          width: 42, height: 42, borderRadius: 14,
          background: input.trim() ? 'linear-gradient(135deg, var(--primary), var(--primary2))' : 'var(--card)',
          border: input.trim() ? 'none' : '1px solid var(--border)',
          cursor: 'pointer', display: 'flex',
          alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0,
          color: input.trim() ? '#000' : 'var(--text3)',
          transition: 'all 0.2s'
        }}>→</button>
      </div>
    </div>
  )
}

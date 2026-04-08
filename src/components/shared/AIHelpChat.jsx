import { useState, useRef, useEffect } from 'react'
import { askAI } from '../../lib/ai'
import { useAuth } from '../../hooks/useAuth'

export default function AIHelpChat({ onClose }) {
  const { profile } = useAuth()
  const [messages, setMessages] = useState([
    { role: 'ai', text: `Hi ${profile?.full_name?.split(' ')[0] || 'there'}! I'm your Operix AI assistant. I can help you with:\n\n• How to use any feature\n• Creating jobs, invoices, quotes\n• Understanding your dashboard\n• Troubleshooting issues\n\nWhat do you need help with?` }
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

Be helpful, concise, and friendly. If the user has a bug or feature request, suggest they contact the admin.
Answer in the same language the user writes in (English or French).`,
      512
    )

    setMessages(prev => [...prev, { role: 'ai', text: result || "Sorry, I couldn't process that. Try again or contact support." }])
    setLoading(false)
  }

  return (
    <div style={{
      position: 'fixed',
      bottom: 'calc(56px + env(safe-area-inset-bottom, 0px) + 12px)',
      right: 12, width: 340, maxWidth: 'calc(100vw - 24px)',
      height: 420, maxHeight: 'calc(100vh - 56px - env(safe-area-inset-top, 44px) - env(safe-area-inset-bottom, 0px) - 80px)',
      background: 'var(--card)', border: '1px solid var(--border2)',
      borderRadius: 20, display: 'flex', flexDirection: 'column',
      boxShadow: '0 16px 48px rgba(0,0,0,0.5)', zIndex: 200, overflow: 'hidden'
    }}>
      {/* Header */}
      <div style={{
        padding: '14px 16px', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: 'linear-gradient(135deg, rgba(0,212,160,0.06), rgba(0,153,255,0.06))'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 28, height: 28, borderRadius: 8,
            background: 'linear-gradient(135deg, var(--primary), var(--primary2))',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14
          }}>🤖</div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 800 }}>Operix AI</div>
            <div style={{ fontSize: 10, color: 'var(--text3)' }}>Help & Support</div>
          </div>
        </div>
        <button onClick={onClose} style={{
          background: 'none', border: 'none', color: 'var(--text3)',
          cursor: 'pointer', fontSize: 18
        }}>✕</button>
      </div>

      {/* Messages */}
      <div ref={chatRef} style={{ flex: 1, overflow: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {messages.map((m, i) => (
          <div key={i} style={{
            alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
            maxWidth: '85%',
            padding: '10px 14px', borderRadius: 14,
            background: m.role === 'user' ? 'linear-gradient(135deg, var(--primary), var(--primary2))' : 'var(--bg2)',
            color: m.role === 'user' ? '#000' : 'var(--text2)',
            fontSize: 13, lineHeight: 1.5, fontWeight: m.role === 'user' ? 600 : 400,
            whiteSpace: 'pre-wrap'
          }}>
            {m.text}
          </div>
        ))}
        {loading && (
          <div style={{ alignSelf: 'flex-start', padding: '10px 14px', background: 'var(--bg2)', borderRadius: 14 }}>
            <div className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
          </div>
        )}
      </div>

      {/* Input */}
      <div style={{ padding: 10, borderTop: '1px solid var(--border)', display: 'flex', gap: 8 }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') send() }}
          placeholder="Ask anything..."
          style={{
            flex: 1, background: 'var(--bg2)', border: '1px solid var(--border2)',
            borderRadius: 10, padding: '10px 14px', fontSize: 13, color: 'var(--text)',
            outline: 'none', fontFamily: 'DM Sans'
          }}
        />
        <button onClick={send} disabled={loading} style={{
          width: 38, height: 38, borderRadius: 10,
          background: 'linear-gradient(135deg, var(--primary), var(--primary2))',
          border: 'none', cursor: 'pointer', display: 'flex',
          alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0
        }}>→</button>
      </div>
    </div>
  )
}

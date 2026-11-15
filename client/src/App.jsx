import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'

const SUGGESTIONS = [
  "What's the weather in Lisbon this week?",
  'Plan a 3-day food trip to Tokyo',
  "I'm vegetarian and on a mid-range budget",
  'Do US citizens need a visa for Vietnam?',
]

const TOOL_LABELS = {
  web_search: '🔎 Web search',
  weather_lookup: '🌦️ Weather',
  save_user_preference: '💾 Saved preference',
}

function newThreadId() {
  return crypto.randomUUID()
}

export default function App() {
  const [threadId, setThreadId] = useState(() => {
    const saved = localStorage.getItem('threadId')
    return saved || newThreadId()
  })
  const [messages, setMessages] = useState([])
  const [preferences, setPreferences] = useState({})
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const endRef = useRef(null)

  useEffect(() => {
    localStorage.setItem('threadId', threadId)
    fetch(`/api/preferences/${threadId}`)
      .then((r) => r.json())
      .then((d) => setPreferences(d.preferences || {}))
      .catch(() => {})
  }, [threadId])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  async function send(text) {
    const message = text.trim()
    if (!message || loading) return
    setInput('')
    setMessages((m) => [...m, { role: 'user', content: message }])
    setLoading(true)
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, threadId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Request failed')
      setMessages((m) => [
        ...m,
        { role: 'assistant', content: data.reply, tools: data.toolsUsed },
      ])
      setPreferences(data.preferences || {})
    } catch (err) {
      setMessages((m) => [
        ...m,
        { role: 'assistant', content: `⚠️ ${err.message}`, error: true },
      ])
    } finally {
      setLoading(false)
    }
  }

  function resetChat() {
    setMessages([])
    setPreferences({})
    setThreadId(newThreadId())
  }

  const prefEntries = Object.entries(preferences)

  return (
    <div className="layout">
      <aside className="sidebar">
        <h1>✈️ Wanderlust</h1>
        <p className="tagline">Your AI travel agent</p>
        <button className="new-chat" onClick={resetChat}>+ New conversation</button>
        <h2>Your preferences</h2>
        {prefEntries.length === 0 ? (
          <p className="muted">
            Tell me about your budget, home city, interests or diet and I'll remember them.
          </p>
        ) : (
          <ul className="prefs">
            {prefEntries.map(([k, v]) => (
              <li key={k}>
                <span>{k.replace(/_/g, ' ')}</span>
                <strong>{v}</strong>
              </li>
            ))}
          </ul>
        )}
        <p className="muted small">Thread: {threadId.slice(0, 8)}</p>
      </aside>

      <main className="chat">
        <div className="messages">
          {messages.length === 0 && (
            <div className="welcome">
              <h2>Where to next?</h2>
              <p>Ask about destinations, itineraries, visas or the weather anywhere.</p>
              <div className="suggestions">
                {SUGGESTIONS.map((s) => (
                  <button key={s} onClick={() => send(s)}>{s}</button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`msg ${m.role} ${m.error ? 'error' : ''}`}>
              {m.tools?.length > 0 && (
                <div className="tools">
                  {m.tools.map((t) => (
                    <span key={t} className="chip">{TOOL_LABELS[t] || t}</span>
                  ))}
                </div>
              )}
              <div className="bubble">
                {m.role === 'assistant' ? (
                  <ReactMarkdown
                    components={{ a: (props) => <a {...props} target="_blank" rel="noreferrer" /> }}
                  >
                    {m.content}
                  </ReactMarkdown>
                ) : (
                  m.content
                )}
              </div>
            </div>
          ))}
          {loading && (
            <div className="msg assistant">
              <div className="bubble typing"><span /><span /><span /></div>
            </div>
          )}
          <div ref={endRef} />
        </div>

        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault()
            send(input)
          }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask me anything about travel…"
            disabled={loading}
          />
          <button type="submit" disabled={loading || !input.trim()}>Send</button>
        </form>
      </main>
    </div>
  )
}

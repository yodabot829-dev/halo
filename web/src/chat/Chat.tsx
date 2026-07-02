import { useEffect, useRef, useState } from 'react'
import type { ModelEntry } from '../api'
import { fetchModels } from '../api'
import { useChat } from './useChat'

export function Chat() {
  const { messages, streaming, error, send, stop } = useChat()
  const [models, setModels] = useState<ModelEntry[]>([])
  const [override, setOverride] = useState('')
  const [draft, setDraft] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetchModels().then(setModels).catch(console.error)
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const submit = () => {
    const text = draft.trim()
    if (!text || streaming) return
    setDraft('')
    void send(text, override || undefined)
  }

  return (
    <>
      <div className="messages">
        {messages.length === 0 && (
          <div className="empty">
            <div className="halo-ring" />
            <p>
              HALO online.
              <br />
              Ask anything — the right model answers.
            </p>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            {m.meta && (
              <span className="chip" title={m.meta.reason}>
                <b>{m.meta.label}</b> {m.meta.taskClass}
              </span>
            )}
            <div className="bubble">{m.content || (streaming ? '…' : '')}</div>
          </div>
        ))}
        {error && <div className="error">{error}</div>}
        <div ref={bottomRef} />
      </div>

      <div className="composer">
        <select value={override} onChange={(e) => setOverride(e.target.value)}>
          <option value="">Auto</option>
          {models
            .filter((m) => m.available)
            .map((m) => (
              <option key={m.ref} value={m.ref}>
                {m.label}
              </option>
            ))}
        </select>
        <textarea
          value={draft}
          placeholder="Message HALO"
          rows={1}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              submit()
            }
          }}
        />
        {streaming ? (
          <button onClick={stop}>Stop</button>
        ) : (
          <button onClick={submit} disabled={!draft.trim()}>
            Send
          </button>
        )}
      </div>
    </>
  )
}

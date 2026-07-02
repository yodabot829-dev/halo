import { useEffect, useRef, useState } from 'react'
import type { ModelEntry } from '../api'
import { fetchModels } from '../api'
import { useChat } from './useChat'
import { useVoice } from './useVoice'

export function Chat() {
  const { messages, streaming, error, send, stop } = useChat()
  const { micState, voiceError, startRecording, stopRecording, speak } = useVoice()
  const [models, setModels] = useState<ModelEntry[]>([])
  const [override, setOverride] = useState('')
  const [draft, setDraft] = useState('')
  const [speakReplies, setSpeakReplies] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const spokenCountRef = useRef(0)

  useEffect(() => {
    fetchModels().then(setModels).catch(console.error)
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Speak each assistant reply once, when its stream completes.
  useEffect(() => {
    if (streaming || !speakReplies) return
    if (messages.length <= spokenCountRef.current) return
    const last = messages[messages.length - 1]
    if (last?.role === 'assistant' && last.content) {
      spokenCountRef.current = messages.length
      void speak(last.content)
    }
  }, [streaming, messages, speakReplies, speak])

  const submit = (text = draft) => {
    const trimmed = text.trim()
    if (!trimmed || streaming) return
    setDraft('')
    void send(trimmed, override || undefined)
  }

  const toggleMic = async () => {
    if (micState === 'recording') {
      const text = await stopRecording()
      if (text) submit(text)
    } else if (micState === 'idle') {
      await startRecording()
    }
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
              Type, or hold the mic and talk.
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
        {(error ?? voiceError) && <div className="error">{error ?? voiceError}</div>}
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
          placeholder={micState === 'recording' ? 'Listening…' : 'Message HALO'}
          rows={1}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              submit()
            }
          }}
        />
        <button
          className={`mic${micState === 'recording' ? ' live' : ''}`}
          title={speakReplies ? 'Voice on (replies spoken)' : 'Push to talk'}
          onClick={() => void toggleMic()}
          disabled={micState === 'transcribing'}
        >
          {micState === 'recording' ? '◉' : micState === 'transcribing' ? '…' : '🎙'}
        </button>
        <button
          className={`mic${speakReplies ? ' live' : ''}`}
          title="Speak replies aloud"
          onClick={() => setSpeakReplies((s) => !s)}
        >
          {speakReplies ? '🔊' : '🔇'}
        </button>
        {streaming ? (
          <button onClick={stop}>Stop</button>
        ) : (
          <button onClick={() => submit()} disabled={!draft.trim()}>
            Send
          </button>
        )}
      </div>
    </>
  )
}

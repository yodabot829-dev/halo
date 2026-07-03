import { useEffect, useState } from 'react'
import { apiFetch } from '../api'
import { Chat } from '../chat/Chat'
import { useVoice } from '../chat/useVoice'
import { useTerminalSpeech } from './useTerminalSpeech'
import { killTerminal, useTerminalSocket } from './useTerminalSocket'

const STATUS_LABEL = {
  connecting: 'connecting…',
  live: 'live',
  closed: 'disconnected',
  exited: 'shell exited',
} as const

// British male Kokoro voice — the terminal's "Jarvis". Chat keeps Cortana
// (af_sky) via the global config; only these auto-reads use this voice.
const JARVIS_VOICE = 'bm_george'

function TerminalPane({ project }: { project: string }) {
  const [container, setContainer] = useState<HTMLElement | null>(null)
  // Bumping the epoch swaps the keyed container div, which remounts the
  // socket+xterm pair: reconnect / fresh attach.
  const [epoch, setEpoch] = useState(0)
  const { voiceError, speak } = useVoice()
  const { speakOn, toggleSpeak, handleOutput } = useTerminalSpeech((t) => speak(t, JARVIS_VOICE))
  const { status } = useTerminalSocket(project, container, handleOutput)

  return (
    <div className="term-pane">
      <div className="term-bar">
        <span className={`term-status term-${status}`}>{STATUS_LABEL[status]}</span>
        <span className="term-actions">
          <span className="term-hint" title="Claude Code's built-in dictation — run it inside the session below">
            🎙 type /voice to dictate
          </span>
          <button
            className={`ghost${speakOn ? ' term-live' : ''}`}
            title="Read command output aloud when it finishes"
            onClick={toggleSpeak}
          >
            {speakOn ? '🔊' : '🔇'} Speak
          </button>
          {(status === 'closed' || status === 'exited') && (
            <button className="ghost" onClick={() => setEpoch((e) => e + 1)}>
              ↻ Reconnect
            </button>
          )}
          <button
            className="ghost"
            onClick={() => killTerminal(project).then(() => setEpoch((e) => e + 1))}
          >
            ✕ Kill shell
          </button>
        </span>
      </div>
      {voiceError && <div className="term-voice-error">{voiceError}</div>}
      <div key={epoch} className="term-screen" ref={setContainer} />
    </div>
  )
}

type Mode = 'terminal' | 'voice'

export function Terminal({ scope, onScopeChange }: { scope: string; onScopeChange: (name: string) => void }) {
  const [projects, setProjects] = useState<string[]>([])
  // Terminal = interactive Claude TUI (silent, full visuals).
  // Voice = a talking Claude console (streams clean replies, Cortana reads them).
  const [mode, setMode] = useState<Mode>('terminal')

  useEffect(() => {
    apiFetch('/api/projects/names')
      .then((r) => r.json())
      .then((b: { data: string[] }) => {
        setProjects(b.data)
        if (!scope && b.data[0]) onScopeChange(b.data[0])
      })
      .catch(console.error)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="terminal-view">
      <div className="term-topbar">
        <div className="term-picker">
          {projects.map((name) => (
            <button
              key={name}
              className={`chip term-chip${name === scope ? ' active' : ''}`}
              onClick={() => onScopeChange(name)}
            >
              {name}
            </button>
          ))}
        </div>
        <div className="term-mode">
          <button
            className={mode === 'terminal' ? 'active' : ''}
            onClick={() => setMode('terminal')}
            title="Interactive Claude session (silent, full TUI)"
          >
            🖥 Terminal
          </button>
          <button
            className={mode === 'voice' ? 'active' : ''}
            onClick={() => setMode('voice')}
            title="Talking Claude — dictate and hear replies read aloud"
          >
            🎙 Voice
          </button>
        </div>
      </div>
      {!scope ? (
        <p className="detail-sub">No projects registered.</p>
      ) : mode === 'voice' ? (
        <Chat key={`voice-${scope}`} scope={scope} onScopeChange={onScopeChange} speakByDefault />
      ) : (
        <TerminalPane key={scope} project={scope} />
      )}
    </div>
  )
}

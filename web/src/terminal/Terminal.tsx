import { useEffect, useState } from 'react'
import { apiFetch } from '../api'
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
  const { micState, voiceError, startRecording, stopRecording, speak } = useVoice()
  const { speakOn, toggleSpeak, handleOutput } = useTerminalSpeech((t) => speak(t, JARVIS_VOICE))
  const { status, sendInput } = useTerminalSocket(project, container, handleOutput)

  // Push-to-talk: click to record, click to stop → the transcript is sent to
  // the Claude session (Enter appended) so you're talking to it, not leaving
  // an unsent line at the prompt.
  const onMic = async () => {
    if (micState === 'recording') {
      const text = await stopRecording()
      if (text) sendInput(`${text}\r`)
    } else if (micState === 'idle') {
      await startRecording()
    }
  }
  const micGlyph = micState === 'recording' ? '◉' : micState === 'transcribing' ? '…' : '🎙'

  return (
    <div className="term-pane">
      <div className="term-bar">
        <span className={`term-status term-${status}`}>{STATUS_LABEL[status]}</span>
        <span className="term-actions">
          <button
            className={`ghost${micState === 'recording' ? ' term-live' : ''}`}
            title="Push to talk — dictate a command"
            disabled={micState === 'transcribing'}
            onClick={() => void onMic()}
          >
            {micGlyph} Dictate
          </button>
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

export function Terminal({ scope, onScopeChange }: { scope: string; onScopeChange: (name: string) => void }) {
  const [projects, setProjects] = useState<string[]>([])

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
      {scope ? (
        <TerminalPane key={scope} project={scope} />
      ) : (
        <p className="detail-sub">No projects registered.</p>
      )}
    </div>
  )
}

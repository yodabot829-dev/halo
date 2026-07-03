import { useEffect, useState } from 'react'
import { apiFetch } from '../api'
import { killTerminal, useTerminalSocket } from './useTerminalSocket'

const STATUS_LABEL = {
  connecting: 'connecting…',
  live: 'live',
  closed: 'disconnected',
  exited: 'shell exited',
} as const

function TerminalPane({ project }: { project: string }) {
  const [container, setContainer] = useState<HTMLElement | null>(null)
  // Bumping the epoch swaps the keyed container div, which remounts the
  // socket+xterm pair: reconnect / fresh attach.
  const [epoch, setEpoch] = useState(0)
  const { status } = useTerminalSocket(project, container)

  return (
    <div className="term-pane">
      <div className="term-bar">
        <span className={`term-status term-${status}`}>{STATUS_LABEL[status]}</span>
        <span className="term-actions">
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

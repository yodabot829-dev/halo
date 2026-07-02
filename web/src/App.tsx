import { useState } from 'react'
import { Board } from './actions/Board'
import { Chat } from './chat/Chat'
import { Goals } from './goals/Goals'
import { Memory } from './memory/Memory'
import { Ops } from './ops/Ops'
import { ProjectDetail } from './projects/ProjectDetail'
import { Projects } from './projects/Projects'

const VIEWS = ['Chat', 'Board', 'Projects', 'Goals', 'Memory', 'Ops'] as const
type View = (typeof VIEWS)[number]

export function App() {
  const [view, setView] = useState<View>('Chat')
  const [project, setProject] = useState<string | null>(null)

  const open = (v: View) => {
    setProject(null)
    setView(v)
  }

  return (
    <div className="app">
      <header className="header">
        <span className="wordmark">HALO</span>
        <nav className="nav">
          {VIEWS.map((v) => (
            <button
              key={v}
              className={`nav-item${view === v && !project ? ' active' : ''}`}
              onClick={() => open(v)}
            >
              {v}
            </button>
          ))}
        </nav>
        <span className="sub">Cortana · multi-model</span>
      </header>
      {project ? (
        <ProjectDetail name={project} onBack={() => setProject(null)} />
      ) : view === 'Chat' ? (
        <Chat />
      ) : view === 'Board' ? (
        <Board />
      ) : view === 'Projects' ? (
        <Projects onOpen={setProject} />
      ) : view === 'Goals' ? (
        <Goals />
      ) : view === 'Memory' ? (
        <Memory onOpenProject={setProject} />
      ) : (
        <Ops />
      )}
    </div>
  )
}

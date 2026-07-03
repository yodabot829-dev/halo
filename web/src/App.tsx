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
  // Chat scope is lifted here so opening a project's chat can pre-set it.
  const [chatScope, setChatScope] = useState('')

  const open = (v: View) => {
    setProject(null)
    setView(v)
  }

  const chatAboutProject = (name: string) => {
    setChatScope(name)
    setProject(null)
    setView('Chat')
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
        <ProjectDetail
          name={project}
          onBack={() => setProject(null)}
          onChat={chatAboutProject}
        />
      ) : view === 'Chat' ? (
        <Chat scope={chatScope} onScopeChange={setChatScope} />
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

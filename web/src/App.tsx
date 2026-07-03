import { useState } from 'react'
import { Board } from './actions/Board'
import { Chat } from './chat/Chat'
import { Goals } from './goals/Goals'
import { Memory } from './memory/Memory'
import { Ops } from './ops/Ops'
import { ProjectDetail } from './projects/ProjectDetail'
import { Projects } from './projects/Projects'
import { Terminal } from './terminal/Terminal'

const VIEWS = ['Chat', 'Board', 'Projects', 'Terminal', 'Goals', 'Memory', 'Ops'] as const
type View = (typeof VIEWS)[number]

export function App() {
  const [view, setView] = useState<View>('Chat')
  const [project, setProject] = useState<string | null>(null)
  // Chat/terminal scopes are lifted here so a project page can pre-set them.
  const [chatScope, setChatScope] = useState('')
  const [terminalScope, setTerminalScope] = useState('')

  const open = (v: View) => {
    setProject(null)
    setView(v)
  }

  const chatAboutProject = (name: string) => {
    setChatScope(name)
    setProject(null)
    setView('Chat')
  }

  const openTerminal = (name: string) => {
    setTerminalScope(name)
    setProject(null)
    setView('Terminal')
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
          onTerminal={openTerminal}
        />
      ) : view === 'Chat' ? (
        <Chat scope={chatScope} onScopeChange={setChatScope} />
      ) : view === 'Board' ? (
        <Board />
      ) : view === 'Projects' ? (
        <Projects onOpen={setProject} />
      ) : view === 'Terminal' ? (
        <Terminal scope={terminalScope} onScopeChange={setTerminalScope} />
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

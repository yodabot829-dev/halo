import { useState } from 'react'
import { Chat } from './chat/Chat'
import { Goals } from './goals/Goals'
import { Memory } from './memory/Memory'
import { Ops } from './ops/Ops'
import { Projects } from './projects/Projects'

const VIEWS = ['Chat', 'Projects', 'Goals', 'Memory', 'Ops'] as const
type View = (typeof VIEWS)[number]

const VIEW_COMPONENTS: Record<View, () => React.JSX.Element> = {
  Chat,
  Projects,
  Goals,
  Memory,
  Ops,
}

export function App() {
  const [view, setView] = useState<View>('Chat')

  return (
    <div className="app">
      <header className="header">
        <span className="wordmark">HALO</span>
        <nav className="nav">
          {VIEWS.map((v) => (
            <button
              key={v}
              className={`nav-item${view === v ? ' active' : ''}`}
              onClick={() => setView(v)}
            >
              {v}
            </button>
          ))}
        </nav>
        <span className="sub">Cortana · multi-model</span>
      </header>
      {(() => {
        const Active = VIEW_COMPONENTS[view]
        return <Active />
      })()}
    </div>
  )
}

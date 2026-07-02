import { useState } from 'react'
import { Chat } from './chat/Chat'
import { Goals } from './goals/Goals'
import { Ops } from './ops/Ops'

const VIEWS = ['Chat', 'Goals', 'Ops'] as const
type View = (typeof VIEWS)[number]

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
      {view === 'Chat' ? <Chat /> : view === 'Goals' ? <Goals /> : <Ops />}
    </div>
  )
}

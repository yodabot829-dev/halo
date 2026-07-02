import { Chat } from './chat/Chat'

export function App() {
  return (
    <div className="app">
      <header className="header">
        <span className="wordmark">HALO</span>
        <span className="sub">Cortana · multi-model</span>
      </header>
      <Chat />
    </div>
  )
}

import { useCallback, useEffect, useRef, useState } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { apiFetch } from '../api'

export type TerminalStatus = 'connecting' | 'live' | 'closed' | 'exited'

/**
 * Owns one xterm instance bound to /ws/terminal/:project. The PTY lives
 * server-side and survives disconnects; this hook only attaches to it.
 * First frame carries the bearer token (browsers can't set an Authorization
 * header on a WebSocket); the server ignores it when auth is off.
 */
export function useTerminalSocket(
  project: string,
  container: HTMLElement | null,
  onOutput?: (chunk: string) => void,
) {
  const [status, setStatus] = useState<TerminalStatus>('connecting')
  const socketRef = useRef<WebSocket | null>(null)
  const termRef = useRef<XTerm | null>(null)
  // Latest onOutput without re-subscribing the socket each render.
  const onOutputRef = useRef(onOutput)
  onOutputRef.current = onOutput

  useEffect(() => {
    if (!container) return
    setStatus('connecting')

    const term = new XTerm({
      fontFamily: 'SF Mono, Menlo, monospace',
      fontSize: 13,
      theme: { background: '#0b0e14' },
      scrollback: 5000,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(container)
    fit.fit()
    termRef.current = term

    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const socket = new WebSocket(`${proto}://${location.host}/ws/terminal/${encodeURIComponent(project)}`)
    socketRef.current = socket
    const send = (payload: Record<string, unknown>) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload))
    }

    socket.onopen = () => {
      const token = localStorage.getItem('halo_token')
      if (token) send({ type: 'auth', token })
      send({ type: 'resize', cols: term.cols, rows: term.rows })
    }
    socket.onmessage = (event) => {
      const frame = JSON.parse(event.data as string) as Record<string, unknown>
      if (frame['type'] === 'ready') {
        setStatus('live')
        if (typeof frame['replay'] === 'string' && frame['replay']) term.write(frame['replay'])
      } else if (frame['type'] === 'data') {
        const data = frame['data'] as string
        term.write(data)
        onOutputRef.current?.(data)
      } else if (frame['type'] === 'exit') {
        setStatus('exited')
        term.write(`\r\n[shell exited: ${String(frame['code'])}]\r\n`)
      } else if (frame['type'] === 'error') {
        setStatus('closed')
        term.write(`\r\n[error: ${String(frame['message'])}]\r\n`)
      }
    }
    socket.onclose = () => setStatus((s) => (s === 'exited' ? s : 'closed'))

    const onData = term.onData((data) => send({ type: 'input', data }))
    const onResize = term.onResize(({ cols, rows }) => send({ type: 'resize', cols, rows }))
    const refit = () => fit.fit()
    window.addEventListener('resize', refit)

    return () => {
      window.removeEventListener('resize', refit)
      onData.dispose()
      onResize.dispose()
      socket.close()
      term.dispose()
      socketRef.current = null
      termRef.current = null
    }
  }, [project, container])

  // Inject text as if typed (dictation). No trailing Enter — the user reviews
  // and runs it. Refocus the terminal so their Enter lands there.
  const sendInput = useCallback((text: string) => {
    const socket = socketRef.current
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'input', data: text }))
      termRef.current?.focus()
    }
  }, [])

  return { status, sendInput }
}

/** Ask the daemon to kill the project's PTY (next attach spawns fresh). */
export async function killTerminal(project: string): Promise<void> {
  await apiFetch(`/api/terminal/${encodeURIComponent(project)}`, { method: 'DELETE' })
}

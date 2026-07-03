import { spawn } from 'node:child_process'
import type { ChatMessage } from '../router/classify.js'

export interface ClaudeChatDeps {
  command: string
  cwd: string
  timeoutMs: number
}

export interface ClaudeChatUsage {
  inputTokens: number
  outputTokens: number
}

/** Flatten a conversation into a single -p prompt. Claude Code is single-shot,
 * so prior turns are inlined as a transcript. */
function formatConversation(messages: readonly ChatMessage[]): string {
  const turns = messages.filter((m) => m.role !== 'system')
  if (turns.length <= 1) return turns[0]?.content ?? ''
  return (
    turns.map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n\n') +
    '\n\nRespond to the final User message.'
  )
}

const CHAT_SYSTEM =
  'You are in conversational chat mode. Answer directly and concisely. ' +
  'Do not modify files or run side-effecting commands unless explicitly asked.'

interface StreamEvent {
  type?: string
  message?: { content?: { type: string; text?: string }[] }
  event?: { type?: string; delta?: { type?: string; text?: string } }
  usage?: { input_tokens?: number; output_tokens?: number }
  is_error?: boolean
  result?: unknown
}

/** Stream a chat reply from the Claude Max subscription via `claude -p`.
 * Token-level deltas when the CLI emits partial messages; falls back to
 * whole assistant messages otherwise. Resolves with usage from the result. */
export function streamClaudeCodeChat(
  deps: ClaudeChatDeps,
  messages: readonly ChatMessage[],
  system: string | undefined,
  signal: AbortSignal,
  onDelta: (text: string) => void,
): Promise<ClaudeChatUsage> {
  return new Promise((resolvePromise, rejectPromise) => {
    const appended = [CHAT_SYSTEM, system].filter(Boolean).join('\n\n')
    const args = [
      '-p',
      formatConversation(messages),
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--append-system-prompt',
      appended,
    ]
    const child = spawn(deps.command, args, {
      cwd: deps.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    })

    let usage: ClaudeChatUsage = { inputTokens: 0, outputTokens: 0 }
    let buffer = ''
    let stderr = ''
    let streamedPartial = false
    let settled = false

    const timer = setTimeout(() => child.kill('SIGTERM'), deps.timeoutMs)
    const onAbort = () => child.kill('SIGTERM')
    signal.addEventListener('abort', onAbort, { once: true })

    const settle = (err?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      if (err) rejectPromise(err)
      else resolvePromise(usage)
    }

    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString()
      let nl
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim()
        buffer = buffer.slice(nl + 1)
        if (!line) continue
        let ev: StreamEvent
        try {
          ev = JSON.parse(line) as StreamEvent
        } catch {
          continue
        }
        if (ev.type === 'stream_event' && ev.event?.delta?.type === 'text_delta') {
          streamedPartial = true
          if (ev.event.delta.text) onDelta(ev.event.delta.text)
        } else if (ev.type === 'assistant' && !streamedPartial) {
          const text = (ev.message?.content ?? [])
            .filter((c) => c.type === 'text' && c.text)
            .map((c) => c.text)
            .join('')
          if (text) onDelta(text)
        } else if (ev.type === 'result') {
          usage = {
            inputTokens: ev.usage?.input_tokens ?? 0,
            outputTokens: ev.usage?.output_tokens ?? 0,
          }
          if (ev.is_error) {
            settle(new Error(String(ev.result ?? 'claude-code returned an error')))
            return
          }
        }
      }
    })
    child.stderr.on('data', (c: Buffer) => (stderr += c.toString()))
    child.on('error', (err) => settle(err))
    child.on('close', (code) => {
      if (settled) return
      if (code === 0) settle()
      else settle(new Error(`claude-code exited ${code}: ${stderr.slice(-200)}`))
    })
  })
}

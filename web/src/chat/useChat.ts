import { useCallback, useRef, useState } from 'react'
import { apiFetch, readSse, type MessageMeta, type UiMessage } from '../api'

interface ChatState {
  messages: UiMessage[]
  streaming: boolean
  error: string | null
}

const INITIAL: ChatState = { messages: [], streaming: false, error: null }

export function useChat() {
  const [state, setState] = useState<ChatState>(INITIAL)
  // Refs are the canonical write-path: send() never reads possibly-stale
  // closure state, and a second send() while streaming is a hard no-op.
  const messagesRef = useRef<UiMessage[]>([])
  const streamingRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)

  const patchLast = useCallback((patch: Partial<UiMessage>) => {
    const msgs = messagesRef.current
    messagesRef.current = msgs.map((m, i) => (i === msgs.length - 1 ? { ...m, ...patch } : m))
    setState((s) => ({ ...s, messages: messagesRef.current }))
  }, [])

  const stop = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const send = useCallback(
    async (text: string, modelOverride?: string, project?: string) => {
      if (streamingRef.current) return
      streamingRef.current = true
      abortRef.current = new AbortController()

      const history = [...messagesRef.current, { role: 'user' as const, content: text }]
      messagesRef.current = [...history, { role: 'assistant' as const, content: '' }]
      setState({ messages: messagesRef.current, streaming: true, error: null })

      let failure: string | null = null
      try {
        const res = await apiFetch('/api/chat', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          signal: abortRef.current.signal,
          body: JSON.stringify({
            messages: history.map(({ role, content }) => ({ role, content })),
            model: modelOverride || undefined,
            project: project || undefined,
          }),
        })
        if (!res.ok || !res.body) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null
          throw new Error(body?.error ?? `chat request failed: ${res.status}`)
        }

        let acc = ''
        for await (const { event, data } of readSse(res.body)) {
          if (event === 'meta') {
            patchLast({ meta: data as unknown as MessageMeta })
          } else if (event === 'delta' && typeof data['text'] === 'string') {
            acc += data['text']
            patchLast({ content: acc })
          } else if (event === 'done') {
            const usage = data['usage'] as { inputTokens: number; outputTokens: number } | undefined
            if (usage) patchLast({ usage })
          } else if (event === 'error') {
            throw new Error(
              typeof data['message'] === 'string' ? data['message'] : 'stream error',
            )
          }
        }
      } catch (err) {
        failure =
          (err as Error).name === 'AbortError' ? 'stopped' : (err as Error).message
      } finally {
        streamingRef.current = false
        abortRef.current = null
        if (failure && !messagesRef.current[messagesRef.current.length - 1]?.content) {
          messagesRef.current = messagesRef.current.slice(0, -1)
        }
        setState({ messages: messagesRef.current, streaming: false, error: failure })
      }
    },
    [patchLast],
  )

  return { ...state, send, stop }
}

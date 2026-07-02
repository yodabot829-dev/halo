export interface ModelEntry {
  ref: string
  provider: string
  modelId: string
  classes: string[]
  tier: string
  label: string
  available: boolean
}

export interface MessageMeta {
  model: string
  label: string
  taskClass: string
  reason: string
}

export interface UiMessage {
  role: 'user' | 'assistant'
  content: string
  meta?: MessageMeta
}

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('halo_token')
  return token ? { authorization: `Bearer ${token}` } : {}
}

/**
 * fetch with bearer auth. On 401, asks for the token once (personal OS —
 * the token lives in localStorage on your own devices, never in the bundle).
 */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const attempt = () =>
    fetch(path, { ...init, headers: { ...(init.headers ?? {}), ...authHeaders() } })
  const res = await attempt()
  if (res.status !== 401) return res
  const token = window.prompt('HALO auth token:')
  if (!token) return res
  localStorage.setItem('halo_token', token)
  return attempt()
}

export async function fetchModels(): Promise<ModelEntry[]> {
  const res = await apiFetch('/api/models')
  if (!res.ok) throw new Error(`models request failed: ${res.status}`)
  const body = (await res.json()) as { success: boolean; data: ModelEntry[] }
  return body.data
}

export interface SseEvent {
  event: string
  data: Record<string, unknown>
}

/** Parse an SSE byte stream into events. Releases the reader on early exit. */
export async function* readSse(stream: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let sep
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, sep)
        buffer = buffer.slice(sep + 2)
        const eventLine = frame.split('\n').find((l) => l.startsWith('event: '))
        const dataLine = frame.split('\n').find((l) => l.startsWith('data: '))
        if (!eventLine || !dataLine) continue
        yield {
          event: eventLine.slice(7).trim(),
          data: JSON.parse(dataLine.slice(6)) as Record<string, unknown>,
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
}

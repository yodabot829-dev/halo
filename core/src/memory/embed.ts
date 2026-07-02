/** Local embeddings via Ollama's /api/embed. Free, private, optional —
 * every caller must tolerate a null return (FTS-only degradation). */
export type EmbedFn = (texts: string[]) => Promise<Float32Array[] | null>

export function makeOllamaEmbedder(baseURL: string, model: string): EmbedFn {
  return async (texts) => {
    try {
      const res = await fetch(`${baseURL}/embed`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model, input: texts }),
      })
      if (!res.ok) return null
      const body = (await res.json()) as { embeddings?: number[][] }
      if (!body.embeddings || body.embeddings.length !== texts.length) return null
      return body.embeddings.map((e) => Float32Array.from(e))
    } catch {
      return null
    }
  }
}

export function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!
    const y = b[i]!
    dot += x * y
    na += x * x
    nb += y * y
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb)
  return denom === 0 ? 0 : dot / denom
}

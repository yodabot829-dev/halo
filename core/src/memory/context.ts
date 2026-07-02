/** Builds the server-owned system prompt: persona + plain-markdown memory.
 * Deliberately protocol-free — weak local models get the same text as
 * frontier models, no tool-calling required. */
export function buildSystemPrompt(
  persona: string | null,
  memory: { title: string; content: string }[],
): string | undefined {
  const parts: string[] = []
  if (persona) parts.push(persona.trim())
  if (memory.length > 0) {
    const notes = memory.map((m) => `### ${m.title}\n${m.content.trim()}`).join('\n\n')
    parts.push(
      `## Memory\nRelevant notes from your long-term memory. Use them when they apply; ignore them when they don't.\n\n${notes}`,
    )
  }
  return parts.length > 0 ? parts.join('\n\n') : undefined
}

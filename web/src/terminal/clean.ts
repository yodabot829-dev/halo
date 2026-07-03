// Turn raw PTY output into something worth reading aloud: no escape codes, no
// carriage-return redraws, no trailing shell prompt. Heuristic, not perfect —
// a raw byte stream has no clean "this is the command's result" marker.

const OSC = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g // OSC … BEL | ST
const CSI = /\x1b\[[0-?]*[ -/]*[@-~]/g // CSI … final byte
const FE = /\x1b[@-Z\\-_]/g // other 2-char escapes
const PROMPT_TAIL = /[%$#>❯]\s*$/ // a line ending like a shell prompt

export function stripAnsi(s: string): string {
  return s.replace(OSC, '').replace(CSI, '').replace(FE, '').replace(/\r/g, '')
}

/**
 * Clean an accumulated output chunk for TTS. Returns '' when there is nothing
 * worth speaking (blank, or only a prompt / echoed keystrokes with no result).
 * `maxChars` keeps a huge `ls` from being read for a minute.
 */
export function cleanForSpeech(raw: string, maxChars = 1500): string {
  // Only speak once a command has actually produced a line of output — this
  // filters mid-typing echoes (no newline yet) from being read aloud.
  if (!raw.includes('\n')) return ''

  const lines = stripAnsi(raw)
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
  while (lines.length && lines[lines.length - 1]?.trim() === '') lines.pop()
  // Drop a final prompt line (e.g. "shumon halo %").
  if (lines.length && PROMPT_TAIL.test(lines[lines.length - 1] ?? '')) lines.pop()

  const text = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  if (!text) return ''
  return text.length > maxChars ? `${text.slice(0, maxChars)} …and more` : text
}

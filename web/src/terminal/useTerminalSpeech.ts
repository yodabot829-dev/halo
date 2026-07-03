import { useCallback, useEffect, useRef, useState } from 'react'
import { cleanForSpeech } from './clean'

const SETTLE_MS = 800 // read once output has been quiet this long

/**
 * "Jarvis" auto-read. While enabled, buffers PTY output and, once it goes
 * quiet for SETTLE_MS (a command finished, prompt returned), speaks the
 * cleaned result. Off by default — auto-reading a redrawing TUI (vim/top) or
 * the attach banner would be noise, so the user turns it on per session.
 */
export function useTerminalSpeech(speak: (text: string) => void) {
  const [speakOn, setSpeakOn] = useState(false)
  const speakOnRef = useRef(false)
  const speakRef = useRef(speak)
  const bufferRef = useRef('')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  speakRef.current = speak

  const flush = useCallback(() => {
    const text = cleanForSpeech(bufferRef.current)
    bufferRef.current = ''
    if (text) speakRef.current(text)
  }, [])

  // Called for every output chunk from the socket.
  const handleOutput = useCallback(
    (chunk: string) => {
      if (!speakOnRef.current) return
      bufferRef.current += chunk
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(flush, SETTLE_MS)
    },
    [flush],
  )

  const toggleSpeak = useCallback(() => {
    setSpeakOn((on) => {
      const next = !on
      speakOnRef.current = next
      // Starting fresh: drop whatever's already on screen so we only read
      // output produced from here on.
      if (next) bufferRef.current = ''
      return next
    })
  }, [])

  useEffect(() => () => void (timerRef.current && clearTimeout(timerRef.current)), [])

  return { speakOn, toggleSpeak, handleOutput }
}

import { useCallback, useRef, useState } from 'react'
import { apiFetch } from '../api'

export type MicState = 'idle' | 'recording' | 'transcribing'

/** Push-to-talk: record in the browser, transcribe on the local daemon.
 * Speak: fetch local TTS audio for a reply and play it. All on-device. */
export function useVoice() {
  const [micState, setMicState] = useState<MicState>('idle')
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const startRecording = useCallback(async () => {
    setVoiceError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' })
      recorderRef.current = recorder
      recorder.start()
      setMicState('recording')
    } catch (err) {
      setVoiceError(`microphone unavailable: ${(err as Error).message}`)
    }
  }, [])

  /** Stop and transcribe; resolves to the recognised text ('' on failure). */
  const stopRecording = useCallback((): Promise<string> => {
    const recorder = recorderRef.current
    if (!recorder || recorder.state === 'inactive') return Promise.resolve('')
    setMicState('transcribing')

    return new Promise((resolve) => {
      const chunks: Blob[] = []
      recorder.ondataavailable = (e) => chunks.push(e.data)
      recorder.onstop = async () => {
        recorder.stream.getTracks().forEach((t) => t.stop())
        recorderRef.current = null
        try {
          const blob = new Blob(chunks, { type: 'audio/webm' })
          const res = await apiFetch('/api/voice/stt', {
            method: 'POST',
            headers: { 'content-type': 'audio/webm' },
            body: blob,
          })
          if (!res.ok) {
            const body = (await res.json().catch(() => null)) as { error?: string } | null
            throw new Error(body?.error ?? `stt failed: ${res.status}`)
          }
          const body = (await res.json()) as { data: { text: string } }
          resolve(body.data.text)
        } catch (err) {
          setVoiceError((err as Error).message)
          resolve('')
        } finally {
          setMicState('idle')
        }
      }
      recorder.stop()
    })
  }, [])

  const speak = useCallback(async (text: string) => {
    try {
      const res = await apiFetch('/api/voice/tts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: text.slice(0, 4000) }),
      })
      if (!res.ok) throw new Error(`tts failed: ${res.status}`)
      const url = URL.createObjectURL(await res.blob())
      audioRef.current?.pause()
      const audio = new Audio(url)
      audioRef.current = audio
      audio.onended = () => URL.revokeObjectURL(url)
      await audio.play()
    } catch (err) {
      setVoiceError((err as Error).message)
    }
  }, [])

  const stopSpeaking = useCallback(() => {
    audioRef.current?.pause()
    audioRef.current = null
  }, [])

  return { micState, voiceError, startRecording, stopRecording, speak, stopSpeaking }
}

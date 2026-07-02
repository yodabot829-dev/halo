import { describe, expect, it } from 'vitest'
import { FrameReader } from '../src/voice/protocol.js'
import { concatFloat32, encodeWav } from '../src/voice/wav.js'

describe('encodeWav', () => {
  it('writes a valid RIFF header and PCM16 data', () => {
    const wav = encodeWav(Float32Array.from([0, 0.5, -0.5, 1]), 24_000)
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF')
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE')
    expect(wav.readUInt32LE(24)).toBe(24_000)
    expect(wav.readUInt32LE(40)).toBe(8) // 4 samples × 2 bytes
    expect(wav.readInt16LE(44)).toBe(0)
    expect(wav.readInt16LE(46)).toBe(16384) // 0.5
    expect(wav.readInt16LE(50)).toBe(32767) // 1.0
  })

  it('clamps out-of-range samples', () => {
    const wav = encodeWav(Float32Array.from([2, -2]), 24_000)
    expect(wav.readInt16LE(44)).toBe(32767)
    expect(wav.readInt16LE(46)).toBe(-32767)
  })
})

describe('concatFloat32', () => {
  it('joins chunks in order', () => {
    const joined = concatFloat32([Float32Array.from([1, 2]), Float32Array.from([3])])
    expect([...joined]).toEqual([1, 2, 3])
  })
})

describe('FrameReader', () => {
  it('parses header-only and payload frames across chunk boundaries', () => {
    const reader = new FrameReader()
    const payload = Buffer.from('abcde')
    const stream = Buffer.concat([
      Buffer.from('{"ready":true}\n'),
      Buffer.from(`{"id":1,"ok":true,"bytes":5}\n`),
      payload,
    ])

    const frames = [
      ...reader.feed(stream.subarray(0, 20)),
      ...reader.feed(stream.subarray(20, 40)),
      ...reader.feed(stream.subarray(40)),
    ]
    expect(frames).toHaveLength(2)
    expect(frames[0]?.header).toEqual({ ready: true })
    expect(frames[1]?.header['id']).toBe(1)
    expect(frames[1]?.payload.toString()).toBe('abcde')
  })

  it('handles error frames without payload', () => {
    const reader = new FrameReader()
    const frames = reader.feed(Buffer.from('{"id":2,"ok":false,"error":"boom"}\n'))
    expect(frames[0]?.header['error']).toBe('boom')
    expect(frames[0]?.payload.length).toBe(0)
  })
})

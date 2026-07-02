/** Encode mono float32 PCM as a 16-bit WAV file. Pure — no I/O. */
export function encodeWav(samples: Float32Array, sampleRate: number): Buffer {
  const dataBytes = samples.length * 2
  const buffer = Buffer.alloc(44 + dataBytes)

  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataBytes, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16) // fmt chunk size
  buffer.writeUInt16LE(1, 20) // PCM
  buffer.writeUInt16LE(1, 22) // mono
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28) // byte rate
  buffer.writeUInt16LE(2, 32) // block align
  buffer.writeUInt16LE(16, 34) // bits per sample
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataBytes, 40)

  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]!))
    buffer.writeInt16LE(Math.round(clamped * 32767), 44 + i * 2)
  }
  return buffer
}

export function concatFloat32(chunks: readonly Float32Array[]): Float32Array {
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const out = new Float32Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

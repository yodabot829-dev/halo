/** Line-JSON header + raw payload framing for the TTS worker's stdout.
 * `{"id":1,"ok":true,"bytes":N}\n` followed by N raw bytes. */

export interface Frame {
  header: Record<string, unknown>
  payload: Buffer
}

export class FrameReader {
  private buffer = Buffer.alloc(0)
  private pending: { header: Record<string, unknown>; bytes: number } | null = null

  /** Feed a chunk; returns any complete frames. */
  feed(chunk: Buffer): Frame[] {
    this.buffer = Buffer.concat([this.buffer, chunk])
    const frames: Frame[] = []
    for (;;) {
      if (this.pending) {
        if (this.buffer.length < this.pending.bytes) break
        frames.push({
          header: this.pending.header,
          payload: this.buffer.subarray(0, this.pending.bytes),
        })
        this.buffer = this.buffer.subarray(this.pending.bytes)
        this.pending = null
        continue
      }
      const nl = this.buffer.indexOf(0x0a)
      if (nl === -1) break
      const line = this.buffer.subarray(0, nl).toString('utf8').trim()
      this.buffer = this.buffer.subarray(nl + 1)
      if (!line) continue
      const header = JSON.parse(line) as Record<string, unknown>
      const bytes = typeof header['bytes'] === 'number' ? header['bytes'] : 0
      if (bytes > 0) {
        this.pending = { header, bytes }
      } else {
        frames.push({ header, payload: Buffer.alloc(0) })
      }
    }
    return frames
  }
}

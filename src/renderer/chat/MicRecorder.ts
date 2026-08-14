/**
 * Push-to-talk microphone capture.
 *
 * The codec preference list is load-bearing — it's what Amber's Whisper STT
 * accepts, carried over from the web dev client. Don't improvise a replacement.
 *
 * The stream is held open across turns rather than re-acquired each time: on
 * Windows the permission/device-open round trip is slow enough to clip the first
 * word of an utterance.
 */
const CODECS = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  '',
] as const

export class MicRecorder {
  private stream: MediaStream | null = null
  private recorder: MediaRecorder | null = null
  private chunks: Blob[] = []

  private pickMimeType(): string {
    for (const codec of CODECS) {
      if (codec === '' || MediaRecorder.isTypeSupported(codec)) return codec
    }
    return ''
  }

  async prime(): Promise<void> {
    if (this.stream) return
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  }

  async start(): Promise<void> {
    await this.prime()
    if (!this.stream) throw new Error('No microphone stream')

    const mimeType = this.pickMimeType()
    const recorder = new MediaRecorder(this.stream, mimeType ? { mimeType } : undefined)
    this.chunks = []
    recorder.addEventListener('dataavailable', (e) => {
      if (e.data.size > 0) this.chunks.push(e.data)
    })
    recorder.start()
    this.recorder = recorder
  }

  /**
   * Stop and resolve the complete utterance as one blob — Amber expects a single
   * binary frame per turn, with the frame boundary marking the end of speech.
   * Resolves null if nothing was captured.
   */
  stop(): Promise<Blob | null> {
    const recorder = this.recorder
    this.recorder = null
    if (!recorder || recorder.state === 'inactive') return Promise.resolve(null)

    return new Promise((resolve) => {
      recorder.addEventListener(
        'stop',
        () => {
          const chunks = this.chunks
          this.chunks = []
          resolve(chunks.length ? new Blob(chunks, { type: chunks[0].type }) : null)
        },
        { once: true },
      )
      recorder.stop()
    })
  }

  /** Release the device — call when the app is done recording for a while. */
  release(): void {
    this.recorder = null
    this.chunks = []
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
  }
}

import { useCallback, useEffect, useRef, useState } from 'react'

import { useStore } from '../store'
import { AudioQueue } from './AudioQueue'
import { MicRecorder } from './MicRecorder'

/**
 * Bridges the main-process event stream into the store, and owns the two pieces of
 * renderer-only machinery: audio playback and mic capture.
 *
 * Mounted once, at the app root — a second instance would double-subscribe and play
 * every sentence twice.
 */
export function useAmberConnection() {
  const ingest = useStore((s) => s.ingest)
  const addUserMessage = useStore((s) => s.addUserMessage)
  const setSettings = useStore((s) => s.setSettings)
  const setAudit = useStore((s) => s.setAudit)
  const playAudio = useStore((s) => s.settings.playAudio)

  const [speaking, setSpeaking] = useState(false)
  const [recording, setRecording] = useState(false)

  const queueRef = useRef<AudioQueue | null>(null)
  const micRef = useRef<MicRecorder | null>(null)
  // Read inside the event handler, which is registered once — a ref keeps it
  // current without re-subscribing (and re-playing) on every settings change.
  const playAudioRef = useRef(playAudio)
  playAudioRef.current = playAudio

  if (!queueRef.current) queueRef.current = new AudioQueue(setSpeaking)
  if (!micRef.current) micRef.current = new MicRecorder()

  useEffect(() => {
    void window.aperture.settings.get().then(setSettings)
    void window.aperture.audit.list().then(setAudit)

    const unsubscribe = window.aperture.amber.onEvent((event) => {
      if (event.kind === 'audio') {
        if (playAudioRef.current) {
          queueRef.current?.push(event.buffer, event.meta?.format ?? 'mp3')
        }
        return
      }
      // A new turn or a dropped connection means anything still queued is stale.
      if (
        event.kind === 'frame' &&
        event.frame.type === 'transcript'
      ) {
        queueRef.current?.stop()
      }
      if (event.kind === 'connection' && event.status.state !== 'open') {
        queueRef.current?.stop()
      }
      ingest(event)
    })

    void window.aperture.amber.connect()

    return () => {
      unsubscribe()
      queueRef.current?.stop()
      micRef.current?.release()
    }
  }, [ingest, setSettings, setAudit])

  const sendText = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (!trimmed) return
      // Render optimistically so typing feels instant; the store dedupes against
      // the transcript echo Amber sends back.
      addUserMessage(trimmed)
      queueRef.current?.stop()
      await window.aperture.amber.sendText(trimmed)
    },
    [addUserMessage],
  )

  const interrupt = useCallback(async () => {
    // Stop locally first — Amber sends no acknowledgment, so waiting for one would
    // leave the queued sentences playing over the silence.
    queueRef.current?.stop()
    await window.aperture.amber.interrupt()
  }, [])

  const startRecording = useCallback(async () => {
    try {
      queueRef.current?.stop()
      await micRef.current?.start()
      setRecording(true)
    } catch {
      setRecording(false)
    }
  }, [])

  const stopRecording = useCallback(async () => {
    setRecording(false)
    const blob = await micRef.current?.stop()
    if (!blob) return
    await window.aperture.amber.sendAudio(await blob.arrayBuffer())
  }, [])

  return { speaking, recording, sendText, interrupt, startRecording, stopRecording }
}

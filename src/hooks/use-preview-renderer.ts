import { useRef, useCallback, useEffect, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { useEditorStore } from "@/stores/editor-store"
import { sequenceTimeToSourceTime } from "@/lib/sequence"

interface PreviewDimensions {
  width: number
  height: number
}

export function usePreviewRenderer(
  canvasRef: React.RefObject<HTMLCanvasElement | null>
) {
  const project = useEditorStore((s) => s.project)
  const effects = useEditorStore((s) => s.project?.effects)
  const currentTime = useEditorStore((s) => s.currentTime)
  const isPlaying = useEditorStore((s) => s.isPlaying)
  const pendingRef = useRef(false)
  const queuedTimeRef = useRef<number | null>(null)
  const effectsRef = useRef(effects)
  effectsRef.current = effects
  const [dims, setDims] = useState<PreviewDimensions | null>(null)

  // Configure on project load — receive canvas dimensions
  useEffect(() => {
    if (!project?.id) return
    invoke<PreviewDimensions>("configure_preview", { projectId: project.id })
      .then((d) => {
        setDims(d)
        // Set canvas size to match compositor output
        if (canvasRef.current) {
          canvasRef.current.width = d.width
          canvasRef.current.height = d.height
        }
      })
      .catch((e) => console.error("Preview configure failed:", e))
    return () => {
      invoke("destroy_preview").catch(() => {})
    }
  }, [project?.id, canvasRef])

  // Map sequence time to source time + zoom events for the active clip
  const mapTime = useCallback(
    (seqTimeMs: number) => {
      const sequence = useEditorStore.getState().project?.sequence
      if (!sequence || sequence.clips.length === 0) {
        return { sourceTimeMs: seqTimeMs, zoomEvents: [] }
      }
      const mapping = sequenceTimeToSourceTime(
        seqTimeMs,
        sequence.clips,
        sequence.transitions
      )
      if (!mapping) {
        return { sourceTimeMs: seqTimeMs, zoomEvents: [] }
      }
      const clip = sequence.clips[mapping.clipIndex]
      return {
        sourceTimeMs: mapping.sourceTime,
        zoomEvents: clip.zoomEvents ?? [],
      }
    },
    []
  )

  // Request a single frame — with queued-time pattern to avoid dropping the final scrub frame
  const requestFrame = useCallback(
    async (timeMs: number) => {
      if (pendingRef.current) {
        queuedTimeRef.current = timeMs // remember latest
        return
      }
      if (!canvasRef.current) return
      pendingRef.current = true
      queuedTimeRef.current = null
      try {
        const { sourceTimeMs, zoomEvents } = mapTime(timeMs)
        const jpegBytes: ArrayBuffer = await invoke("render_preview_frame", {
          sourceTimeMs: Math.round(sourceTimeMs),
          effects: effectsRef.current,
          zoomEvents,
        })
        const blob = new Blob([jpegBytes], { type: "image/jpeg" })
        const bitmap = await createImageBitmap(blob)
        const ctx = canvasRef.current?.getContext("2d")
        if (ctx) {
          ctx.drawImage(bitmap, 0, 0, ctx.canvas.width, ctx.canvas.height)
        }
        bitmap.close()
      } catch (e) {
        console.error("Preview frame failed:", e)
      } finally {
        pendingRef.current = false
        // If a frame was queued during this render, fire it now
        const queued = queuedTimeRef.current
        if (queued !== null) {
          queuedTimeRef.current = null
          requestFrame(queued)
        }
      }
    },
    [canvasRef, mapTime]
  )

  // Scrubbing: request frame when currentTime changes (not during playback)
  useEffect(() => {
    if (!isPlaying) {
      requestFrame(currentTime)
    }
  }, [currentTime, isPlaying, requestFrame])

  // Effects change: re-render current frame
  useEffect(() => {
    requestFrame(useEditorStore.getState().currentTime)
  }, [effects, requestFrame])

  // Playback loop: request frames as fast as Metal can render them
  useEffect(() => {
    if (!isPlaying) return
    let running = true
    const tick = () => {
      if (!running) return
      requestFrame(useEditorStore.getState().currentTime)
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
    return () => {
      running = false
    }
  }, [isPlaying, requestFrame])

  return { dims }
}

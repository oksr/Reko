import { useState, useRef, useCallback } from "react"
import { useEditorStore } from "@/stores/editor-store"
import { sourceTimeToSequenceTime } from "@/lib/sequence"
import { ClipBlock } from "./clip-block"
import { TransitionBlock } from "./transition-block"
import { TransitionMenu } from "./transition-menu"
import type { Transition } from "@/types/editor"
import type { TimelineContext } from "./types"

interface SequenceTrackProps {
  ctx: TimelineContext
}

export function SequenceTrack({ ctx }: SequenceTrackProps) {
  const sequence = useEditorStore((s) => s.project?.sequence)
  const activeTool = useEditorStore((s) => s.activeTool)
  const splitAtPlayhead = useEditorStore((s) => s.splitAtPlayhead)
  const removeTransition = useEditorStore((s) => s.removeTransition)
  const addTransition = useEditorStore((s) => s.addTransition)

  const [dragState, setDragState] = useState<{
    fromIndex: number
    toIndex: number
  } | null>(null)

  const handleDragUpdate = useCallback((fromIndex: number, toIndex: number | null) => {
    if (toIndex === null) {
      setDragState(null)
    } else {
      setDragState({ fromIndex, toIndex })
    }
  }, [])

  const [menuState, setMenuState] = useState<{
    index: number
    position: { x: number; y: number }
  } | null>(null)

  const [razorX, setRazorX] = useState<number | null>(null)
  const trackRef = useRef<HTMLDivElement>(null)

  const handleRazorMove = useCallback((e: React.MouseEvent) => {
    if (activeTool !== "razor" || !trackRef.current) return
    const rect = trackRef.current.getBoundingClientRect()
    setRazorX(e.clientX - rect.left)
  }, [activeTool])

  const handleRazorLeave = useCallback(() => {
    setRazorX(null)
  }, [])

  if (!sequence) return null

  const handleTrackClick = (e: React.MouseEvent) => {
    if (activeTool !== "razor") return
    if (!ctx.containerRef.current) return
    const rect = ctx.containerRef.current.getBoundingClientRect()
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const timeMs = pct * ctx.durationMs
    ctx.videoSync.seek(timeMs)
    useEditorStore.getState().setCurrentTime(timeMs)
    splitAtPlayhead()
  }

  const handleCutPointContextMenu = (e: React.MouseEvent, index: number) => {
    e.preventDefault()
    e.stopPropagation()
    setMenuState({ index, position: { x: e.clientX, y: e.clientY } })
  }

  const handleTransitionSelect = (type: Transition["type"]) => {
    if (menuState === null) return
    if (type === "cut") {
      removeTransition(menuState.index)
    } else {
      addTransition(menuState.index, { type, durationMs: 200 })
    }
  }

  // Build clip + transition elements with absolute positions
  const clipElements: React.ReactNode[] = []
  const cutElements: React.ReactNode[] = []

  // Compute preview order for non-dragged clips when dragging
  let previewOrder: number[] | null = null
  if (dragState && dragState.fromIndex !== dragState.toIndex) {
    const order = sequence.clips.map((_, i) => i)
    const [removed] = order.splice(dragState.fromIndex, 1)
    order.splice(dragState.toIndex, 0, removed)
    previewOrder = order
  }

  // Compute base positions for each clip (used for preview shifting)
  const clipWidths: number[] = []
  for (let i = 0; i < sequence.clips.length; i++) {
    const c = sequence.clips[i]
    clipWidths.push(ctx.msToPercent((c.sourceEnd - c.sourceStart) / c.speed))
  }

  for (let i = 0; i < sequence.clips.length; i++) {
    const clip = sequence.clips[i]
    const clipSeqStart = sourceTimeToSequenceTime(
      clip.sourceStart, i, sequence.clips, sequence.transitions
    )
    const clipDuration = (clip.sourceEnd - clip.sourceStart) / clip.speed
    const leftPct = ctx.msToPercent(clipSeqStart)
    const widthPct = ctx.msToPercent(clipDuration)

    const isDraggedClip = dragState !== null && dragState.fromIndex === i

    // For non-dragged clips during drag, compute translateX offset from reordered position
    let previewTranslateX = 0
    if (previewOrder && !isDraggedClip) {
      const posInPreview = previewOrder.indexOf(i)
      let previewLeft = 0
      for (let p = 0; p < posInPreview; p++) {
        previewLeft += clipWidths[previewOrder[p]]
      }
      previewTranslateX = previewLeft - leftPct
    }

    clipElements.push(
      <ClipBlock
        key={clip.id}
        clip={clip}
        index={i}
        leftPercent={leftPct}
        widthPercent={widthPct}
        ctx={ctx}
        onDragUpdate={handleDragUpdate}
        previewTranslateXPct={isDraggedClip ? 0 : previewTranslateX}
        isDragPreview={!isDraggedClip && dragState !== null}
      />
    )

    // Add transition or cut-point between clips (hide during drag)
    if (i < sequence.clips.length - 1 && !dragState) {
      const transition = sequence.transitions[i]
      const cutLeftPct = leftPct + widthPct
      if (transition && transition.type !== "cut") {
        cutElements.push(
          <TransitionBlock
            key={`transition-${i}`}
            transition={transition}
            index={i}
            ctx={ctx}
            onRemove={() => removeTransition(i)}
          />
        )
      } else {
        cutElements.push(
          <div
            key={`cut-${i}`}
            data-testid="cut-point"
            className="absolute top-0 bottom-0 w-px bg-zinc-600 cursor-pointer hover:bg-zinc-400 transition-colors z-10"
            style={{ left: `${cutLeftPct}%` }}
            onContextMenu={(e) => handleCutPointContextMenu(e, i)}
          />
        )
      }
    }
  }

  return (
    <div
      ref={trackRef}
      data-testid="sequence-track"
      className={`relative h-10 ${activeTool === "razor" ? "cursor-razor" : ""}`}
      onClick={handleTrackClick}
      onMouseMove={handleRazorMove}
      onMouseLeave={handleRazorLeave}
    >
      {clipElements}
      {cutElements}

      {/* Razor guide line */}
      {activeTool === "razor" && razorX !== null && (
        <div
          className="absolute top-0 bottom-0 w-px bg-red-500 pointer-events-none z-30"
          style={{ left: `${razorX}px` }}
        >
          <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-red-500" />
        </div>
      )}

      {/* Context menu */}
      {menuState && (
        <TransitionMenu
          position={menuState.position}
          onSelect={handleTransitionSelect}
          onClose={() => setMenuState(null)}
        />
      )}
    </div>
  )
}

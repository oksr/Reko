import { useState } from "react"
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

  const [menuState, setMenuState] = useState<{
    index: number
    position: { x: number; y: number }
  } | null>(null)

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

  for (let i = 0; i < sequence.clips.length; i++) {
    const clip = sequence.clips[i]
    const clipSeqStart = sourceTimeToSequenceTime(
      clip.sourceStart, i, sequence.clips, sequence.transitions
    )
    const clipDuration = (clip.sourceEnd - clip.sourceStart) / clip.speed
    const leftPct = ctx.msToPercent(clipSeqStart)
    const widthPct = ctx.msToPercent(clipDuration)

    clipElements.push(
      <ClipBlock
        key={clip.id}
        clip={clip}
        index={i}
        leftPercent={leftPct}
        widthPercent={widthPct}
        ctx={ctx}
      />
    )

    // Add transition or cut-point between clips
    if (i < sequence.clips.length - 1) {
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
      data-testid="sequence-track"
      className="relative h-10"
      onClick={handleTrackClick}
    >
      {clipElements}
      {cutElements}

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

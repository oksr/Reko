import { useMemo } from "react"
import { useEditorStore } from "@/stores/editor-store"
import { OverlayBlock } from "./overlay-block"
import type { OverlayTrack as OverlayTrackType } from "@/types/editor"
import type { TimelineContext } from "./types"

interface OverlayTrackProps {
  track: OverlayTrackType
  trackIndex: number
  ctx: TimelineContext
}

export function OverlayTrack({ track, trackIndex, ctx }: OverlayTrackProps) {
  const allOverlays = useEditorStore((s) => s.project?.sequence.overlays)
  const overlays = useMemo(
    () => allOverlays?.filter((o) => o.trackId === track.id) ?? [],
    [allOverlays, track.id]
  )

  return (
    <div data-testid="overlay-track" className="relative flex items-stretch h-8">
      <div className="flex-shrink-0 w-8 flex items-center justify-center text-xs text-zinc-500 font-medium">
        V{trackIndex + 1}
      </div>
      <div className="flex-1 relative">
        {overlays.map((overlay) => (
          <OverlayBlock key={overlay.id} overlay={overlay} ctx={ctx} />
        ))}
      </div>
    </div>
  )
}

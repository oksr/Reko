import type { Overlay } from "@/types/editor"
import type { TimelineContext } from "./types"

interface OverlayBlockProps {
  overlay: Overlay
  ctx: TimelineContext
}

export function OverlayBlock({ overlay, ctx }: OverlayBlockProps) {
  const leftPercent = ctx.msToPercent(overlay.startMs)
  const widthPercent = ctx.msToPercent(overlay.durationMs)

  const colorMap = {
    webcam: "bg-green-500/30 border-green-500/50",
    text: "bg-sky-500/30 border-sky-500/50",
    image: "bg-orange-500/30 border-orange-500/50",
  }

  return (
    <div
      data-testid="overlay-block"
      className={`absolute top-0.5 bottom-0.5 rounded border ${colorMap[overlay.type]} cursor-pointer`}
      style={{ left: `${leftPercent}%`, width: `${widthPercent}%` }}
    >
      <span className="text-[10px] text-zinc-300 px-1 truncate">
        {overlay.type}
      </span>
    </div>
  )
}

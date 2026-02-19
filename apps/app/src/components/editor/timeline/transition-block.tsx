import type { Transition } from "@/types/editor"
import type { TimelineContext } from "./types"

interface TransitionBlockProps {
  transition: Transition
  index: number
  ctx: TimelineContext
  onRemove: () => void
}

export function TransitionBlock({ transition, ctx, onRemove }: TransitionBlockProps) {
  const widthPercent = ctx.msToPercent(transition.durationMs)

  const label = {
    crossfade: "XF",
    dissolve: "DS",
    "fade-through-black": "FB",
    cut: "",
  }[transition.type]

  return (
    <div
      data-testid="transition-block"
      className="relative flex items-center justify-center rounded bg-blue-500/30 border border-blue-500/50 cursor-pointer text-[10px] text-blue-300 font-medium flex-shrink-0"
      style={{ width: `${Math.max(widthPercent, 0.5)}%`, minWidth: "16px" }}
      title={`${transition.type} (${transition.durationMs}ms)`}
      onDoubleClick={onRemove}
    >
      {label}
    </div>
  )
}

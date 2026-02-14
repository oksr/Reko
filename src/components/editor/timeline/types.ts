import type { useVideoSync } from "@/hooks/use-video-sync"

export interface TimelineContext {
  durationMs: number
  /** Original video duration (stable, doesn't change with trims) */
  videoDurationMs: number
  inPoint: number
  outPoint: number
  currentTime: number
  videoSync: ReturnType<typeof useVideoSync>
  /** Convert ms to percentage of total duration */
  msToPercent: (ms: number) => number
  /** Ref for the shared timeline container (for coordinate calculations) */
  containerRef: React.RefObject<HTMLDivElement | null>
  /** Freeze timeline duration (call on trim drag start) */
  freezeDuration: () => void
  /** Unfreeze timeline duration (call on trim drag end) */
  unfreezeDuration: () => void
}

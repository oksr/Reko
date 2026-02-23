import { useState, useEffect, useRef } from "react"
import { usePlatform } from "@/platform/PlatformContext"
import { Square, Pause, Play } from "lucide-react"
import type { AudioLevels } from "@/types"

interface Props {
  isPaused: boolean
  onStop: () => void
  onPause: () => void
  onResume: () => void
  micEnabled: boolean
}

export function RecordingBar({
  isPaused,
  onStop,
  onPause,
  onResume,
  micEnabled,
}: Props) {
  return (
    <div className="flex items-center">
      {/* Stop button */}
      <div className="toolbar-group">
        <button
          className="toolbar-btn-icon"
          onClick={onStop}
          onMouseDown={(e) => e.stopPropagation()}
          aria-label="Stop Recording"
          title="Stop Recording"
          style={{ color: "#ef4444" }}
        >
          <Square size={14} fill="#ef4444" stroke="none" />
        </button>
      </div>

      {/* Pause/Resume button */}
      <div className="toolbar-group">
        <button
          className="toolbar-btn-icon"
          onClick={isPaused ? onResume : onPause}
          onMouseDown={(e) => e.stopPropagation()}
          aria-label={isPaused ? "Resume" : "Pause"}
          title={isPaused ? "Resume" : "Pause"}
        >
          {isPaused ? <Play size={14} strokeWidth={2} /> : <Pause size={14} strokeWidth={2} />}
        </button>
      </div>

      <div className="toolbar-divider" />

      {/* Timer */}
      <div className="toolbar-group">
        <RecordingTimer isPaused={isPaused} />
      </div>

      <div className="toolbar-divider" />

      {/* Audio levels */}
      <div className="toolbar-group">
        <MiniAudioLevels
          isPaused={isPaused}
          micEnabled={micEnabled}
        />
      </div>
    </div>
  )
}

function RecordingTimer({ isPaused }: { isPaused: boolean }) {
  const [elapsed, setElapsed] = useState(0)
  const offsetRef = useRef(0)
  const segmentStartRef = useRef(Date.now())
  const rafRef = useRef(0)

  useEffect(() => {
    if (isPaused) {
      cancelAnimationFrame(rafRef.current)
      offsetRef.current += Date.now() - segmentStartRef.current
    } else {
      segmentStartRef.current = Date.now()
      const tick = () => {
        setElapsed(offsetRef.current + Date.now() - segmentStartRef.current)
        rafRef.current = requestAnimationFrame(tick)
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    return () => cancelAnimationFrame(rafRef.current)
  }, [isPaused])

  const seconds = Math.floor(elapsed / 1000)
  const minutes = Math.floor(seconds / 60)
  const display = `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`

  return (
    <div className="flex items-center gap-2" aria-live="polite">
      <span className="recording-dot" style={isPaused ? { animation: "none", opacity: 0.4 } : undefined} />
      <span
        className="text-sm font-semibold text-white/90"
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        {display}
      </span>
    </div>
  )
}

function MiniAudioLevels({
  isPaused,
  micEnabled,
}: {
  isPaused: boolean
  micEnabled: boolean
}) {
  const platform = usePlatform()
  const [levels, setLevels] = useState<AudioLevels>({ mic_level: 0, system_audio_level: 0 })
  const intervalRef = useRef<ReturnType<typeof setInterval>>(0 as unknown as ReturnType<typeof setInterval>)

  useEffect(() => {
    if (!isPaused) {
      const poll = () => {
        platform.invoke<AudioLevels>("get_audio_levels")
          .then(setLevels)
          .catch(() => {})
      }
      intervalRef.current = setInterval(poll, 100)
    } else {
      clearInterval(intervalRef.current)
    }
    return () => clearInterval(intervalRef.current)
  }, [isPaused]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!micEnabled) return null

  return (
    <div className="flex items-end" aria-label="Audio levels">
      <VerticalLevelBar label="mic" level={levels.mic_level} />
    </div>
  )
}

function VerticalLevelBar({ label, level }: { label: string; level: number }) {
  const percent = Math.round(level * 100)
  const color = level > 0.8 ? "#ef4444" : level > 0.5 ? "#eab308" : "rgba(255,255,255,0.6)"

  return (
    <div
      style={{ width: 4, height: 20, position: "relative", borderRadius: 4, overflow: "hidden", background: "rgba(255,255,255,0.1)" }}
      role="meter"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`${label} level`}
      title={label}
    >
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: `${percent}%`,
          background: color,
          borderRadius: 4,
          transition: "height 80ms ease-out, background 200ms ease",
        }}
      />
    </div>
  )
}

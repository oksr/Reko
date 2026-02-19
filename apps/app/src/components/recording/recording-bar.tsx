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
  systemAudioEnabled: boolean
}

export function RecordingBar({
  isPaused,
  onStop,
  onPause,
  onResume,
  micEnabled,
  systemAudioEnabled,
}: Props) {
  return (
    <div className="flex items-center">
      {/* Stop button */}
      <div className="toolbar-group">
        <button
          className="toolbar-btn"
          onClick={onStop}
          onMouseDown={(e) => e.stopPropagation()}
          aria-label="Stop Recording"
          style={{ color: "#ef4444" }}
        >
          <Square size={14} fill="#ef4444" stroke="none" />
          <span>Stop</span>
        </button>
      </div>

      {/* Pause/Resume button */}
      <div className="toolbar-group">
        <button
          className="toolbar-btn"
          onClick={isPaused ? onResume : onPause}
          onMouseDown={(e) => e.stopPropagation()}
          aria-label={isPaused ? "Resume" : "Pause"}
        >
          {isPaused ? <Play size={14} strokeWidth={2} /> : <Pause size={14} strokeWidth={2} />}
          <span>{isPaused ? "Resume" : "Pause"}</span>
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
          systemAudioEnabled={systemAudioEnabled}
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
  systemAudioEnabled,
}: {
  isPaused: boolean
  micEnabled: boolean
  systemAudioEnabled: boolean
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

  const showMic = micEnabled
  const showSystem = systemAudioEnabled

  if (!showMic && !showSystem) return null

  return (
    <div className="flex flex-col gap-1 min-w-[60px]">
      {showMic && (
        <MiniLevelBar label="mic" level={levels.mic_level} />
      )}
      {showSystem && (
        <MiniLevelBar label="sys" level={levels.system_audio_level} />
      )}
    </div>
  )
}

function MiniLevelBar({ label, level }: { label: string; level: number }) {
  const percent = Math.round(level * 100)
  const color = level > 0.8 ? "var(--level-red)" : level > 0.5 ? "var(--level-yellow)" : "var(--level-green)"

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[9px] text-white/40 w-5 text-right" role="meter" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label={`${label} level`}>
        {label}
      </span>
      <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
        <div
          className="level-bar-fill h-full rounded-full"
          style={{ width: `${percent}%`, background: color }}
        />
      </div>
    </div>
  )
}

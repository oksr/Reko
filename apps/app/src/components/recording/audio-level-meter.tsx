import { useState, useEffect, useRef } from "react"
import { usePlatform } from "@/platform/PlatformContext"
import { Label } from "@/components/ui/label"
import type { AudioLevels } from "@/types"

interface Props {
  isRecording: boolean
  isPaused: boolean
}

export function AudioLevelMeter({ isRecording, isPaused }: Props) {
  const platform = usePlatform()
  const [levels, setLevels] = useState<AudioLevels>({ mic_level: 0, system_audio_level: 0 })
  const intervalRef = useRef<ReturnType<typeof setInterval>>(0 as unknown as ReturnType<typeof setInterval>)

  useEffect(() => {
    if (isRecording && !isPaused) {
      const poll = () => {
        platform.invoke<AudioLevels>("get_audio_levels")
          .then(setLevels)
          .catch(() => {})
      }
      intervalRef.current = setInterval(poll, 100)
    } else {
      clearInterval(intervalRef.current)
      if (!isRecording) {
        setLevels({ mic_level: 0, system_audio_level: 0 })
      }
    }
    return () => clearInterval(intervalRef.current)
  }, [isRecording, isPaused]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!isRecording) return null

  return (
    <div className="space-y-2">
      <LevelBar label="Mic" level={levels.mic_level} />
      <LevelBar label="System" level={levels.system_audio_level} />
    </div>
  )
}

function LevelBar({ label, level }: { label: string; level: number }) {
  const percent = Math.round(level * 100)
  const color = level > 0.8 ? "bg-red-500" : level > 0.5 ? "bg-yellow-500" : "bg-green-500"

  return (
    <div className="flex items-center gap-3">
      <Label className="w-14 text-xs text-muted-foreground">{label}</Label>
      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-100 ${color}`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  )
}

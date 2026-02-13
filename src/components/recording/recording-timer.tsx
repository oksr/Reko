import { useState, useEffect, useRef } from "react"
import { Badge } from "@/components/ui/badge"

interface Props {
  isRecording: boolean
  isPaused: boolean
}

export function RecordingTimer({ isRecording, isPaused }: Props) {
  const [elapsed, setElapsed] = useState(0)
  const offsetRef = useRef(0)
  const segmentStartRef = useRef(0)
  const rafRef = useRef(0)

  useEffect(() => {
    if (!isRecording) {
      cancelAnimationFrame(rafRef.current)
      setElapsed(0)
      offsetRef.current = 0
      return
    }

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
  }, [isRecording, isPaused])

  if (!isRecording) return null

  const seconds = Math.floor(elapsed / 1000)
  const minutes = Math.floor(seconds / 60)
  const display = `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`

  return (
    <Badge variant={isPaused ? "secondary" : "destructive"} className="gap-2 text-lg px-4 py-2 tabular-nums">
      {!isPaused && <span className="h-2 w-2 rounded-full bg-white animate-pulse" />}
      {isPaused && <span className="h-2 w-2 rounded-full bg-muted-foreground" />}
      {display}
    </Badge>
  )
}

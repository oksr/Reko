import { useState, useEffect, useRef } from "react"
import { Badge } from "@/components/ui/badge"

interface Props {
  isRecording: boolean
}

export function RecordingTimer({ isRecording }: Props) {
  const [elapsed, setElapsed] = useState(0)
  const startRef = useRef(0)
  const rafRef = useRef(0)

  useEffect(() => {
    if (isRecording) {
      startRef.current = Date.now()
      const tick = () => {
        setElapsed(Date.now() - startRef.current)
        rafRef.current = requestAnimationFrame(tick)
      }
      rafRef.current = requestAnimationFrame(tick)
    } else {
      cancelAnimationFrame(rafRef.current)
      setElapsed(0)
    }
    return () => cancelAnimationFrame(rafRef.current)
  }, [isRecording])

  if (!isRecording) return null

  const seconds = Math.floor(elapsed / 1000)
  const minutes = Math.floor(seconds / 60)
  const display = `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`

  return (
    <Badge variant="destructive" className="gap-2 text-lg px-4 py-2 tabular-nums">
      <span className="h-2 w-2 rounded-full bg-white animate-pulse" />
      {display}
    </Badge>
  )
}

import { Button } from "@/components/ui/button"
import { Circle, Square, Pause, Play } from "lucide-react"

interface Props {
  isRecording: boolean
  isPaused: boolean
  onStart: () => void
  onStop: () => void
  onPause: () => void
  onResume: () => void
  disabled: boolean
}

export function RecordButton({
  isRecording,
  isPaused,
  onStart,
  onStop,
  onPause,
  onResume,
  disabled,
}: Props) {
  if (!isRecording) {
    return (
      <Button
        variant="default"
        size="lg"
        onClick={onStart}
        disabled={disabled}
        className="gap-2"
      >
        <Circle className="h-4 w-4 fill-current" />
        Start Recording
      </Button>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="destructive"
        size="lg"
        onClick={onStop}
        className="gap-2"
      >
        <Square className="h-4 w-4" />
        Stop
      </Button>
      <Button
        variant="outline"
        size="lg"
        onClick={isPaused ? onResume : onPause}
        className="gap-2"
      >
        {isPaused ? (
          <>
            <Play className="h-4 w-4" />
            Resume
          </>
        ) : (
          <>
            <Pause className="h-4 w-4" />
            Pause
          </>
        )}
      </Button>
    </div>
  )
}

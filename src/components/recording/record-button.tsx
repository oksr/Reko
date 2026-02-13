import { Button } from "@/components/ui/button"
import { Circle, Square } from "lucide-react"

interface Props {
  isRecording: boolean
  onStart: () => void
  onStop: () => void
  disabled: boolean
}

export function RecordButton({ isRecording, onStart, onStop, disabled }: Props) {
  return (
    <Button
      variant={isRecording ? "destructive" : "default"}
      size="lg"
      onClick={isRecording ? onStop : onStart}
      disabled={disabled}
      className="gap-2"
    >
      {isRecording ? (
        <>
          <Square className="h-4 w-4" />
          Stop Recording
        </>
      ) : (
        <>
          <Circle className="h-4 w-4 fill-current" />
          Start Recording
        </>
      )}
    </Button>
  )
}

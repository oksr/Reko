import { Button } from "@/components/ui/button"
import { Play, Pause, SkipBack, SkipForward } from "lucide-react"
import { useEditorStore } from "@/stores/editor-store"
import { getSequenceDuration } from "@/lib/sequence"
import type { useVideoSync } from "@/hooks/use-video-sync"

interface PlaybackControlsProps {
  videoSync: ReturnType<typeof useVideoSync>
}

function formatTime(ms: number): string {
  const totalSeconds = ms / 1000
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  const pad = (n: number) => n.toString().padStart(2, "0")
  return `${pad(minutes)}:${pad(Math.floor(seconds))}.${Math.floor((seconds % 1) * 10)}`
}

export function PlaybackControls({ videoSync }: PlaybackControlsProps) {
  const project = useEditorStore((s) => s.project)
  const currentTime = useEditorStore((s) => s.currentTime)
  const isPlaying = useEditorStore((s) => s.isPlaying)
  const setCurrentTime = useEditorStore((s) => s.setCurrentTime)
  const setIsPlaying = useEditorStore((s) => s.setIsPlaying)

  if (!project) return null

  const seqDuration = getSequenceDuration(
    project.sequence.clips,
    project.sequence.transitions
  )

  const handlePlayPause = async () => {
    if (isPlaying) {
      videoSync.pause()
      setIsPlaying(false)
    } else {
      await videoSync.play()
      setIsPlaying(true)
    }
  }

  const handleSkipBack = () => {
    videoSync.seek(0)
    setCurrentTime(0)
  }

  const handleSkipForward = () => {
    videoSync.seek(seqDuration)
    setCurrentTime(seqDuration)
  }

  return (
    <div className="flex items-center gap-2">
      <Button variant="ghost" size="icon" onClick={handleSkipBack} title="Go to start">
        <SkipBack className="w-4 h-4" />
      </Button>

      <Button variant="ghost" size="icon" onClick={handlePlayPause} title={isPlaying ? "Pause" : "Play"}>
        {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
      </Button>

      <Button variant="ghost" size="icon" onClick={handleSkipForward} title="Go to end">
        <SkipForward className="w-4 h-4" />
      </Button>

      {/* tabular-nums for stable digit widths */}
      <span className="text-xs font-mono text-muted-foreground ml-2" style={{ fontVariantNumeric: "tabular-nums" }}>
        {formatTime(currentTime)} / {formatTime(seqDuration)}
      </span>
    </div>
  )
}

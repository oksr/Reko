import { useState, useEffect } from "react"
import { invoke } from "@tauri-apps/api/core"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { SourcePicker } from "@/components/recording/source-picker"
import { RecordButton } from "@/components/recording/record-button"
import { RecordingTimer } from "@/components/recording/recording-timer"
import { AudioLevelMeter } from "@/components/recording/audio-level-meter"
import { Pencil } from "lucide-react"
import type { ProjectState } from "@/types"

export function RecorderApp() {
  const [selectedDisplay, setSelectedDisplay] = useState<number | null>(null)
  const [selectedMic, setSelectedMic] = useState<string | null>(null)
  const [selectedCamera, setSelectedCamera] = useState<string | null>(null)
  const [isRecording, setIsRecording] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [recentProjects, setRecentProjects] = useState<ProjectState[]>([])
  const [error, setError] = useState<string | null>(null)

  // Load recent projects on mount
  useEffect(() => {
    invoke<ProjectState[]>("list_projects")
      .then((projects) => setRecentProjects(projects.slice(0, 5)))
      .catch(() => {}) // Silently fail if no projects yet
  }, [])

  const handleStart = async () => {
    if (!selectedDisplay) return
    setIsLoading(true)
    setError(null)
    try {
      await invoke("start_recording", {
        config: {
          display_id: selectedDisplay,
          mic_id: selectedMic,
          camera_id: selectedCamera,
          capture_system_audio: true,
          fps: 60,
        },
      })
      setIsRecording(true)
      setIsPaused(false)
    } catch (e) {
      setError(String(e))
    } finally {
      setIsLoading(false)
    }
  }

  const handleStop = async () => {
    setIsLoading(true)
    try {
      const project = await invoke<ProjectState>("stop_recording")
      setIsRecording(false)
      setIsPaused(false)
      // Auto-open editor immediately after recording stops
      setRecentProjects((prev) => [project, ...prev.slice(0, 4)])
      await invoke("open_editor", { projectId: project.id })
    } catch (e) {
      setError(String(e))
    } finally {
      setIsLoading(false)
    }
  }

  const handlePause = async () => {
    try {
      await invoke("pause_recording")
      setIsPaused(true)
    } catch (e) {
      setError(String(e))
    }
  }

  const handleResume = async () => {
    try {
      await invoke("resume_recording")
      setIsPaused(false)
    } catch (e) {
      setError(String(e))
    }
  }

  const handleOpenEditor = async (projectId: string) => {
    try {
      await invoke("open_editor", { projectId })
    } catch (e) {
      setError(String(e))
    }
  }

  return (
    <main className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">CaptureKit</h1>
        <RecordingTimer isRecording={isRecording} isPaused={isPaused} />
      </div>

      {error && (
        <p className="text-sm text-destructive bg-destructive/10 rounded px-3 py-2">{error}</p>
      )}

      <Card>
        <CardContent className="pt-4 space-y-4">
          <SourcePicker
            onDisplaySelected={setSelectedDisplay}
            selectedDisplayId={selectedDisplay}
            onMicSelected={setSelectedMic}
            selectedMicId={selectedMic}
            onCameraSelected={setSelectedCamera}
            selectedCameraId={selectedCamera}
          />

          <div className="flex items-center gap-3">
            <RecordButton
              isRecording={isRecording}
              isPaused={isPaused}
              onStart={handleStart}
              onStop={handleStop}
              onPause={handlePause}
              onResume={handleResume}
              disabled={!selectedDisplay || isLoading}
            />
          </div>

          {isRecording && (
            <AudioLevelMeter isRecording={isRecording} isPaused={isPaused} />
          )}
        </CardContent>
      </Card>

      {/* Recent projects list */}
      {!isRecording && recentProjects.length > 0 && (
        <Card>
          <CardContent className="pt-4">
            <h2 className="text-sm font-medium mb-2">Recent</h2>
            <div className="space-y-2">
              {recentProjects.map((p) => (
                <div key={p.id} className="flex items-center justify-between text-sm">
                  <div className="truncate flex-1 mr-2">
                    <p className="font-medium truncate">{p.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {(p.timeline.duration_ms / 1000).toFixed(1)}s
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleOpenEditor(p.id)}
                  >
                    <Pencil className="w-3 h-3 mr-1" />
                    Edit
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </main>
  )
}

import { useState, useEffect } from "react"
import { invoke } from "@tauri-apps/api/core"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { SourcePicker } from "@/components/recording/source-picker"
import { RecordButton } from "@/components/recording/record-button"
import { RecordingTimer } from "@/components/recording/recording-timer"
import { AudioLevelMeter } from "@/components/recording/audio-level-meter"
import type { ProjectState } from "@/types"

function App() {
  const [engineVersion, setEngineVersion] = useState("")
  const [selectedDisplay, setSelectedDisplay] = useState<number | null>(null)
  const [selectedMic, setSelectedMic] = useState<string | null>(null)
  const [selectedCamera, setSelectedCamera] = useState<string | null>(null)
  const [isRecording, setIsRecording] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [lastProject, setLastProject] = useState<ProjectState | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    invoke<string>("get_engine_version").then(setEngineVersion)
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
      setLastProject(project)
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

  return (
    <main className="min-h-screen p-8 max-w-2xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">CaptureKit</h1>
        <p className="text-sm text-muted-foreground">Engine v{engineVersion}</p>
      </div>

      {error && (
        <Card className="mb-4 border-destructive">
          <CardContent className="pt-4">
            <p className="text-sm text-destructive">{error}</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Record</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <SourcePicker
            onDisplaySelected={setSelectedDisplay}
            selectedDisplayId={selectedDisplay}
            onMicSelected={setSelectedMic}
            selectedMicId={selectedMic}
            onCameraSelected={setSelectedCamera}
            selectedCameraId={selectedCamera}
          />

          <Separator />

          <div className="flex items-center gap-4">
            <RecordButton
              isRecording={isRecording}
              isPaused={isPaused}
              onStart={handleStart}
              onStop={handleStop}
              onPause={handlePause}
              onResume={handleResume}
              disabled={!selectedDisplay || isLoading}
            />
            <RecordingTimer isRecording={isRecording} isPaused={isPaused} />
          </div>

          {isRecording && (
            <AudioLevelMeter isRecording={isRecording} isPaused={isPaused} />
          )}
        </CardContent>
      </Card>

      {lastProject && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Last Recording</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p><span className="text-muted-foreground">Name:</span> {lastProject.name}</p>
            <p><span className="text-muted-foreground">Duration:</span> {(lastProject.timeline.duration_ms / 1000).toFixed(1)}s</p>
            <p><span className="text-muted-foreground">Screen:</span> {lastProject.tracks.screen}</p>
            {lastProject.tracks.mic && (
              <p><span className="text-muted-foreground">Mic:</span> {lastProject.tracks.mic}</p>
            )}
            {lastProject.tracks.system_audio && (
              <p><span className="text-muted-foreground">System Audio:</span> {lastProject.tracks.system_audio}</p>
            )}
            {lastProject.tracks.camera && (
              <p><span className="text-muted-foreground">Camera:</span> {lastProject.tracks.camera}</p>
            )}
          </CardContent>
        </Card>
      )}
    </main>
  )
}

export default App

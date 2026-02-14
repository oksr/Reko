import { useState, useEffect, useCallback, useRef } from "react"
import { invoke } from "@tauri-apps/api/core"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { WebviewWindow } from "@tauri-apps/api/webviewWindow"
import { register, unregister } from "@tauri-apps/plugin-global-shortcut"
import { TooltipProvider } from "@/components/ui/tooltip"
import { PermissionCheck } from "@/components/recording/permission-check"
import { SourceTypeButton, type SourceType } from "@/components/recording/source-type-button"
import { InputToggle } from "@/components/recording/input-toggle"
import { Countdown } from "@/components/recording/countdown"
import { RecordingBar } from "@/components/recording/recording-bar"
import { SettingsPopover } from "@/components/recording/settings-popover"
import { X, Circle } from "lucide-react"
import type { DisplayInfo, AudioInputInfo, CameraInfo, ProjectState } from "@/types"

type AppState = "permission-check" | "idle" | "countdown" | "recording"

export function RecorderApp() {
  const [appState, setAppState] = useState<AppState>("permission-check")

  // Display selection
  const [displays, setDisplays] = useState<DisplayInfo[]>([])
  const [selectedDisplay, setSelectedDisplay] = useState<number | null>(null)

  // Input toggles
  const [cameraEnabled, setCameraEnabled] = useState(false)
  const [micEnabled, setMicEnabled] = useState(false)
  const [systemAudioEnabled, setSystemAudioEnabled] = useState(true)
  const [selectedCamera, setSelectedCamera] = useState<string | null>(null)
  const [selectedMic, setSelectedMic] = useState<string | null>(null)

  // Device lists
  const [cameras, setCameras] = useState<CameraInfo[]>([])
  const [mics, setMics] = useState<AudioInputInfo[]>([])

  // Recording state
  const [isPaused, setIsPaused] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  // Source type
  const [sourceType, setSourceType] = useState<SourceType>("display")

  // Settings
  const [countdownEnabled, setCountdownEnabled] = useState(true)
  const [recentProjects, setRecentProjects] = useState<ProjectState[]>([])

  // Permission granted -> load devices
  const handlePermissionGranted = useCallback(() => {
    setAppState("idle")

    invoke<DisplayInfo[]>("list_displays")
      .then((result) => {
        setDisplays(result)
        const main = result.find((d) => d.is_main)
        if (main) setSelectedDisplay(main.id)
      })
      .catch(() => {})

    invoke<AudioInputInfo[]>("list_audio_inputs")
      .then(setMics)
      .catch(() => {})

    invoke<CameraInfo[]>("list_cameras")
      .then(setCameras)
      .catch(() => {})

    invoke<ProjectState[]>("list_projects")
      .then((projects) => setRecentProjects(projects.slice(0, 5)))
      .catch(() => {})
  }, [])

  // Position window on mount
  useEffect(() => {
    const positionWindow = async () => {
      try {
        const win = getCurrentWindow()
        const monitor = await win.currentMonitor()
        if (monitor) {
          const { width: screenW, height: screenH } = monitor.size
          const scaleFactor = monitor.scaleFactor
          const winW = 700
          const winH = 300
          const x = Math.round((screenW / scaleFactor - winW) / 2)
          const y = Math.round(screenH / scaleFactor - winH - 80)
          await win.setPosition(new (await import("@tauri-apps/api/dpi")).LogicalPosition(x, y))
        }
      } catch {
        // Fallback: window is already centered
      }
    }
    positionWindow()
  }, [])

  // Refs for stale closure avoidance in event listeners
  const micEnabledRef = useRef(micEnabled)
  const selectedMicRef = useRef(selectedMic)
  const cameraEnabledRef = useRef(cameraEnabled)
  const selectedCameraRef = useRef(selectedCamera)
  const systemAudioEnabledRef = useRef(systemAudioEnabled)
  micEnabledRef.current = micEnabled
  selectedMicRef.current = selectedMic
  cameraEnabledRef.current = cameraEnabled
  selectedCameraRef.current = selectedCamera
  systemAudioEnabledRef.current = systemAudioEnabled

  // Listen for window-selected event from picker overlay
  useEffect(() => {
    const unlisten = getCurrentWindow().listen<{ windowId: number }>(
      "window-selected",
      async (event) => {
        const windowId = event.payload.windowId
        setIsLoading(true)
        try {
          await invoke("start_recording", {
            config: {
              display_id: null,
              window_id: windowId,
              mic_id: micEnabledRef.current ? selectedMicRef.current : null,
              camera_id: cameraEnabledRef.current ? selectedCameraRef.current : null,
              capture_system_audio: systemAudioEnabledRef.current,
              fps: 60,
            },
          })
          setAppState("recording")
          setIsPaused(false)
        } catch (e) {
          console.error("Failed to start recording:", e)
        } finally {
          setIsLoading(false)
        }
      }
    )
    return () => { unlisten.then((fn) => fn()) }
  }, [])

  const openWindowPicker = async () => {
    try {
      const width = window.screen.width
      const height = window.screen.height

      new WebviewWindow("window-picker", {
        url: "/window-picker",
        width,
        height,
        x: 0,
        y: 0,
        decorations: false,
        transparent: true,
        alwaysOnTop: true,
        resizable: false,
        skipTaskbar: true,
      })
    } catch (e) {
      console.error("Failed to open window picker:", e)
    }
  }

  const handleSourceTypeChange = async (type: SourceType) => {
    setSourceType(type)
    if (type === "window") {
      openWindowPicker()
    }
  }

  const handleStartRecording = async () => {
    if (sourceType === "window") {
      openWindowPicker()
      return
    }
    if (!selectedDisplay) return

    if (countdownEnabled) {
      setAppState("countdown")
    } else {
      await startRecording()
    }
  }

  const startRecording = async () => {
    setIsLoading(true)
    try {
      await invoke("start_recording", {
        config: {
          display_id: selectedDisplay,
          window_id: null,
          mic_id: micEnabled ? selectedMic : null,
          camera_id: cameraEnabled ? selectedCamera : null,
          capture_system_audio: systemAudioEnabled,
          fps: 60,
        },
      })
      setAppState("recording")
      setIsPaused(false)
    } catch (e) {
      console.error("Failed to start recording:", e)
      setAppState("idle")
    } finally {
      setIsLoading(false)
    }
  }

  const handleCountdownComplete = async () => {
    await startRecording()
  }

  const handleCountdownCancel = () => {
    setAppState("idle")
  }

  const handleStop = async () => {
    setIsLoading(true)
    try {
      const project = await invoke<ProjectState>("stop_recording")
      setAppState("idle")
      setIsPaused(false)
      setRecentProjects((prev) => [project, ...prev.slice(0, 4)])
      await invoke("open_editor", { projectId: project.id })
    } catch (e) {
      console.error("Failed to stop recording:", e)
    } finally {
      setIsLoading(false)
    }
  }

  const handlePause = async () => {
    try {
      await invoke("pause_recording")
      setIsPaused(true)
    } catch (e) {
      console.error("Failed to pause:", e)
    }
  }

  const handleResume = async () => {
    try {
      await invoke("resume_recording")
      setIsPaused(false)
    } catch (e) {
      console.error("Failed to resume:", e)
    }
  }

  const handleClose = () => {
    getCurrentWindow().close()
  }

  const handleOpenEditor = async (projectId: string) => {
    try {
      await invoke("open_editor", { projectId })
    } catch (e) {
      console.error("Failed to open editor:", e)
    }
  }

  // Global shortcut: Cmd+Shift+R
  const appStateRef = useRef(appState)
  appStateRef.current = appState
  const handleStartRef = useRef(handleStartRecording)
  const handleStopRef = useRef(handleStop)
  handleStartRef.current = handleStartRecording
  handleStopRef.current = handleStop

  useEffect(() => {
    const shortcut = "CommandOrControl+Shift+R"
    register(shortcut, (event) => {
      if (event.state !== "Pressed") return
      const state = appStateRef.current
      if (state === "idle") {
        handleStartRef.current()
      } else if (state === "recording") {
        handleStopRef.current()
      }
    }).catch(() => {})
    return () => {
      unregister(shortcut).catch(() => {})
    }
  }, [])

  // Drag handler — startDragging is more reliable than data-tauri-drag-region
  // for transparent windows where child elements cover the entire surface
  const handleDrag = (e: React.MouseEvent) => {
    // Don't drag when clicking interactive elements
    const target = e.target as HTMLElement
    if (target.closest("button, [role=button], input, select, [data-no-drag]")) return
    getCurrentWindow().startDragging()
  }

  // Toggle handlers that auto-select default device
  const handleToggleCamera = (enabled: boolean) => {
    setCameraEnabled(enabled)
    if (enabled && !selectedCamera && cameras.length > 0) {
      setSelectedCamera(cameras[0].id)
    }
  }

  const handleToggleMic = (enabled: boolean) => {
    setMicEnabled(enabled)
    if (enabled && !selectedMic && mics.length > 0) {
      setSelectedMic(mics[0].id)
    }
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div className="recorder-window">
        {appState === "permission-check" && (
          <div className="recorder-toolbar" style={{ justifyContent: "center" }}>
            <PermissionCheck onPermissionGranted={handlePermissionGranted} />
          </div>
        )}

        {appState === "idle" && (
          <div
            className="recorder-toolbar"
            onMouseDown={handleDrag}
            role="toolbar"
            aria-label="Recording controls"
          >
            {/* Close button */}
            <div className="toolbar-group">
              <button
                className="toolbar-btn-icon"
                onClick={handleClose}
                aria-label="Close"
              >
                <X size={16} strokeWidth={2} />
              </button>
            </div>

            <div className="toolbar-divider" />

            {/* Source type */}
            <div className="toolbar-group">
              <SourceTypeButton
                sourceType={sourceType}
                onSourceTypeChange={handleSourceTypeChange}
              />
            </div>

            <div className="toolbar-divider" />

            {/* Input toggles */}
            <div className="toolbar-group">
              <InputToggle
                type="camera"
                enabled={cameraEnabled}
                onToggle={handleToggleCamera}
                selectedDeviceId={selectedCamera}
                onDeviceSelect={setSelectedCamera}
                devices={cameras}
              />
              <InputToggle
                type="mic"
                enabled={micEnabled}
                onToggle={handleToggleMic}
                selectedDeviceId={selectedMic}
                onDeviceSelect={setSelectedMic}
                devices={mics}
              />
              <InputToggle
                type="system-audio"
                enabled={systemAudioEnabled}
                onToggle={setSystemAudioEnabled}
                selectedDeviceId={null}
                onDeviceSelect={() => {}}
                devices={[]}
              />
            </div>

            <div className="toolbar-divider" />

            {/* Record button */}
            <div className="toolbar-group">
              <button
                className={`record-btn ${(sourceType === "display" && !selectedDisplay) || isLoading ? "disabled" : ""}`}
                onClick={handleStartRecording}
                disabled={(sourceType === "display" && !selectedDisplay) || isLoading}
                aria-label="Start Recording (Cmd+Shift+R)"
                title="Start Recording (Cmd+Shift+R)"
              >
                <Circle size={24} fill="#ef4444" stroke="none" />
              </button>

              <SettingsPopover
                countdownEnabled={countdownEnabled}
                onCountdownToggle={setCountdownEnabled}
                recentProjects={recentProjects}
                onOpenEditor={handleOpenEditor}
              />
            </div>
          </div>
        )}

        {appState === "countdown" && (
          <div
            className="recorder-toolbar"
            style={{ justifyContent: "center" }}
            onMouseDown={handleDrag}
          >
            <Countdown
              onComplete={handleCountdownComplete}
              onCancel={handleCountdownCancel}
            />
          </div>
        )}

        {appState === "recording" && (
          <div
            className="recorder-toolbar recording"
            onMouseDown={handleDrag}
            role="toolbar"
            aria-label="Recording controls"
          >
            <RecordingBar
              isPaused={isPaused}
              onStop={handleStop}
              onPause={handlePause}
              onResume={handleResume}
              micEnabled={micEnabled}
              systemAudioEnabled={systemAudioEnabled}
            />
          </div>
        )}
      </div>
    </TooltipProvider>
  )
}

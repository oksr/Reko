import { useState, useEffect, useCallback, useRef } from "react"
import { invoke } from "@tauri-apps/api/core"
import { getCurrentWindow, currentMonitor } from "@tauri-apps/api/window"
import { WebviewWindow } from "@tauri-apps/api/webviewWindow"
import { register, unregister } from "@tauri-apps/plugin-global-shortcut"
import { motion, AnimatePresence, useReducedMotion } from "motion/react"
import { TooltipProvider } from "@/components/ui/tooltip"
import { PermissionCheck } from "@/components/recording/permission-check"
import { SourceTypeButton, type SourceType } from "@/components/recording/source-type-button"
import { InputToggle } from "@/components/recording/input-toggle"
import { RecordingBar } from "@/components/recording/recording-bar"
import { SettingsPopover } from "@/components/recording/settings-popover"
import { X, Circle } from "lucide-react"
import type { DisplayInfo, AudioInputInfo, CameraInfo, ProjectState } from "@/types"

type AppState = "permission-check" | "idle" | "recording"

// ease-in-out-quart — for on-screen morphing (Emil: "elements already on screen that move")
const MORPH_EASE = [0.77, 0, 0.175, 1] as const
const MORPH_DURATION = 0.3

const contentVariants = {
  initial: { opacity: 0, scale: 0.96 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.96 },
}

const contentTransition = {
  duration: MORPH_DURATION * 0.4, // 120ms — fast enough to feel snappy within the 300ms morph
  ease: MORPH_EASE,
}

export function RecorderApp() {
  const [appState, setAppState] = useState<AppState>("permission-check")

  // Display selection
  const [_displays, setDisplays] = useState<DisplayInfo[]>([])
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
  const windowHiddenRef = useRef(false)

  // Source type
  const [sourceType, setSourceType] = useState<SourceType>("display")

  // Settings
  const [recentProjects, setRecentProjects] = useState<ProjectState[]>([])

  // First-launch onboarding: open onboarding window and hide recorder
  useEffect(() => {
    const completed = localStorage.getItem("onboarding_completed")
    if (completed === "true") return

    // Hide recorder and open onboarding window
    const win = getCurrentWindow()
    windowHiddenRef.current = true
    win.hide().catch(() => {})

    new WebviewWindow("onboarding", {
      url: "/onboarding",
      width: 500,
      height: 400,
      resizable: false,
      decorations: false,
      transparent: false,
      center: true,
      title: "Reko — Setup",
    })

    // Listen for onboarding window close to show recorder
    const unlisten = win.listen("tauri://focus", async () => {
      if (localStorage.getItem("onboarding_completed") === "true") {
        windowHiddenRef.current = false
        handlePermissionGranted()
      }
    })

    return () => { unlisten.then((fn) => fn()) }
  }, [])

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

  // Position window at bottom-center on mount
  useEffect(() => {
    const init = async () => {
      const win = getCurrentWindow()
      try {
        const monitor = await currentMonitor()
        if (monitor) {
          const factor = monitor.scaleFactor
          const screenW = monitor.size.width / factor
          const screenH = monitor.size.height / factor
          const winH = 58
          const margin = 50
          const x = Math.round((screenW - 684) / 2)
          const y = Math.round(screenH - winH - margin)
          const { LogicalPosition } = await import("@tauri-apps/api/dpi")
          await win.setPosition(new LogicalPosition(x, y))
        }
      } catch (e) {
        console.error("Failed to position window:", e)
      }
      if (!windowHiddenRef.current) {
        await win.show().catch(() => {})
      }
    }
    init()
  }, [])

  // Sync window size to toolbar's rendered width via callback ref
  const observerRef = useRef<ResizeObserver | null>(null)

  const toolbarRef = useCallback((el: HTMLDivElement | null) => {
    // Clean up previous observer
    if (observerRef.current) {
      observerRef.current.disconnect()
      observerRef.current = null
    }
    if (!el) return

    const sync = async (width: number) => {
      const win = getCurrentWindow()
      try {
        const monitor = await currentMonitor()
        if (!monitor) return
        const factor = monitor.scaleFactor
        const screenW = monitor.size.width / factor
        const screenH = monitor.size.height / factor
        const winW = Math.round(width)
        const winH = 58
        const margin = 50
        const x = Math.round((screenW - winW) / 2)
        const y = Math.round(screenH - winH - margin)
        const { LogicalPosition, LogicalSize } = await import("@tauri-apps/api/dpi")
        await win.setResizable(true)
        await win.setSize(new LogicalSize(winW, winH))
        await win.setResizable(false)
        await win.setPosition(new LogicalPosition(x, y))
      } catch (e) {
        console.error("Failed to sync window size:", e)
      }
    }

    observerRef.current = new ResizeObserver(() => {
      sync(el.offsetWidth)
    })
    observerRef.current.observe(el)
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
    await startRecording()
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

  const handleStop = async () => {
    setIsLoading(true)
    try {
      const project = await invoke<ProjectState>("stop_recording")
      windowHiddenRef.current = true
      await getCurrentWindow().hide()
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

  const shouldReduceMotion = useReducedMotion()

  return (
    <TooltipProvider delayDuration={300}>
      <div className="recorder-window">
        {appState === "permission-check" ? (
          <div className="recorder-toolbar" style={{ justifyContent: "center" }}>
            <PermissionCheck onPermissionGranted={handlePermissionGranted} />
          </div>
        ) : (
          <div
            ref={toolbarRef}
            className="recorder-toolbar"
            onMouseDown={handleDrag}
            role="toolbar"
            aria-label="Recording controls"
          >
            <AnimatePresence mode="wait" initial={false}>
              {appState === "idle" && (
                <motion.div
                  key="idle"
                  className="flex w-full items-center"
                  variants={contentVariants}
                  initial={shouldReduceMotion ? false : "initial"}
                  animate="animate"
                  exit={shouldReduceMotion ? undefined : "exit"}
                  transition={contentTransition}
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
                      recentProjects={recentProjects}
                      onOpenEditor={handleOpenEditor}
                    />
                  </div>
                </motion.div>
              )}

              {appState === "recording" && (
                <motion.div
                  key="recording"
                  className="flex items-center"
                  variants={contentVariants}
                  initial={shouldReduceMotion ? false : "initial"}
                  animate="animate"
                  exit={shouldReduceMotion ? undefined : "exit"}
                  transition={contentTransition}
                >
                  <RecordingBar
                    isPaused={isPaused}
                    onStop={handleStop}
                    onPause={handlePause}
                    onResume={handleResume}
                    micEnabled={micEnabled}
                    systemAudioEnabled={systemAudioEnabled}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>
    </TooltipProvider>
  )
}

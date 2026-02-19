import { useState, useEffect, useCallback, useRef } from "react"
import { usePlatform } from "@/platform/PlatformContext"
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

// Dynamic Island–style container morph
const TOOLBAR_WIDTHS = { idle: 720, recording: 340 } as const

const CONTAINER_SPRING = {
  type: "spring" as const,
  stiffness: 380,
  damping: 28,
  mass: 1,
}

// Content cross-fade with blur dissolve
const contentVariants = {
  initial: { opacity: 0, scale: 0.92, filter: "blur(4px)" },
  animate: {
    opacity: 1, scale: 1, filter: "blur(0px)",
    transition: { duration: 0.15, ease: [0, 0, 0.2, 1] as [number, number, number, number] },
  },
  exit: {
    opacity: 0, scale: 0.92, filter: "blur(4px)",
    transition: { duration: 0.08, ease: [0.4, 0, 1, 1] as [number, number, number, number] },
  },
}

export function RecorderApp() {
  const platform = usePlatform()
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

  // Permission granted -> load devices
  const handlePermissionGranted = useCallback(() => {
    setAppState("idle")

    platform.invoke<DisplayInfo[]>("list_displays")
      .then((result) => {
        setDisplays(result)
        const main = result.find((d) => d.is_main)
        if (main) setSelectedDisplay(main.id)
      })
      .catch(() => {})

    platform.invoke<AudioInputInfo[]>("list_audio_inputs")
      .then(setMics)
      .catch(() => {})

    platform.invoke<CameraInfo[]>("list_cameras")
      .then(setCameras)
      .catch(() => {})

    platform.invoke<ProjectState[]>("list_projects")
      .then((projects) => setRecentProjects(projects.slice(0, 5)))
      .catch(() => {})
  }, [platform])

  // First-launch onboarding: open onboarding window and hide recorder
  useEffect(() => {
    const completed = localStorage.getItem("onboarding_completed")
    if (completed === "true") return

    // Hide recorder and open onboarding window
    windowHiddenRef.current = true
    platform.window.hide().catch(() => {})

    platform.navigation.openWindow({
      url: "/",
      label: "onboarding",
      width: 500,
      height: 400,
      resizable: false,
      decorations: false,
      transparent: false,
      title: "Reko — Setup",
    })

    // Listen for focus to detect when onboarding is done
    const unlistenPromise = platform.window.listen("tauri://focus", async () => {
      if (localStorage.getItem("onboarding_completed") === "true") {
        windowHiddenRef.current = false
        handlePermissionGranted()
      }
    })

    return () => { unlistenPromise.then((fn) => fn()) }
  }, [handlePermissionGranted]) // eslint-disable-line react-hooks/exhaustive-deps

  // Position window at bottom-center on mount
  useEffect(() => {
    const init = async () => {
      try {
        const monitor = await platform.monitor.getCurrent()
        if (monitor) {
          const factor = monitor.scaleFactor
          const screenW = monitor.size.width / factor
          const screenH = monitor.size.height / factor
          const winH = 58
          const margin = 50
          const x = Math.round((screenW - 684) / 2)
          const y = Math.round(screenH - winH - margin)
          await platform.window.setPosition(x, y)
        }
      } catch (e) {
        console.error("Failed to position window:", e)
      }
      if (!windowHiddenRef.current) {
        await platform.window.show().catch(() => {})
      }
    }
    init()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Sync window size to toolbar's rendered width via callback ref
  const observerRef = useRef<ResizeObserver | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const syncWindowSize = useCallback(async (width: number) => {
    try {
      const monitor = await platform.monitor.getCurrent()
      if (!monitor) return
      const factor = monitor.scaleFactor
      const screenW = monitor.size.width / factor
      const screenH = monitor.size.height / factor
      const winW = Math.round(width)
      const winH = 58
      const margin = 50
      const x = Math.round((screenW - winW) / 2)
      const y = Math.round(screenH - winH - margin)
      await platform.window.setResizable(true)
      await platform.window.setSize(winW, winH)
      await platform.window.setResizable(false)
      await platform.window.setPosition(x, y)
    } catch (e) {
      console.error("Failed to sync window size:", e)
    }
  }, [platform])

  // On state change, immediately expand window to max width so content never clips during spring
  useEffect(() => {
    if (appState === "permission-check") return
    const maxWidth = Math.max(TOOLBAR_WIDTHS.idle, TOOLBAR_WIDTHS.recording)
    syncWindowSize(maxWidth)
  }, [appState, syncWindowSize])

  const toolbarRef = useCallback((el: HTMLDivElement | null) => {
    // Clean up previous observer
    if (observerRef.current) {
      observerRef.current.disconnect()
      observerRef.current = null
    }
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    if (!el) return

    observerRef.current = new ResizeObserver(() => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        syncWindowSize(el.offsetWidth)
      }, 100)
    })
    observerRef.current.observe(el)
  }, [syncWindowSize])

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
    const unlistenPromise = platform.window.listen<{ windowId: number }>(
      "window-selected",
      async (payload) => {
        const windowId = payload.windowId
        setIsLoading(true)
        try {
          await platform.invoke("start_recording", {
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
    return () => { unlistenPromise.then((fn) => fn()) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const openWindowPicker = async () => {
    try {
      const width = window.screen.width
      const height = window.screen.height

      await platform.navigation.openWindow({
        url: "/",
        label: "window-picker",
        width,
        height,
        decorations: false,
        transparent: true,
        alwaysOnTop: true,
        resizable: false,
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
      await platform.invoke("start_recording", {
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
      const project = await platform.invoke<ProjectState>("stop_recording")
      windowHiddenRef.current = true
      await platform.window.hide()
      setAppState("idle")
      setIsPaused(false)
      setRecentProjects((prev) => [project, ...prev.slice(0, 4)])
      await platform.invoke("open_editor", { projectId: project.id })
    } catch (e) {
      console.error("Failed to stop recording:", e)
    } finally {
      setIsLoading(false)
    }
  }

  const handlePause = async () => {
    try {
      await platform.invoke("pause_recording")
      setIsPaused(true)
    } catch (e) {
      console.error("Failed to pause:", e)
    }
  }

  const handleResume = async () => {
    try {
      await platform.invoke("resume_recording")
      setIsPaused(false)
    } catch (e) {
      console.error("Failed to resume:", e)
    }
  }

  const handleClose = () => {
    platform.window.close()
  }

  const handleOpenEditor = async (projectId: string) => {
    try {
      await platform.invoke("open_editor", { projectId })
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
    platform.shortcuts.register(shortcut, () => {
      const state = appStateRef.current
      if (state === "idle") {
        handleStartRef.current()
      } else if (state === "recording") {
        handleStopRef.current()
      }
    }).catch(() => {})
    return () => {
      platform.shortcuts.unregister(shortcut).catch(() => {})
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Drag handler
  const handleDrag = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    if (target.closest("button, [role=button], input, select, [data-no-drag]")) return
    platform.window.startDragging()
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
          <motion.div
            ref={toolbarRef}
            className="recorder-toolbar"
            onMouseDown={handleDrag}
            role="toolbar"
            aria-label="Recording controls"
            animate={{
              width: appState === "recording"
                ? TOOLBAR_WIDTHS.recording
                : TOOLBAR_WIDTHS.idle,
            }}
            transition={shouldReduceMotion ? { duration: 0 } : CONTAINER_SPRING}
          >
            <AnimatePresence mode="wait" initial={false}>
              {appState === "idle" && (
                <motion.div
                  key="idle"
                  className="flex w-full items-center"
                  variants={shouldReduceMotion ? undefined : contentVariants}
                  initial={shouldReduceMotion ? false : "initial"}
                  animate="animate"
                  exit={shouldReduceMotion ? undefined : "exit"}
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
                  variants={shouldReduceMotion ? undefined : contentVariants}
                  initial={shouldReduceMotion ? false : "initial"}
                  animate="animate"
                  exit={shouldReduceMotion ? undefined : "exit"}
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
          </motion.div>
        )}
      </div>
    </TooltipProvider>
  )
}

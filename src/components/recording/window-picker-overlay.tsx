import { useState, useEffect, useCallback, useRef } from "react"
import { invoke } from "@tauri-apps/api/core"
import { Circle, X } from "lucide-react"
import type { WindowInfo } from "@/types"

const DIM = "rgba(0,0,0,0.5)"

/** Renders 4 dark rectangles around a target window, leaving a clear cutout. */
function DimOverlay({
  target,
  toOverlayX,
  toOverlayY,
}: {
  target: WindowInfo | null
  toOverlayX: (w: WindowInfo) => number
  toOverlayY: (w: WindowInfo) => number
}) {
  if (!target) {
    // No target — dim entire screen
    return <div className="absolute inset-0" style={{ backgroundColor: DIM, pointerEvents: "none" }} />
  }

  const x = toOverlayX(target)
  const y = toOverlayY(target)
  const w = target.width
  const h = target.height

  return (
    <>
      {/* Top */}
      <div className="absolute left-0 right-0 top-0" style={{ height: y, backgroundColor: DIM, pointerEvents: "none" }} />
      {/* Bottom */}
      <div className="absolute left-0 right-0 bottom-0" style={{ top: y + h, backgroundColor: DIM, pointerEvents: "none" }} />
      {/* Left */}
      <div className="absolute left-0" style={{ top: y, width: x, height: h, backgroundColor: DIM, pointerEvents: "none" }} />
      {/* Right */}
      <div className="absolute right-0" style={{ top: y, left: x + w, height: h, backgroundColor: DIM, pointerEvents: "none" }} />
    </>
  )
}

interface Props {
  onStartRecording: (windowId: number) => void
  onCancel: () => void
}

export function WindowPickerOverlay({ onStartRecording, onCancel }: Props) {
  const [windows, setWindows] = useState<WindowInfo[]>([])
  const [hoveredWindow, setHoveredWindow] = useState<WindowInfo | null>(null)
  const [selectedWindow, setSelectedWindow] = useState<WindowInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const containerRef = useRef<HTMLDivElement>(null)

  // Fetch windows on mount
  useEffect(() => {
    invoke<WindowInfo[]>("list_windows")
      .then(setWindows)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (selectedWindow) {
          setSelectedWindow(null)
        } else {
          onCancel()
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [selectedWindow, onCancel])

  // ScreenCaptureKit uses Core Graphics coordinates (top-left origin),
  // same as web — no conversion needed
  const toOverlayX = useCallback((w: WindowInfo) => w.x, [])
  const toOverlayY = useCallback((w: WindowInfo) => w.y, [])

  // Hit-test mouse position against window rects
  // ScreenCaptureKit returns windows in z-order (front-to-back),
  // so the first match is the topmost visible window
  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (selectedWindow) return

      const mx = e.clientX
      const my = e.clientY

      for (const w of windows) {
        const wx = toOverlayX(w)
        const wy = toOverlayY(w)
        if (mx >= wx && mx <= wx + w.width && my >= wy && my <= wy + w.height) {
          setHoveredWindow(w)
          return
        }
      }

      setHoveredWindow(null)
    },
    [windows, selectedWindow, toOverlayX, toOverlayY]
  )

  const handleClick = useCallback(() => {
    if (hoveredWindow && !selectedWindow) {
      setSelectedWindow(hoveredWindow)
    }
  }, [hoveredWindow, selectedWindow])

  const handleStartRecording = useCallback(() => {
    if (selectedWindow) {
      onStartRecording(selectedWindow.id)
    }
  }, [selectedWindow, onStartRecording])

  // Empty state: no windows found
  if (!loading && windows.length === 0) {
    return (
      <div className="fixed inset-0" style={{ zIndex: 9999 }}>
        <div className="absolute inset-0 bg-black/50" />
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
          <p className="text-white/60 text-lg">No windows available</p>
          <button
            className="px-4 py-2 bg-white/10 hover:bg-white/15 text-white rounded-lg transition-colors"
            onClick={onCancel}
          >
            Go back
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 cursor-crosshair"
      onMouseMove={handleMouseMove}
      onClick={handleClick}
      style={{ zIndex: 9999 }}
    >
      {/* Dark backdrop using 4 rectangles around the cutout window */}
      <DimOverlay target={hoveredWindow && !selectedWindow ? hoveredWindow : selectedWindow} toOverlayX={toOverlayX} toOverlayY={toOverlayY} />

      {/* Border highlight for hovered window */}
      {hoveredWindow && !selectedWindow && (
        <div
          className="absolute border-[3px] border-blue-400 rounded-lg"
          style={{
            left: toOverlayX(hoveredWindow),
            top: toOverlayY(hoveredWindow),
            width: hoveredWindow.width,
            height: hoveredWindow.height,
            boxShadow: "0 0 0 2px rgba(96,165,250,0.3), 0 0 20px rgba(96,165,250,0.15)",
            pointerEvents: "none",
          }}
        />
      )}

      {/* Selected window confirmation */}
      {selectedWindow && (
        <>
          {/* Highlight the selected window */}
          <div
            className="absolute border-[3px] border-blue-500 rounded-lg"
            style={{
              left: toOverlayX(selectedWindow),
              top: toOverlayY(selectedWindow),
              width: selectedWindow.width,
              height: selectedWindow.height,
              boxShadow: "0 0 0 2px rgba(59,130,246,0.3), 0 0 20px rgba(59,130,246,0.15)",
              pointerEvents: "none",
            }}
          />

          {/* Confirmation card with glass-morphism */}
          <div
            className="absolute flex flex-col items-center gap-3 bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-6"
            style={{
              left: toOverlayX(selectedWindow) + selectedWindow.width / 2,
              top: toOverlayY(selectedWindow) + selectedWindow.height / 2,
              transform: "translate(-50%, -50%)",
              pointerEvents: "auto",
              animation: "picker-card-in 200ms ease-out",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* App icon */}
            {selectedWindow.app_icon && (
              <img
                src={`data:image/png;base64,${selectedWindow.app_icon}`}
                alt={selectedWindow.app_name}
                className="w-16 h-16 rounded-xl"
                draggable={false}
              />
            )}

            {/* App name */}
            <h2 className="text-xl font-semibold text-white">
              {selectedWindow.app_name}
            </h2>

            {/* Dimensions */}
            <span className="text-sm text-white/50">
              {selectedWindow.width} &times; {selectedWindow.height}
            </span>

            {/* Start recording button — red to match app recording color */}
            <button
              className="flex items-center gap-2 px-6 py-2.5 bg-red-500 hover:bg-red-400 text-white rounded-full font-medium transition-colors"
              onClick={handleStartRecording}
            >
              <Circle size={16} fill="#fff" stroke="none" />
              Start recording
            </button>
          </div>

          {/* Cancel button with subtle background */}
          <button
            className="absolute top-6 right-6 p-2 bg-white/10 hover:bg-white/15 rounded-full text-white/60 hover:text-white transition-colors"
            onClick={(e) => {
              e.stopPropagation()
              setSelectedWindow(null)
            }}
            aria-label="Cancel selection"
          >
            <X size={20} />
          </button>
        </>
      )}

      {/* Cancel hint */}
      {!selectedWindow && !loading && (
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 text-white/60 text-sm">
          Click a window to select it &middot; Press Escape to cancel
        </div>
      )}
    </div>
  )
}

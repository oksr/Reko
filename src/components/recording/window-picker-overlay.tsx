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
    return (
      <div
        className="absolute inset-0"
        style={{
          backgroundColor: DIM,
          pointerEvents: "none",
          transition: "opacity 150ms cubic-bezier(0.25, 0.46, 0.45, 0.94)",
        }}
      />
    )
  }

  const x = toOverlayX(target)
  const y = toOverlayY(target)
  const w = target.width
  const h = target.height

  // Shared transition for smooth cutout movement
  const dimStyle = {
    backgroundColor: DIM,
    pointerEvents: "none" as const,
    transition: "all 120ms cubic-bezier(0.25, 0.46, 0.45, 0.94)",
  }

  return (
    <>
      <div className="absolute left-0 right-0 top-0" style={{ ...dimStyle, height: y }} />
      <div className="absolute left-0 right-0 bottom-0" style={{ ...dimStyle, top: y + h }} />
      <div className="absolute left-0" style={{ ...dimStyle, top: y, width: x, height: h }} />
      <div className="absolute right-0" style={{ ...dimStyle, top: y, left: x + w, height: h }} />
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
  const [loading, setLoading] = useState(true)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    invoke<WindowInfo[]>("list_windows")
      .then(setWindows)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel()
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [onCancel])

  const toOverlayX = useCallback((w: WindowInfo) => w.x, [])
  const toOverlayY = useCallback((w: WindowInfo) => w.y, [])

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
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
    [windows, toOverlayX, toOverlayY]
  )

  const handleStartRecording = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      if (hoveredWindow) {
        onStartRecording(hoveredWindow.id)
      }
    },
    [hoveredWindow, onStartRecording]
  )

  if (!loading && windows.length === 0) {
    return (
      <div className="fixed inset-0">
        <div className="absolute inset-0 bg-black/50" />
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
          <p className="text-white/60 text-lg">No windows available</p>
          <button
            className="px-4 py-2 bg-white/10 text-white rounded-lg"
            style={{ transition: "background-color 150ms ease" }}
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
    >
      <DimOverlay target={hoveredWindow} toOverlayX={toOverlayX} toOverlayY={toOverlayY} />

      {hoveredWindow && (
        <>
          {/* Tinted overlay on the window — box-shadow instead of border */}
          <div
            className="absolute rounded-lg"
            style={{
              left: toOverlayX(hoveredWindow),
              top: toOverlayY(hoveredWindow),
              width: hoveredWindow.width,
              height: hoveredWindow.height,
              backgroundColor: "rgba(59,130,246,0.35)",
              boxShadow: "0 0 0 3px rgba(59,130,246,0.8)",
              pointerEvents: "none",
            }}
          />

          {/* Info card centered on the window */}
          <div
            className="absolute flex flex-col items-center gap-2 bg-neutral-900 backdrop-blur-2xl rounded-xl px-4 py-3.5"
            style={{
              left: toOverlayX(hoveredWindow) + hoveredWindow.width / 2,
              top: toOverlayY(hoveredWindow) + hoveredWindow.height / 2,
              transform: "translate(-50%, -50%)",
              pointerEvents: "auto",
              boxShadow: "0 0 0 1px rgba(255,255,255,0.08), 0 16px 48px rgba(0,0,0,0.4)",
              animation: "picker-card-in 150ms cubic-bezier(0.25, 0.46, 0.45, 0.94) both",
            }}
          >
            <div className="flex items-center gap-3">
              {hoveredWindow.app_icon && (
                <img
                  src={`data:image/png;base64,${hoveredWindow.app_icon}`}
                  alt=""
                  className="w-10 h-10 rounded-lg"
                  draggable={false}
                />
              )}
              <div className="flex flex-col gap-0.5">
                <h2 className="text-[14px] font-medium text-white leading-tight">
                  {hoveredWindow.app_name}
                </h2>
                <span className="text-[11px] text-white/40" style={{ fontVariantNumeric: "tabular-nums" }}>
                  {hoveredWindow.width} × {hoveredWindow.height}
                </span>
              </div>
            </div>

            {/* Record button — 44px tall hit area via padding */}
            <button
              className="flex items-center justify-center gap-1.5 px-4 py-1 bg-white/10 hover:bg-white/15 text-white text-[12px] rounded-full font-medium cursor-pointer active:scale-[0.97]"
              style={{ transition: "background-color 150ms ease, transform 100ms ease" }}
              onClick={handleStartRecording}
            >
              <div className="w-[7px] h-[7px] rounded-full bg-red-500" />
              Record
            </button>
          </div>
        </>
      )}

      {/* Cancel button — 44px hit area */}
      <button
        className="absolute top-5 right-5 flex items-center justify-center w-[44px] h-[44px] rounded-full bg-white/10 hover:bg-white/15 text-white/60 hover:text-white active:scale-[0.97]"
        style={{
          pointerEvents: "auto",
          transition: "background-color 150ms ease, color 150ms ease, transform 100ms ease",
        }}
        onClick={(e) => {
          e.stopPropagation()
          onCancel()
        }}
        aria-label="Cancel window selection"
      >
        <X size={20} />
      </button>

      {!hoveredWindow && !loading && (
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 text-white/60 text-sm select-none">
          Hover over a window to select it · Press Escape to cancel
        </div>
      )}
    </div>
  )
}

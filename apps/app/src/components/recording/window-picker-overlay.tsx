import { useState, useEffect, useCallback, useRef } from "react"
import { usePlatform } from "@/platform/PlatformContext"
import { X } from "lucide-react"
import type { WindowInfo } from "@/types"

const EASE = "250ms cubic-bezier(0.4, 0, 0.2, 1)"

interface Props {
  onStartRecording: (windowId: number) => void
  onCancel: () => void
}

export function WindowPickerOverlay({ onStartRecording, onCancel }: Props) {
  const platform = usePlatform()
  const [windows, setWindows] = useState<WindowInfo[]>([])
  const [hoveredWindow, setHoveredWindow] = useState<WindowInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const containerRef = useRef<HTMLDivElement>(null)
  // Track last target so elements can transition out instead of unmounting instantly
  const lastTargetRef = useRef<WindowInfo | null>(null)
  if (hoveredWindow) lastTargetRef.current = hoveredWindow

  useEffect(() => {
    platform.invoke<WindowInfo[]>("list_windows")
      .then(setWindows)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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

  // Use current hovered window, or fall back to last target for smooth exit transitions
  const target = hoveredWindow ?? lastTargetRef.current
  const hasTarget = target !== null

  // Build clip-path inset: inset(top right bottom left) creates a visible region,
  // but we want the INVERSE (dim everything except the cutout). We use two layers:
  // 1. A full-screen dim with clip-path that clips OUT the window area
  // 2. This is achieved by using polygon with evenodd fill rule via SVG clipPath,
  //    or more simply: use inset on the dim layer to show only the border regions.
  //
  // Simplest approach: use a single overlay with clip-path: polygon (evenodd)
  // that covers the full viewport minus the cutout rectangle.
  // All coordinates in px relative to the element (which is inset-0 = full viewport).

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 cursor-crosshair"
      onMouseMove={handleMouseMove}
    >
      {/* Dim overlay with cutout — single element, smooth clip-path transition */}
      <div
        className="absolute inset-0"
        style={{
          backgroundColor: "rgba(0,0,0,0.5)",
          clipPath: hasTarget
            ? `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${toOverlayX(target)}px ${toOverlayY(target)}px, ${toOverlayX(target)}px ${toOverlayY(target) + target.height}px, ${toOverlayX(target) + target.width}px ${toOverlayY(target) + target.height}px, ${toOverlayX(target) + target.width}px ${toOverlayY(target)}px, ${toOverlayX(target)}px ${toOverlayY(target)}px)`
            : "none",
          transition: `clip-path ${EASE}`,
          pointerEvents: "none",
        }}
      />

      {/* Tinted highlight — stays mounted, transitions between windows */}
      {hasTarget && (
        <div
          className="absolute rounded-lg"
          style={{
            left: toOverlayX(target),
            top: toOverlayY(target),
            width: target.width,
            height: target.height,
            backgroundColor: hoveredWindow ? "rgba(59,130,246,0.35)" : "rgba(59,130,246,0)",
            boxShadow: hoveredWindow
              ? "0 0 0 3px rgba(59,130,246,0.8)"
              : "0 0 0 3px rgba(59,130,246,0)",
            pointerEvents: "none",
            transition: `left ${EASE}, top ${EASE}, width ${EASE}, height ${EASE}, background-color ${EASE}, box-shadow ${EASE}`,
          }}
        />
      )}

      {/* Info card — transitions position between windows */}
      {hasTarget && (
        <div
          className="absolute flex flex-col items-center bg-neutral-900/90 backdrop-blur-2xl rounded-2xl px-6 py-5"
          style={{
            left: toOverlayX(target) + target.width / 2,
            top: toOverlayY(target) + target.height / 2,
            transform: "translate(-50%, -50%)",
            opacity: hoveredWindow ? 1 : 0,
            pointerEvents: hoveredWindow ? "auto" : "none",
            boxShadow: "0 0 0 1px rgba(255,255,255,0.08), 0 16px 48px rgba(0,0,0,0.4)",
            transition: `left ${EASE}, top ${EASE}, opacity 150ms ease`,
          }}
        >
          {target.app_icon && (
            <img
              key={target.id}
              src={`data:image/png;base64,${target.app_icon}`}
              alt=""
              className="w-16 h-16 rounded-[14px] mb-3"
              style={{ animation: "icon-float 2s ease-in-out infinite" }}
              draggable={false}
            />
          )}
          <h2 className="text-[20px] font-semibold text-white leading-tight mb-1">
            {target.app_name}
          </h2>
          <div className="flex items-center gap-1.5 mb-4">
            <span className="text-[13px] text-white/40" style={{ fontVariantNumeric: "tabular-nums" }}>
              {target.width} × {target.height}
            </span>
            <span className="text-[11px] font-medium text-white/50 bg-white/10 px-1.5 py-0.5 rounded">
              Resize
            </span>
          </div>

          {/* Record button */}
          <button
            className="flex items-center justify-center gap-1.5 px-5 py-1.5 bg-white/10 hover:bg-white/15 text-white text-[13px] rounded-full font-medium cursor-pointer active:scale-[0.97]"
            style={{ transition: "background-color 150ms ease, transform 100ms ease" }}
            onClick={handleStartRecording}
          >
            <div className="w-[7px] h-[7px] rounded-full bg-red-500" />
            Record
          </button>
        </div>
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

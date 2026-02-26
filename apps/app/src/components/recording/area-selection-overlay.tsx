import { useState, useEffect, useCallback, useRef } from "react"
import { usePlatform } from "@/platform/PlatformContext"
import { X } from "lucide-react"
import type { AreaRect, DisplayInfo } from "@/types"

const MIN_SIZE = 100

type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w"

interface Props {
  onConfirm: (displayId: number, area: AreaRect) => void
  onCancel: () => void
}

export function AreaSelectionOverlay({ onConfirm, onCancel }: Props) {
  const platform = usePlatform()
  const [displayId, setDisplayId] = useState<number | null>(null)
  const [rect, setRect] = useState({ x: 0, y: 0, width: 0, height: 0 })
  const [ready, setReady] = useState(false)
  const dragRef = useRef<{
    type: "move" | ResizeHandle
    startMouseX: number
    startMouseY: number
    startRect: typeof rect
  } | null>(null)

  // Load display info and set initial centered rectangle
  useEffect(() => {
    platform.invoke<DisplayInfo[]>("list_displays").then((displays) => {
      const main = displays.find((d) => d.is_main) ?? displays[0]
      if (!main) return
      setDisplayId(main.id)
      const w = Math.round(main.width * 0.5)
      const h = Math.round(main.height * 0.5)
      setRect({
        x: Math.round((main.width - w) / 2),
        y: Math.round((main.height - h) / 2),
        width: w,
        height: h,
      })
      setReady(true)
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel()
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [onCancel])

  const handleMouseDown = useCallback(
    (type: "move" | ResizeHandle, e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      dragRef.current = {
        type,
        startMouseX: e.clientX,
        startMouseY: e.clientY,
        startRect: { ...rect },
      }
    },
    [rect]
  )

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const drag = dragRef.current
      if (!drag) return
      const dx = e.clientX - drag.startMouseX
      const dy = e.clientY - drag.startMouseY
      const s = drag.startRect

      if (drag.type === "move") {
        setRect({
          x: Math.max(0, s.x + dx),
          y: Math.max(0, s.y + dy),
          width: s.width,
          height: s.height,
        })
        return
      }

      let { x, y, width, height } = s

      // Horizontal
      if (drag.type.includes("w")) {
        const newX = s.x + dx
        const newW = s.width - dx
        if (newW >= MIN_SIZE) {
          x = newX
          width = newW
        }
      }
      if (drag.type.includes("e")) {
        width = Math.max(MIN_SIZE, s.width + dx)
      }

      // Vertical
      if (drag.type.includes("n")) {
        const newY = s.y + dy
        const newH = s.height - dy
        if (newH >= MIN_SIZE) {
          y = newY
          height = newH
        }
      }
      if (drag.type === "s" || drag.type === "se" || drag.type === "sw") {
        height = Math.max(MIN_SIZE, s.height + dy)
      }

      setRect({ x, y, width, height })
    }

    const handleMouseUp = () => {
      dragRef.current = null
    }

    window.addEventListener("mousemove", handleMouseMove)
    window.addEventListener("mouseup", handleMouseUp)
    return () => {
      window.removeEventListener("mousemove", handleMouseMove)
      window.removeEventListener("mouseup", handleMouseUp)
    }
  }, [])

  const handleConfirm = () => {
    if (displayId == null) return
    onConfirm(displayId, {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    })
  }

  if (!ready) return null

  const handles: { handle: ResizeHandle; style: React.CSSProperties; cursor: string }[] = [
    { handle: "nw", style: { top: -4, left: -4 }, cursor: "nwse-resize" },
    { handle: "n", style: { top: -4, left: "50%", transform: "translateX(-50%)" }, cursor: "ns-resize" },
    { handle: "ne", style: { top: -4, right: -4 }, cursor: "nesw-resize" },
    { handle: "e", style: { top: "50%", right: -4, transform: "translateY(-50%)" }, cursor: "ew-resize" },
    { handle: "se", style: { bottom: -4, right: -4 }, cursor: "nwse-resize" },
    { handle: "s", style: { bottom: -4, left: "50%", transform: "translateX(-50%)" }, cursor: "ns-resize" },
    { handle: "sw", style: { bottom: -4, left: -4 }, cursor: "nesw-resize" },
    { handle: "w", style: { top: "50%", left: -4, transform: "translateY(-50%)" }, cursor: "ew-resize" },
  ]

  // clip-path polygon with evenodd to cut out the selected area
  const clipPath = `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${rect.x}px ${rect.y}px, ${rect.x}px ${rect.y + rect.height}px, ${rect.x + rect.width}px ${rect.y + rect.height}px, ${rect.x + rect.width}px ${rect.y}px, ${rect.x}px ${rect.y}px)`

  return (
    <div className="fixed inset-0">
      {/* Dimmed backdrop with cutout */}
      <div
        className="absolute inset-0"
        style={{
          backgroundColor: "rgba(0,0,0,0.5)",
          clipPath,
          pointerEvents: "none",
        }}
      />

      {/* Selection rectangle border */}
      <div
        className="absolute"
        style={{
          left: rect.x,
          top: rect.y,
          width: rect.width,
          height: rect.height,
          boxShadow: "0 0 0 2px rgba(59,130,246,0.8), 0 0 0 4px rgba(59,130,246,0.3)",
          borderRadius: 4,
          cursor: "move",
        }}
        onMouseDown={(e) => handleMouseDown("move", e)}
      >
        {/* Resize handles */}
        {handles.map(({ handle, style, cursor }) => (
          <div
            key={handle}
            className="absolute"
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              backgroundColor: "white",
              boxShadow: "0 0 4px rgba(0,0,0,0.5)",
              cursor,
              ...style,
            }}
            onMouseDown={(e) => handleMouseDown(handle, e)}
          />
        ))}
      </div>

      {/* Bottom bar: dimensions + record/cancel, anchored below selection */}
      <div
        className="absolute flex items-center gap-3 bg-neutral-900/90 backdrop-blur-2xl rounded-xl px-4 py-2"
        style={{
          left: rect.x + rect.width / 2,
          top: rect.y + rect.height + 12,
          transform: "translateX(-50%)",
          pointerEvents: "auto",
          boxShadow: "0 0 0 1px rgba(255,255,255,0.08), 0 16px 48px rgba(0,0,0,0.4)",
        }}
      >
        <span
          className="text-white/50 text-xs font-medium select-none"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {Math.round(rect.width)} × {Math.round(rect.height)}
        </span>
        <div className="w-px h-4 bg-white/10" />
        <button
          className="flex items-center justify-center gap-1.5 px-4 py-1 bg-white/10 hover:bg-white/15 text-white text-[13px] rounded-full font-medium cursor-pointer active:scale-[0.97]"
          style={{ transition: "background-color 150ms ease, transform 100ms ease" }}
          onClick={handleConfirm}
        >
          <div className="w-[7px] h-[7px] rounded-full bg-red-500" />
          Record
        </button>
        <button
          className="px-3 py-1 bg-white/10 hover:bg-white/15 text-white/70 text-[13px] rounded-full font-medium cursor-pointer active:scale-[0.97]"
          style={{ transition: "background-color 150ms ease, transform 100ms ease" }}
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>

      {/* Cancel X button */}
      <button
        className="absolute top-5 right-5 flex items-center justify-center w-[44px] h-[44px] rounded-full bg-neutral-900/80 backdrop-blur-xl hover:bg-neutral-800/90 text-white/60 hover:text-white active:scale-[0.97]"
        style={{
          pointerEvents: "auto",
          boxShadow: "0 0 0 1px rgba(255,255,255,0.08), 0 4px 12px rgba(0,0,0,0.3)",
          transition: "background-color 150ms ease, color 150ms ease, transform 100ms ease",
        }}
        onClick={(e) => {
          e.stopPropagation()
          onCancel()
        }}
        aria-label="Cancel area selection"
      >
        <X size={20} />
      </button>
    </div>
  )
}

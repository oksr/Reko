import type { Transition } from "@/types/editor"

interface TransitionMenuProps {
  position: { x: number; y: number }
  onSelect: (type: Transition["type"]) => void
  onClose: () => void
}

export function TransitionMenu({ position, onSelect, onClose }: TransitionMenuProps) {
  const options: { type: Transition["type"]; label: string }[] = [
    { type: "crossfade", label: "Crossfade" },
    { type: "dissolve", label: "Dissolve" },
    { type: "fade-through-black", label: "Fade Through Black" },
    { type: "cut", label: "Cut (No Transition)" },
  ]

  return (
    <>
      {/* Backdrop to close menu */}
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        data-testid="transition-menu"
        className="fixed z-50 bg-zinc-900 border border-zinc-700 rounded-md shadow-lg py-1"
        style={{ left: position.x, top: position.y }}
      >
        {options.map(({ type, label }) => (
          <button
            key={type}
            className="block w-full px-3 py-1.5 text-left text-sm text-zinc-300 hover:bg-zinc-800"
            onClick={() => { onSelect(type); onClose() }}
          >
            {label}
          </button>
        ))}
      </div>
    </>
  )
}

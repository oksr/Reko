import { useEditorStore } from "@/stores/editor-store"
import { MousePointer2, Scissors, ZoomIn } from "lucide-react"

export function TimelineToolbar() {
  const activeTool = useEditorStore((s) => s.activeTool)
  const setActiveTool = useEditorStore((s) => s.setActiveTool)

  const tools = [
    { id: "select" as const, icon: MousePointer2, shortcut: "V", testId: "tool-select" },
    { id: "razor" as const, icon: Scissors, shortcut: "C", testId: "tool-razor" },
    { id: "zoom" as const, icon: ZoomIn, shortcut: "Z", testId: "tool-zoom" },
  ]

  return (
    <div className="flex items-center gap-1 px-2 py-1 border-b border-zinc-800">
      {tools.map(({ id, icon: Icon, shortcut, testId }) => (
        <button
          key={id}
          data-testid={testId}
          onClick={() => setActiveTool(id)}
          className={`p-1.5 rounded text-xs ${
            activeTool === id
              ? "bg-zinc-700 text-white"
              : "text-zinc-400 hover:text-white hover:bg-zinc-800"
          }`}
          title={`${id} (${shortcut})`}
        >
          <Icon size={14} />
        </button>
      ))}
    </div>
  )
}

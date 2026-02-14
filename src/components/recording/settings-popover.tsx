import { useCallback } from "react"
import { Menu, MenuItem, PredefinedMenuItem } from "@tauri-apps/api/menu"
import { Settings, ChevronDown } from "lucide-react"
import type { ProjectState } from "@/types"

interface Props {
  recentProjects: ProjectState[]
  onOpenEditor: (projectId: string) => void
}

export function SettingsPopover({
  recentProjects,
  onOpenEditor,
}: Props) {
  const showMenu = useCallback(async () => {
    const items: Array<MenuItem | PredefinedMenuItem> = []

    for (const p of recentProjects) {
      const duration = (p.timeline.duration_ms / 1000).toFixed(1)
      const projectId = p.id
      items.push(
        await MenuItem.new({
          text: `${p.name} (${duration}s)`,
          action: () => onOpenEditor(projectId),
        })
      )
    }

    if (recentProjects.length > 0) {
      items.push(await PredefinedMenuItem.new({ item: "Separator" }))
    }

    items.push(
      await MenuItem.new({
        text: "Record — ⌘⇧R",
        enabled: false,
      })
    )

    const menu = await Menu.new({ items })
    await menu.popup()
  }, [recentProjects, onOpenEditor])

  return (
    <button
      className="toolbar-btn-icon flex items-center gap-1"
      onClick={showMenu}
      onMouseDown={(e) => e.stopPropagation()}
      aria-label="Settings"
    >
      <Settings size={16} strokeWidth={2} />
      <ChevronDown size={10} className="opacity-50" />
    </button>
  )
}

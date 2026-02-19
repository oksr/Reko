import { useCallback } from "react"
import { usePlatform } from "@/platform/PlatformContext"
import { Settings, ChevronDown } from "lucide-react"
import type { MenuItemDef } from "@/platform/types"
import type { ProjectState } from "@/types"

interface Props {
  recentProjects: ProjectState[]
  onOpenEditor: (projectId: string) => void
}

export function SettingsPopover({
  recentProjects,
  onOpenEditor,
}: Props) {
  const platform = usePlatform()

  const showMenu = useCallback(async () => {
    const items: MenuItemDef[] = recentProjects.map((p) => {
      const duration = (p.timeline.duration_ms / 1000).toFixed(1)
      const projectId = p.id
      return {
        type: "item" as const,
        text: `${p.name} (${duration}s)`,
        action: () => onOpenEditor(projectId),
      }
    })

    if (recentProjects.length > 0) {
      items.push({ type: "separator" as const, text: undefined, action: undefined })
    }

    items.push({
      type: "item" as const,
      text: "Record — ⌘⇧R",
      action: undefined,
    })

    await platform.menu.showDropdown(items)
  }, [recentProjects, onOpenEditor, platform])

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

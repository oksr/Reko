import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Settings, ChevronDown, Pencil, Timer } from "lucide-react"
import type { ProjectState } from "@/types"

interface Props {
  countdownEnabled: boolean
  onCountdownToggle: (enabled: boolean) => void
  recentProjects: ProjectState[]
  onOpenEditor: (projectId: string) => void
}

export function SettingsPopover({
  countdownEnabled,
  onCountdownToggle,
  recentProjects,
  onOpenEditor,
}: Props) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className="toolbar-btn-icon flex items-center gap-1"
          onMouseDown={(e) => e.stopPropagation()}
          aria-label="Settings"
        >
          <Settings size={16} strokeWidth={2} />
          <ChevronDown size={10} className="opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={8}
        className="toolbar-popover w-64 p-2"
      >
        {/* Recent Projects */}
        {recentProjects.length > 0 && (
          <>
            <p className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/40">
              Recent
            </p>
            {recentProjects.map((p) => (
              <button
                key={p.id}
                className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-xs text-white/80 hover:bg-white/8 cursor-default"
                onClick={() => onOpenEditor(p.id)}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <div className="flex-1 min-w-0 mr-2">
                  <p className="truncate font-medium">{p.name}</p>
                  <p className="text-[10px] text-white/40">
                    {(p.timeline.duration_ms / 1000).toFixed(1)}s
                  </p>
                </div>
                <Pencil size={12} className="flex-shrink-0 opacity-40" />
              </button>
            ))}
            <div className="my-1.5 h-px bg-white/10" />
          </>
        )}

        {/* Preferences */}
        <p className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/40">
          Preferences
        </p>

        {/* Countdown toggle */}
        <button
          className="flex w-full items-center justify-between rounded-md px-2 py-2 text-xs text-white/80 hover:bg-white/8 cursor-default"
          onClick={() => onCountdownToggle(!countdownEnabled)}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-2">
            <Timer size={14} strokeWidth={2} />
            <span>Countdown</span>
          </div>
          <div
            className={`w-7 h-4 rounded-full transition-colors ${
              countdownEnabled ? "bg-blue-500" : "bg-white/20"
            } relative`}
          >
            <div
              className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${
                countdownEnabled ? "translate-x-3.5" : "translate-x-0.5"
              }`}
            />
          </div>
        </button>

        {/* Global shortcut display */}
        <div className="flex items-center justify-between rounded-md px-2 py-2 text-xs text-white/50">
          <span>Record shortcut</span>
          <kbd className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-mono">
            Cmd+Shift+R
          </kbd>
        </div>
      </PopoverContent>
    </Popover>
  )
}

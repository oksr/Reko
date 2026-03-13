import { useState } from "react"
import { Settings, FileOutput, Crown } from "lucide-react"
import { GeneralSettings } from "@/components/settings/general-settings"
import { ExportSettings } from "@/components/settings/export-settings"
import { ProSettings } from "@/components/settings/pro-settings"

const sections = [
  { id: "general", label: "General", icon: Settings },
  { id: "export", label: "Export", icon: FileOutput },
  { id: "pro", label: "Reko Pro", icon: Crown },
] as const

type SectionId = (typeof sections)[number]["id"]

export function SettingsApp() {
  const [active, setActive] = useState<SectionId>("general")

  return (
    <div className="dark flex h-screen select-none overflow-hidden text-white antialiased" data-tauri-drag-region>
      {/* Sidebar — translucent so native vibrancy shows through */}
      <nav
        className="flex w-[170px] shrink-0 flex-col gap-0.5 border-r border-white/[0.08] bg-black/20 px-3 pb-4 pt-12"
        data-tauri-drag-region
      >
        {sections.map((section) => {
          const Icon = section.icon
          const isActive = active === section.id
          return (
            <button
              key={section.id}
              onClick={() => setActive(section.id)}
              className={`group flex items-center gap-2.5 rounded-[8px] px-2.5 py-[7px] text-[13px] font-medium tracking-[-0.01em] transition-all duration-150 ${
                isActive
                  ? "bg-white/[0.12] text-white shadow-[inset_0_0.5px_0_rgba(255,255,255,0.1),0_0.5px_1px_rgba(0,0,0,0.15)]"
                  : "text-white/50 hover:bg-white/[0.06] hover:text-white/70"
              }`}
            >
              <Icon
                size={15}
                className={`shrink-0 transition-colors duration-150 ${
                  isActive ? "text-white/80" : "text-white/30 group-hover:text-white/50"
                }`}
              />
              {section.label}
            </button>
          )
        })}
      </nav>

      {/* Content — also translucent, slightly lighter */}
      <main
        className="flex-1 overflow-y-auto overscroll-none bg-black/10 px-7 pb-6 pt-12"
        data-tauri-drag-region
      >
        {active === "general" && <GeneralSettings />}
        {active === "export" && <ExportSettings />}
        {active === "pro" && <ProSettings />}
      </main>
    </div>
  )
}

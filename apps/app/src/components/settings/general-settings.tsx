import { useState, useEffect } from "react"
import { usePlatform } from "@/platform/PlatformContext"
import { Folder } from "lucide-react"
import type { AppSettings } from "@/platform/types"

export function GeneralSettings() {
  const platform = usePlatform()
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [autoStart, setAutoStart] = useState(false)

  useEffect(() => {
    platform.settings.getSettings().then(setSettings)
    platform.settings.getAutoStartEnabled().then(setAutoStart)
  }, [platform])

  async function update(patch: Partial<AppSettings>) {
    if (!settings) return
    const next = { ...settings, ...patch }
    setSettings(next)
    await platform.settings.saveSettings(next)
  }

  async function toggleAutoStart() {
    const next = !autoStart
    setAutoStart(next)
    await platform.settings.setAutoStartEnabled(next)
    await update({ launchAtLogin: next })
  }

  async function toggleDock() {
    if (!settings) return
    const next = !settings.showInDock
    await update({ showInDock: next })
    await platform.settings.setDockVisible(next)
  }

  async function pickSavePath() {
    const path = await platform.settings.pickFolder(settings?.defaultSavePath)
    if (path) {
      await update({ defaultSavePath: path })
    }
  }

  if (!settings) return null

  return (
    <div className="space-y-5">
      <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-white">General</h2>

      <GlassCard>
        <ToggleRow
          label="Launch at login"
          description="Start Reko automatically when you log in"
          checked={autoStart}
          onChange={toggleAutoStart}
        />
        <RowDivider />
        <ToggleRow
          label="Show in Dock"
          description="Display the Reko icon in the macOS Dock"
          checked={settings.showInDock}
          onChange={toggleDock}
        />
      </GlassCard>

      <GlassCard>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[13px] font-medium text-white/90">Default save location</div>
            <div className="mt-0.5 text-[11.5px] leading-[1.4] text-white/40">Where exported videos are saved</div>
          </div>
          <button
            onClick={pickSavePath}
            className="flex items-center gap-1.5 rounded-[8px] border border-white/[0.1] bg-white/[0.06] px-3 py-[6px] text-[12px] text-white/70 shadow-[0_0.5px_1px_rgba(0,0,0,0.15)] backdrop-blur-sm transition-all duration-150 hover:bg-white/[0.1] hover:text-white/90 active:scale-[0.98]"
          >
            <Folder size={12} className="text-white/40" />
            <span className="max-w-[150px] truncate">
              {settings.defaultSavePath.replace(/^\/Users\/[^/]+/, "~")}
            </span>
          </button>
        </div>
      </GlassCard>
    </div>
  )
}

function GlassCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[10px] border border-white/[0.08] bg-white/[0.04] p-4 shadow-[0_1px_2px_rgba(0,0,0,0.12),inset_0_0.5px_0_rgba(255,255,255,0.04)] backdrop-blur-xl">
      {children}
    </div>
  )
}

function RowDivider() {
  return <div className="my-3.5 h-px bg-white/[0.06]" />
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string
  description: string
  checked: boolean
  onChange: () => void
}) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <div className="text-[13px] font-medium text-white/90">{label}</div>
        <div className="mt-0.5 text-[11.5px] leading-[1.4] text-white/40">{description}</div>
      </div>
      <button
        onClick={onChange}
        className={`relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors duration-200 ${
          checked ? "bg-[#34c759]" : "bg-white/[0.15]"
        }`}
      >
        <span
          className={`absolute top-[2px] left-[2px] h-[18px] w-[18px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.25)] transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] ${
            checked ? "translate-x-[16px]" : ""
          }`}
        />
      </button>
    </div>
  )
}

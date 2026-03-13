import { useState, useEffect } from "react"
import { usePlatform } from "@/platform/PlatformContext"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { AppSettings } from "@/platform/types"

const resolutionOptions = [
  { value: "original", label: "Original" },
  { value: "4k", label: "4K (2160p)" },
  { value: "1080p", label: "1080p" },
  { value: "720p", label: "720p" },
]

const qualityOptions = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "best", label: "Best" },
]

export function ExportSettings() {
  const platform = usePlatform()
  const [settings, setSettings] = useState<AppSettings | null>(null)

  useEffect(() => {
    platform.settings.getSettings().then(setSettings)
  }, [platform])

  async function update(patch: Partial<AppSettings>) {
    if (!settings) return
    const next = { ...settings, ...patch }
    setSettings(next)
    await platform.settings.saveSettings(next)
  }

  if (!settings) return null

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-white">Export</h2>
        <p className="mt-1 text-[12px] text-white/35">Default settings for new exports. You can always override per-export.</p>
      </div>

      <div className="rounded-[10px] border border-white/[0.08] bg-white/[0.04] p-4 shadow-[0_1px_2px_rgba(0,0,0,0.12),inset_0_0.5px_0_rgba(255,255,255,0.04)] backdrop-blur-xl">
        <SelectRow
          label="Resolution"
          description="Output video resolution"
          value={settings.defaultExportResolution}
          options={resolutionOptions}
          onChange={(v) => update({ defaultExportResolution: v as AppSettings["defaultExportResolution"] })}
        />

        <div className="my-3.5 h-px bg-white/[0.06]" />

        <SelectRow
          label="Quality"
          description="Encoding quality preset"
          value={settings.defaultExportQuality}
          options={qualityOptions}
          onChange={(v) => update({ defaultExportQuality: v as AppSettings["defaultExportQuality"] })}
        />
      </div>
    </div>
  )
}

function SelectRow({
  label,
  description,
  value,
  options,
  onChange,
}: {
  label: string
  description: string
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
}) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <div className="text-[13px] font-medium text-white/90">{label}</div>
        <div className="mt-0.5 text-[11.5px] leading-[1.4] text-white/40">{description}</div>
      </div>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-[30px] w-[130px] rounded-[8px] border-white/[0.1] bg-white/[0.06] text-[12px] text-white/80 shadow-[0_0.5px_1px_rgba(0,0,0,0.15)] backdrop-blur-sm transition-all duration-150 hover:bg-white/[0.1]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="rounded-[10px] border-white/[0.1] bg-[#2a2a2c]/95 shadow-[0_8px_30px_rgba(0,0,0,0.35)] backdrop-blur-2xl">
          {options.map((opt) => (
            <SelectItem key={opt.value} value={opt.value} className="rounded-[6px] text-[12px]">
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

import { useState, useEffect } from "react"
import { invoke } from "@tauri-apps/api/core"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import type { DisplayInfo } from "@/types"

interface Props {
  onDisplaySelected: (displayId: number) => void
  selectedDisplayId: number | null
}

export function SourcePicker({ onDisplaySelected, selectedDisplayId }: Props) {
  const [displays, setDisplays] = useState<DisplayInfo[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    invoke<DisplayInfo[]>("list_displays")
      .then((result) => {
        setDisplays(result)
        if (!selectedDisplayId) {
          const main = result.find((d) => d.is_main)
          if (main) onDisplaySelected(main.id)
        }
      })
      .catch((e) => setError(String(e)))
  }, [])

  if (error) {
    return <p className="text-sm text-destructive">Error: {error}</p>
  }

  return (
    <div className="space-y-2">
      <Label htmlFor="display-select">Display</Label>
      <Select
        value={selectedDisplayId?.toString() ?? ""}
        onValueChange={(val) => onDisplaySelected(Number(val))}
      >
        <SelectTrigger id="display-select" className="w-64">
          <SelectValue placeholder="Select a display" />
        </SelectTrigger>
        <SelectContent>
          {displays.map((d) => (
            <SelectItem key={d.id} value={d.id.toString()}>
              Display {d.id} ({d.width}x{d.height})
              {d.is_main ? " — Main" : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

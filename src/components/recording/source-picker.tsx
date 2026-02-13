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
import type { DisplayInfo, AudioInputInfo } from "@/types"

interface Props {
  onDisplaySelected: (displayId: number) => void
  selectedDisplayId: number | null
  onMicSelected: (micId: string | null) => void
  selectedMicId: string | null
}

export function SourcePicker({
  onDisplaySelected,
  selectedDisplayId,
  onMicSelected,
  selectedMicId,
}: Props) {
  const [displays, setDisplays] = useState<DisplayInfo[]>([])
  const [mics, setMics] = useState<AudioInputInfo[]>([])
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

    invoke<AudioInputInfo[]>("list_audio_inputs")
      .then((result) => {
        setMics(result)
        if (!selectedMicId && result.length > 0) {
          onMicSelected(result[0].id)
        }
      })
      .catch(() => {})
  }, [])

  if (error) {
    return <p className="text-sm text-destructive">Error: {error}</p>
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Display</Label>
        <Select
          value={selectedDisplayId?.toString() ?? ""}
          onValueChange={(val) => onDisplaySelected(Number(val))}
        >
          <SelectTrigger className="w-72">
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

      <div className="space-y-2">
        <Label>Microphone</Label>
        <Select
          value={selectedMicId ?? "none"}
          onValueChange={(val) => onMicSelected(val === "none" ? null : val)}
        >
          <SelectTrigger className="w-72">
            <SelectValue placeholder="Select a microphone" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No microphone</SelectItem>
            {mics.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}

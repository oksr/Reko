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
import type { DisplayInfo, AudioInputInfo, CameraInfo } from "@/types"

interface Props {
  onDisplaySelected: (displayId: number) => void
  selectedDisplayId: number | null
  onMicSelected: (micId: string | null) => void
  selectedMicId: string | null
  onCameraSelected: (cameraId: string | null) => void
  selectedCameraId: string | null
}

export function SourcePicker({
  onDisplaySelected,
  selectedDisplayId,
  onMicSelected,
  selectedMicId,
  onCameraSelected,
  selectedCameraId,
}: Props) {
  const [displays, setDisplays] = useState<DisplayInfo[]>([])
  const [mics, setMics] = useState<AudioInputInfo[]>([])
  const [cameras, setCameras] = useState<CameraInfo[]>([])
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

    invoke<CameraInfo[]>("list_cameras")
      .then((result) => {
        setCameras(result)
        if (!selectedCameraId && result.length > 0) {
          onCameraSelected(result[0].id)
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

      <div className="space-y-2">
        <Label>Camera</Label>
        <Select
          value={selectedCameraId ?? "none"}
          onValueChange={(val) => onCameraSelected(val === "none" ? null : val)}
        >
          <SelectTrigger className="w-72">
            <SelectValue placeholder="Select a camera" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No camera</SelectItem>
            {cameras.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}

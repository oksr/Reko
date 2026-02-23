import { useCallback } from "react"
import { usePlatform } from "@/platform/PlatformContext"
import {
  Camera, CameraOff,
  Mic, MicOff,
  Volume2, VolumeOff,
} from "lucide-react"

type InputType = "camera" | "mic" | "system-audio"

interface Device {
  id: string
  name: string
}

interface Props {
  type: InputType
  enabled: boolean
  onToggle: (enabled: boolean) => void
  selectedDeviceId: string | null
  onDeviceSelect: (deviceId: string | null) => void
  devices: Device[]
}

const config = {
  camera: {
    iconOn: Camera,
    iconOff: CameraOff,
    labelOff: "No camera",
    labelNone: "No camera detected",
    ariaLabel: "Toggle camera",
  },
  mic: {
    iconOn: Mic,
    iconOff: MicOff,
    labelOff: "No mic",
    labelNone: "No mic detected",
    ariaLabel: "Toggle microphone",
  },
  "system-audio": {
    iconOn: Volume2,
    iconOff: VolumeOff,
    labelOff: "No system audio",
    labelNone: "",
    ariaLabel: "Toggle system audio",
  },
} as const

export function InputToggle({
  type,
  enabled,
  onToggle,
  selectedDeviceId,
  onDeviceSelect,
  devices,
}: Props) {
  const platform = usePlatform()
  const { iconOn: IconOn, iconOff: IconOff, labelOff, labelNone, ariaLabel } = config[type]

  const Icon = enabled ? IconOn : IconOff
  const hasDevices = type === "system-audio" || devices.length > 0
  const isDisabled = type !== "system-audio" && devices.length === 0
  const selectedDevice = devices.find((d) => d.id === selectedDeviceId)
  const tooltipLabel = enabled && selectedDevice
    ? selectedDevice.name
    : enabled && type === "system-audio"
      ? "System audio"
      : labelOff

  const handleClick = () => {
    if (isDisabled) return
    if (!enabled && type !== "system-audio" && hasDevices) {
      onToggle(true)
      if (!selectedDeviceId && devices.length > 0) onDeviceSelect(devices[0].id)
      showDeviceMenu()
      return
    }
    onToggle(!enabled)
  }

  const showDeviceMenu = useCallback(async () => {
    const items = [
      {
        type: "item" as const,
        text: `${selectedDeviceId === null ? "✓ " : "   "}None`,
        action: () => {
          onToggle(false)
          onDeviceSelect(null)
        },
      },
      { type: "separator" as const, text: undefined, action: undefined },
      ...devices.map((device) => {
        const isSelected = selectedDeviceId === device.id
        const deviceId = device.id
        return {
          type: "item" as const,
          text: `${isSelected ? "✓ " : "   "}${device.name}`,
          action: () => {
            onToggle(true)
            onDeviceSelect(deviceId)
          },
        }
      }),
    ]

    await platform.menu.showDropdown(items)
  }, [devices, selectedDeviceId, onToggle, onDeviceSelect, platform])

  const handleChevronClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    showDeviceMenu()
  }

  const handleContextMenu = (e: React.MouseEvent) => {
    if (type === "system-audio") return
    e.preventDefault()
    showDeviceMenu()
  }

  return (
    <button
      className={`toolbar-btn-icon ${enabled ? "active" : "input-toggle-off"} ${isDisabled ? "disabled" : ""}`}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      onMouseDown={(e) => e.stopPropagation()}
      aria-pressed={enabled}
      aria-label={ariaLabel}
      title={isDisabled ? labelNone : tooltipLabel}
    >
      <Icon size={16} strokeWidth={2} />
    </button>
  )
}

import { useState } from "react"
import {
  Camera, CameraOff,
  Mic, MicOff,
  Volume2, VolumeOff,
  ChevronDown,
} from "lucide-react"
import { DevicePickerPopover } from "./device-picker-popover"

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
  const [pickerOpen, setPickerOpen] = useState(false)
  const { iconOn: IconOn, iconOff: IconOff, labelOff, labelNone, ariaLabel } = config[type]

  const Icon = enabled ? IconOn : IconOff
  const hasDevices = type === "system-audio" || devices.length > 0
  const isDisabled = type !== "system-audio" && devices.length === 0
  const showChevron = type !== "system-audio" && hasDevices

  const selectedDevice = devices.find((d) => d.id === selectedDeviceId)
  const label = enabled && selectedDevice
    ? selectedDevice.name
    : enabled && type === "system-audio"
      ? "System audio"
      : labelOff

  const handleClick = () => {
    if (isDisabled) return
    onToggle(!enabled)
  }

  const handleChevronClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    setPickerOpen(true)
  }

  const handleContextMenu = (e: React.MouseEvent) => {
    if (type === "system-audio") return
    e.preventDefault()
    setPickerOpen(true)
  }

  const handleDeviceSelect = (deviceId: string | null) => {
    if (deviceId === null) {
      onToggle(false)
      onDeviceSelect(null)
    } else {
      onToggle(true)
      onDeviceSelect(deviceId)
    }
  }

  return (
    <div className="relative flex items-center">
      <button
        className={`toolbar-btn ${enabled ? "active" : ""} ${isDisabled ? "disabled" : ""}`}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        onMouseDown={(e) => e.stopPropagation()}
        aria-pressed={enabled}
        aria-label={ariaLabel}
        title={isDisabled ? labelNone : undefined}
      >
        <Icon size={18} strokeWidth={2} />
        <span className="max-w-[80px] truncate">{label}</span>
        {showChevron && (
          <DevicePickerPopover
            devices={devices}
            selectedDeviceId={selectedDeviceId}
            onSelect={handleDeviceSelect}
            open={pickerOpen}
            onOpenChange={setPickerOpen}
          >
            <span
              className="flex items-center justify-center min-w-[28px] min-h-[28px]"
              onClick={handleChevronClick}
              onMouseDown={(e) => e.stopPropagation()}
              role="button"
              aria-label={`Select ${type === "camera" ? "camera" : "microphone"} device`}
            >
              <ChevronDown size={10} className="opacity-50" />
            </span>
          </DevicePickerPopover>
        )}
      </button>
    </div>
  )
}

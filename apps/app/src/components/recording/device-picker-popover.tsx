import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ChevronDown, Check } from "lucide-react"
import { useState } from "react"

interface Device {
  id: string
  name: string
}

interface Props {
  devices: Device[]
  selectedDeviceId: string | null
  onSelect: (deviceId: string | null) => void
  children?: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function DevicePickerPopover({
  devices,
  selectedDeviceId,
  onSelect,
  children,
  open,
  onOpenChange,
}: Props) {
  const [internalOpen, setInternalOpen] = useState(false)
  const isOpen = open ?? internalOpen
  const setIsOpen = onOpenChange ?? setInternalOpen

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        {children ?? (
          <button
            className="chevron-indicator"
            onMouseDown={(e) => e.stopPropagation()}
            aria-label="Select device"
          >
            <ChevronDown size={6} />
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="center"
        sideOffset={8}
        className="toolbar-popover w-52 p-1"
      >
        <button
          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-xs text-white/70 hover:bg-white/8 cursor-default"
          onClick={() => {
            onSelect(null)
            setIsOpen(false)
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <span className="w-4">
            {selectedDeviceId === null && <Check size={12} />}
          </span>
          None
        </button>
        {devices.map((device) => (
          <button
            key={device.id}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-xs text-white/90 hover:bg-white/8 cursor-default"
            onClick={() => {
              onSelect(device.id)
              setIsOpen(false)
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <span className="w-4">
              {selectedDeviceId === device.id && <Check size={12} />}
            </span>
            <span className="truncate">{device.name}</span>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  )
}

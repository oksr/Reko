import { usePlatform } from "@/platform/PlatformContext"
import { AreaSelectionOverlay } from "@/components/recording/area-selection-overlay"
import type { AreaRect } from "@/types"

export function AreaSelectionApp() {
  const platform = usePlatform()

  const handleConfirm = async (displayId: number, area: AreaRect) => {
    await platform.events.emitTo("recorder", "area-selected", { displayId, ...area })
    await platform.window.close()
  }

  const handleCancel = () => {
    platform.window.close()
  }

  return (
    <div className="window-picker">
      <AreaSelectionOverlay onConfirm={handleConfirm} onCancel={handleCancel} />
    </div>
  )
}

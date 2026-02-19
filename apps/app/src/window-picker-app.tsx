import { usePlatform } from "@/platform/PlatformContext"
import { WindowPickerOverlay } from "@/components/recording/window-picker-overlay"

export function WindowPickerApp() {
  const platform = usePlatform()

  const handleStartRecording = async (windowId: number) => {
    await platform.events.emitTo("recorder", "window-selected", { windowId })
    await platform.window.close()
  }

  const handleCancel = () => {
    platform.window.close()
  }

  return (
    <div className="window-picker">
      <WindowPickerOverlay
        onStartRecording={handleStartRecording}
        onCancel={handleCancel}
      />
    </div>
  )
}

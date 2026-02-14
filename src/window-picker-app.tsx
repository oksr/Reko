import { getCurrentWindow } from "@tauri-apps/api/window"
import { emitTo } from "@tauri-apps/api/event"
import { WindowPickerOverlay } from "@/components/recording/window-picker-overlay"

export function WindowPickerApp() {
  const handleStartRecording = async (windowId: number) => {
    await emitTo("recorder", "window-selected", { windowId })
    getCurrentWindow().close()
  }

  const handleCancel = () => {
    getCurrentWindow().close()
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

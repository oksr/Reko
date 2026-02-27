import { usePlatform } from "@/platform/PlatformContext"
import { RecorderApp } from "./recorder-app"
import { EditorApp } from "./editor-app"
import { WindowPickerApp } from "./window-picker-app"
import { AreaSelectionApp } from "./area-selection-app"
import { OnboardingApp } from "./onboarding-app"
import { CameraPreviewApp } from "./camera-preview-app"

export function Root() {
  const platform = usePlatform()
  const label = platform.window.getLabel()
  const path = window.location.pathname

  if (label === "onboarding" || path.startsWith("/onboarding")) return <OnboardingApp />
  if (label === "window-picker" || path.startsWith("/window-picker")) return <WindowPickerApp />
  if (label === "area-selection" || path.startsWith("/area-selection")) return <AreaSelectionApp />
  if (label === "camera-preview" || path.startsWith("/camera-preview")) return <CameraPreviewApp />
  if (label.startsWith("editor") || path.startsWith("/editor")) return <EditorApp />
  return <RecorderApp />
}

import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { getCurrentWindow } from "@tauri-apps/api/window"

import "./index.css"
import { RecorderApp } from "./recorder-app"
import { EditorApp } from "./editor-app"
import { WindowPickerApp } from "./window-picker-app"
import { OnboardingApp } from "./onboarding-app"

function Root() {
  const label = getCurrentWindow().label
  const path = window.location.pathname

  if (label === "onboarding" || path.startsWith("/onboarding")) return <OnboardingApp />
  if (label === "window-picker" || path.startsWith("/window-picker")) return <WindowPickerApp />
  if (label.startsWith("editor") || path.startsWith("/editor")) return <EditorApp />
  return <RecorderApp />
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>
)

import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "./index.css"
import { RecorderApp } from "./recorder-app"
import { EditorApp } from "./editor-app"
import { WindowPickerApp } from "./window-picker-app"

function Root() {
  const path = window.location.pathname
  if (path.startsWith("/editor")) return <EditorApp />
  if (path.startsWith("/window-picker")) return <WindowPickerApp />
  return <RecorderApp />
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>
)

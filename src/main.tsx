import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "./index.css"
import { RecorderApp } from "./recorder-app"
import { EditorApp } from "./editor-app"

function Root() {
  const path = window.location.pathname
  const isEditor = path.startsWith("/editor")

  if (isEditor) {
    return <EditorApp />
  }
  return <RecorderApp />
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>
)

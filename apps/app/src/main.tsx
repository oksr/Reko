import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./index.css"
import { Root } from "./root"

// In production, PlatformProvider is injected by tauri/src/main.tsx before mounting Root.
// This entry point is used for standalone dev/test contexts.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>
)

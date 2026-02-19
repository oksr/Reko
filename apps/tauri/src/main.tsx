import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { PlatformProvider } from "@app/platform/PlatformContext"
import { tauriPlatform } from "./platform/tauri-platform"
import "@app/index.css"

async function mount() {
  const { Root } = await import("@app/root")
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <PlatformProvider platform={tauriPlatform}>
        <Root />
      </PlatformProvider>
    </StrictMode>
  )
}

mount()

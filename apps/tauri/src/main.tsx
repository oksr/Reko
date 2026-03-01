import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { PlatformProvider } from "@app/platform/PlatformContext"
import { tauriPlatform } from "./platform/tauri-platform"
import { useUpdater } from "./hooks/use-updater"
import "@app/index.css"

function UpdateBanner() {
  const { update, install, installing } = useUpdater()
  if (!update) return null
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        background: "rgba(20,20,20,0.95)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        color: "#fff",
        fontSize: 13,
        fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
      <span style={{ opacity: 0.85 }}>
        Reko {update.version} is available
      </span>
      <button
        onClick={install}
        disabled={installing}
        style={{
          padding: "4px 12px",
          borderRadius: 6,
          border: "none",
          background: "rgba(255,255,255,0.15)",
          color: "#fff",
          fontSize: 12,
          fontWeight: 600,
          cursor: installing ? "default" : "pointer",
          opacity: installing ? 0.6 : 1,
        }}
      >
        {installing ? "Installing…" : "Update"}
      </button>
    </div>
  )
}

async function mount() {
  const { Root } = await import("@app/root")
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <PlatformProvider platform={tauriPlatform}>
        <Root />
        <UpdateBanner />
      </PlatformProvider>
    </StrictMode>
  )
}

mount()

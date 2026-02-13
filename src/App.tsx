import { useState, useEffect } from "react"
import { invoke } from "@tauri-apps/api/core"

function App() {
  const [engineVersion, setEngineVersion] = useState("")

  useEffect(() => {
    invoke<string>("get_engine_version").then(setEngineVersion)
  }, [])

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <h1 className="text-3xl font-bold">CaptureKit</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Engine v{engineVersion || "..."}
      </p>
    </main>
  )
}

export default App

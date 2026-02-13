import { useState, useEffect } from "react"
import { invoke } from "@tauri-apps/api/core"
import { SourcePicker } from "@/components/recording/source-picker"

function App() {
  const [engineVersion, setEngineVersion] = useState("")
  const [selectedDisplay, setSelectedDisplay] = useState<number | null>(null)

  useEffect(() => {
    invoke<string>("get_engine_version").then(setEngineVersion)
  }, [])

  return (
    <main className="flex min-h-screen flex-col p-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">CaptureKit</h1>
        <p className="text-sm text-muted-foreground">
          Engine v{engineVersion || "..."}
        </p>
      </div>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Record</h2>
        <SourcePicker
          onDisplaySelected={setSelectedDisplay}
          selectedDisplayId={selectedDisplay}
        />
      </section>
    </main>
  )
}

export default App

import { useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { Button } from "@/components/ui/button"
import { Download, Check, Loader2 } from "lucide-react"
import { useEditorStore } from "@/stores/editor-store"

export function ExportButton() {
  const project = useEditorStore((s) => s.project)
  const [exporting, setExporting] = useState(false)
  const [exported, setExported] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (!project) return null

  const handleExport = async () => {
    setExporting(true)
    setError(null)
    setExported(null)
    try {
      const path = await invoke<string>("quick_export", { projectId: project.id })
      setExported(path)
      // Reset after 3 seconds
      setTimeout(() => setExported(null), 3000)
    } catch (e) {
      setError(String(e))
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs text-destructive">{error}</span>}
      {exported && (
        <span className="text-xs text-green-400 flex items-center gap-1">
          <Check className="w-3 h-3" /> Saved to Desktop
        </span>
      )}
      <Button size="sm" onClick={handleExport} disabled={exporting}>
        {exporting ? (
          <Loader2 className="w-4 h-4 mr-1 animate-spin" />
        ) : (
          <Download className="w-4 h-4 mr-1" />
        )}
        Export
      </Button>
    </div>
  )
}

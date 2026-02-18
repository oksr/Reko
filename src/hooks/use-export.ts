import { useRef, useCallback, useState } from "react"
import { useEditorStore } from "@/stores/editor-store"
import { ExportPipeline } from "@/lib/export/export-pipeline"
import type { ExportConfig, ExportProgress } from "@/types/editor"
import { invoke } from "@tauri-apps/api/core"

export function useExport() {
  const [progress, setProgress] = useState<ExportProgress | null>(null)
  const pipelineRef = useRef<ExportPipeline | null>(null)

  const startExport = useCallback(async (exportConfig: ExportConfig) => {
    const project = useEditorStore.getState().project
    if (!project) throw new Error("No project loaded")

    const pipeline = new ExportPipeline()
    pipelineRef.current = pipeline

    await pipeline.run(project, exportConfig, {
      onProgress: setProgress,
      onComplete: async (mp4Data) => {
        // Write to disk via Tauri invoke
        const bytes = Array.from(new Uint8Array(mp4Data))
        await invoke("write_export_file", {
          path: exportConfig.outputPath,
          data: bytes,
        })
      },
      onError: (error) => {
        console.error("Export failed:", error)
        setProgress((p) => (p ? { ...p, phase: "error" } : null))
      },
    })
  }, [])

  const cancelExport = useCallback(() => {
    pipelineRef.current?.cancel()
    pipelineRef.current = null
  }, [])

  return { progress, startExport, cancelExport }
}

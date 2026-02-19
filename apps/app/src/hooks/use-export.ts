import { useRef, useCallback, useState } from "react"
import { usePlatform } from "@/platform/PlatformContext"
import { useAssetUrl } from "@/lib/asset-url"
import { useEditorStore } from "@/stores/editor-store"
import { ExportPipeline } from "@/lib/export/export-pipeline"
import type { ExportConfig, ExportProgress } from "@/types/editor"

export function useExport() {
  const platform = usePlatform()
  const assetUrl = useAssetUrl()
  const [progress, setProgress] = useState<ExportProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const pipelineRef = useRef<ExportPipeline | null>(null)

  const startExport = useCallback(async (exportConfig: ExportConfig) => {
    const project = useEditorStore.getState().project
    if (!project) throw new Error("No project loaded")

    setError(null)
    setProgress(null)

    const pipeline = new ExportPipeline(assetUrl)
    pipelineRef.current = pipeline

    await pipeline.run(project, exportConfig, {
      onProgress: setProgress,
      onComplete: async (mp4Data) => {
        // Collect audio file paths from the project
        const audioPaths: string[] = []
        if (project.tracks.mic) audioPaths.push(project.tracks.mic)
        if (project.tracks.system_audio) audioPaths.push(project.tracks.system_audio)

        if (audioPaths.length > 0) {
          // Write video-only MP4 to a temp path, then mux audio via ffmpeg
          const videoOnlyPath = exportConfig.outputPath.replace(
            /\.mp4$/,
            ".video-only.mp4"
          )
          await platform.invoke("write_export_file", {
            path: videoOnlyPath,
            data: Array.from(new Uint8Array(mp4Data)),
          })
          await platform.invoke("mux_audio", {
            videoPath: videoOnlyPath,
            audioPaths,
            outputPath: exportConfig.outputPath,
          })
        } else {
          // No audio — just write the video MP4 directly
          await platform.invoke("write_export_file", {
            path: exportConfig.outputPath,
            data: Array.from(new Uint8Array(mp4Data)),
          })
        }
      },
      onError: (err) => {
        console.error("[use-export] Export failed:", err)
        setError(err)
        setProgress({
          framesRendered: 0,
          totalFrames: 0,
          percentage: 0,
          elapsedMs: 0,
          estimatedRemainingMs: null,
          phase: "error",
        })
      },
    })
  }, [platform])

  const cancelExport = useCallback(() => {
    pipelineRef.current?.cancel()
    pipelineRef.current = null
  }, [])

  return { progress, error, startExport, cancelExport }
}

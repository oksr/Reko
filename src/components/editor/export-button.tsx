import { useState, useEffect, useRef, useCallback } from "react"
import { invoke } from "@tauri-apps/api/core"
import { Button } from "@/components/ui/button"
import { Download, X, Check, Loader2 } from "lucide-react"
import { useEditorStore } from "@/stores/editor-store"
import type { ExportConfig, ExportProgress } from "@/types/editor"

type Resolution = "original" | "1080p" | "720p"

export function ExportButton() {
    const project = useEditorStore((s) => s.project)
    const [showPanel, setShowPanel] = useState(false)
    const [resolution, setResolution] = useState<Resolution>("1080p")
    const [exporting, setExporting] = useState(false)
    const [progress, setProgress] = useState<ExportProgress | null>(null)
    const [result, setResult] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

    const stopPolling = useCallback(() => {
        if (pollRef.current) {
            clearInterval(pollRef.current)
            pollRef.current = null
        }
    }, [])

    // Clean up polling on unmount
    useEffect(() => stopPolling, [stopPolling])

    if (!project) return null

    const handleExport = async () => {
        setExporting(true)
        setError(null)
        setResult(null)
        setProgress(null)

        try {
            // Save project state first
            await invoke("save_project_state", {
                project: {
                    id: project.id,
                    name: project.name,
                    created_at: project.created_at,
                    tracks: project.tracks,
                    timeline: project.timeline,
                    effects: project.effects,
                },
            })

            // Build output path
            const home = await invoke<string>("get_home_dir")
            const filename = project.name.replace(/[/\\:"]/g, "_")
            const outputPath = `${home}/Desktop/${filename}.mp4`

            const config: ExportConfig = { resolution, outputPath }
            await invoke<number>("start_export", {
                projectId: project.id,
                exportConfig: config,
            })

            // Start polling progress
            pollRef.current = setInterval(async () => {
                try {
                    const prog = await invoke<ExportProgress>("get_export_progress")
                    setProgress(prog)

                    if (prog.phase === "done") {
                        stopPolling()
                        setExporting(false)
                        setResult(config.outputPath)
                        await invoke("finish_export")
                        setTimeout(() => setResult(null), 5000)
                    } else if (prog.phase === "error") {
                        stopPolling()
                        setExporting(false)
                        setError("Export failed")
                        await invoke("finish_export")
                    }
                } catch {
                    // polling error — might be transient
                }
            }, 200)
        } catch (e) {
            setError(String(e))
            setExporting(false)
        }
    }

    const handleCancel = async () => {
        stopPolling()
        try {
            await invoke("cancel_export")
        } catch { /* ignore */ }
        setExporting(false)
        setProgress(null)
    }

    // Progress bar view
    if (exporting && progress) {
        const pct = Math.round(progress.percentage)
        const eta = progress.estimatedRemainingMs
            ? `${Math.ceil(progress.estimatedRemainingMs / 1000)}s remaining`
            : "Estimating..."
        return (
            <div className="flex items-center gap-3">
                <div className="flex-1 min-w-[160px]">
                    <div className="flex justify-between text-xs text-muted-foreground mb-1">
                        <span>{progress.phase === "finalizing" ? "Finalizing..." : `${pct}%`}</span>
                        <span>{eta}</span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div
                            className="h-full bg-primary rounded-full transition-all duration-200"
                            style={{ width: `${pct}%` }}
                        />
                    </div>
                </div>
                <Button size="sm" variant="ghost" onClick={handleCancel}>
                    <X className="w-4 h-4" />
                </Button>
            </div>
        )
    }

    return (
        <div className="flex items-center gap-2">
            {error && <span className="text-xs text-destructive">{error}</span>}
            {result && (
                <span className="text-xs text-green-400 flex items-center gap-1">
                    <Check className="w-3 h-3" /> Saved to Desktop
                </span>
            )}

            {showPanel ? (
                <div className="flex items-center gap-2">
                    <select
                        value={resolution}
                        onChange={(e) => setResolution(e.target.value as Resolution)}
                        className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                    >
                        <option value="original">Original</option>
                        <option value="1080p">1080p</option>
                        <option value="720p">720p</option>
                    </select>
                    <Button size="sm" onClick={handleExport} disabled={exporting}>
                        {exporting ? (
                            <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                        ) : (
                            <Download className="w-4 h-4 mr-1" />
                        )}
                        Export
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setShowPanel(false)}>
                        <X className="w-4 h-4" />
                    </Button>
                </div>
            ) : (
                <Button size="sm" onClick={() => setShowPanel(true)}>
                    <Download className="w-4 h-4 mr-1" />
                    Export
                </Button>
            )}
        </div>
    )
}

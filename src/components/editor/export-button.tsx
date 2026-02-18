import { useState, useEffect } from "react"
import { invoke } from "@tauri-apps/api/core"
import { save } from "@tauri-apps/plugin-dialog"
import { Button } from "@/components/ui/button"
import { Download, X, Check, FolderOpen } from "lucide-react"
import { cn } from "@/lib/utils"
import { useEditorStore } from "@/stores/editor-store"
import { sanitizeProject } from "@/hooks/use-auto-save"
import { useExport } from "@/hooks/use-export"
import {
    BITRATE_MAP,
    type ExportResolution,
    type ExportQuality,
    type ExportConfig,
} from "@/types/editor"

function PillGroup<T extends string>({
    options,
    value,
    onChange,
}: {
    options: { label: string; value: T }[]
    value: T
    onChange: (v: T) => void
}) {
    return (
        <div className="flex gap-1">
            {options.map((opt) => (
                <button
                    key={opt.value}
                    onClick={() => onChange(opt.value)}
                    className={cn(
                        "px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
                        value === opt.value
                            ? "bg-white/10 text-white"
                            : "text-muted-foreground hover:text-white hover:bg-white/5"
                    )}
                >
                    {opt.label}
                </button>
            ))}
        </div>
    )
}

function resolveBitrate(
    resolution: ExportResolution,
    quality: ExportQuality
): number {
    const column = resolution === "original" ? "4k" : resolution
    return BITRATE_MAP[quality][column] ?? BITRATE_MAP[quality]["1080p"]
}

const RESOLUTION_OPTIONS: { label: string; value: ExportResolution }[] = [
    { label: "Original", value: "original" },
    { label: "4K", value: "4k" },
    { label: "1080p", value: "1080p" },
    { label: "720p", value: "720p" },
]

const QUALITY_OPTIONS: { label: string; value: ExportQuality }[] = [
    { label: "Low", value: "low" },
    { label: "Medium", value: "medium" },
    { label: "High", value: "high" },
    { label: "Best", value: "best" },
]

export function ExportButton() {
    const project = useEditorStore((s) => s.project)
    const [showPanel, setShowPanel] = useState(false)
    const [resolution, setResolution] = useState<ExportResolution>("1080p")
    const [quality, setQuality] = useState<ExportQuality>("high")
    const [outputPath, setOutputPath] = useState("")
    const [result, setResult] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)

    const { progress, startExport, cancelExport } = useExport()

    const exporting =
        progress !== null &&
        (progress.phase === "compositing" || progress.phase === "finalizing")

    // React to progress changes — detect completion and errors
    useEffect(() => {
        if (!progress) return

        if (progress.phase === "done") {
            setResult(outputPath)
            setTimeout(() => {
                setResult(null)
                setShowPanel(false)
            }, 5000)
        } else if (progress.phase === "error") {
            setError("Export failed")
        }
    }, [progress?.phase, outputPath])

    // Initialize output path on mount
    useEffect(() => {
        invoke<string>("get_home_dir").then((home) => {
            const filename =
                project?.name.replace(/[/\\:"]/g, "_") ?? "export"
            setOutputPath(`${home}/Desktop/${filename}.mp4`)
        })
    }, [project?.name])

    if (!project) return null

    const handleExport = async () => {
        setError(null)
        setResult(null)

        try {
            // Save project state first
            await invoke("save_project_state", {
                project: sanitizeProject(project),
            })

            const config: ExportConfig = {
                resolution,
                quality,
                bitrate: resolveBitrate(resolution, quality),
                outputPath,
            }
            await startExport(config)
        } catch (e) {
            setError(String(e))
        }
    }

    const handleCancel = () => {
        cancelExport()
    }

    const handleChooseDestination = async () => {
        const chosen = await save({
            defaultPath: outputPath,
            filters: [{ name: "MP4 Video", extensions: ["mp4"] }],
        })
        if (chosen) setOutputPath(chosen)
    }

    // Truncated display path — show last two segments
    const displayPath = outputPath
        ? outputPath
              .split("/")
              .filter(Boolean)
              .slice(-2)
              .join("/")
        : "..."

    const renderPanelContent = () => {
        // Completion state
        if (result) {
            return (
                <div className="flex flex-col items-center justify-center py-6 gap-2">
                    <div className="w-10 h-10 rounded-full bg-green-500/15 flex items-center justify-center">
                        <Check className="w-5 h-5 text-green-400" />
                    </div>
                    <span className="text-sm text-green-400 font-medium">
                        Saved!
                    </span>
                </div>
            )
        }

        // Progress state
        if (exporting) {
            const pct = progress ? Math.round(progress.percentage) : 0
            const eta = progress?.estimatedRemainingMs
                ? `${Math.ceil(progress.estimatedRemainingMs / 1000)}s remaining`
                : "Estimating..."
            const phaseLabel =
                progress?.phase === "finalizing" ? "Finalizing..." : `${pct}%`

            return (
                <div className="flex flex-col gap-3">
                    <div className="flex justify-between text-xs text-muted-foreground">
                        <span>{phaseLabel}</span>
                        <span>{eta}</span>
                    </div>
                    <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                        <div
                            className="h-full bg-primary rounded-full transition-all duration-200"
                            style={{ width: `${pct}%` }}
                        />
                    </div>
                    <Button
                        size="sm"
                        variant="ghost"
                        className="w-full text-muted-foreground hover:text-white"
                        onClick={handleCancel}
                    >
                        <X className="w-4 h-4 mr-1.5" />
                        Cancel
                    </Button>
                </div>
            )
        }

        // Default config state
        return (
            <div className="flex flex-col gap-4">
                {/* Resolution */}
                <div className="flex flex-col gap-1.5">
                    <span className="text-xs text-muted-foreground">
                        Resolution
                    </span>
                    <PillGroup
                        options={RESOLUTION_OPTIONS}
                        value={resolution}
                        onChange={setResolution}
                    />
                </div>

                {/* Quality */}
                <div className="flex flex-col gap-1.5">
                    <span className="text-xs text-muted-foreground">
                        Quality
                    </span>
                    <PillGroup
                        options={QUALITY_OPTIONS}
                        value={quality}
                        onChange={setQuality}
                    />
                </div>

                {/* Destination */}
                <div className="flex flex-col gap-1.5">
                    <span className="text-xs text-muted-foreground">
                        Save to
                    </span>
                    <div className="flex items-center gap-2">
                        <span className="flex-1 text-xs text-white/70 truncate min-w-0">
                            {displayPath}
                        </span>
                        <button
                            onClick={handleChooseDestination}
                            className="shrink-0 p-1.5 rounded-md text-muted-foreground hover:text-white hover:bg-white/5 transition-colors"
                        >
                            <FolderOpen className="w-4 h-4" />
                        </button>
                    </div>
                </div>

                {/* Error */}
                {error && (
                    <span className="text-xs text-destructive">{error}</span>
                )}

                {/* Export button */}
                <Button
                    className="w-full"
                    size="sm"
                    onClick={handleExport}
                    disabled={exporting}
                >
                    <Download className="w-4 h-4 mr-1.5" />
                    Export
                </Button>
            </div>
        )
    }

    return (
        <div className="relative">
            <Button size="sm" onClick={() => setShowPanel((v) => !v)}>
                <Download className="w-4 h-4 mr-1" />
                Export
            </Button>

            {showPanel && (
                <div className="absolute top-full right-0 mt-2 w-[320px] bg-[#1a1a1a] border border-white/10 rounded-xl p-4 shadow-2xl z-50">
                    {renderPanelContent()}
                </div>
            )}
        </div>
    )
}

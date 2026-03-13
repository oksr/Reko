import { useState, useEffect } from "react"
import { usePlatform } from "@/platform/PlatformContext"
import { Button } from "@/components/ui/button"
import { Download, X, Check, FolderOpen, Link, Copy, ExternalLink } from "lucide-react"
import { cn } from "@/lib/utils"
import { useEditorStore } from "@/stores/editor-store"
import { sanitizeProject } from "@/hooks/use-auto-save"
import { useExport } from "@/hooks/use-export"
import { useShare } from "@/hooks/use-share"
import {
    BITRATE_MAP,
    type ExportResolution,
    type ExportQuality,
    type ExportConfig,
} from "@/types/editor"
import { DEFAULT_SHARE_SETTINGS } from "@/types/sharing"

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
    const platform = usePlatform()
    const project = useEditorStore((s) => s.project)
    const [showPanel, setShowPanel] = useState(false)
    const [resolution, setResolution] = useState<ExportResolution>("1080p")
    const [quality, setQuality] = useState<ExportQuality>("high")
    const [outputPath, setOutputPath] = useState("")
    const [result, setResult] = useState<string | null>(null)
    const [localError, setLocalError] = useState<string | null>(null)
    const [linkCopied, setLinkCopied] = useState(false)
    const [showKeyInput, setShowKeyInput] = useState(false)
    const [keyInput, setKeyInput] = useState("")

    const { progress, error: exportError, startExport, cancelExport } = useExport()
    const {
        uploadProgress,
        shareResult,
        error: shareError,
        isUploading,
        startShare,
        reset: resetShare,
    } = useShare()

    const error = localError || exportError || shareError

    const exporting =
        progress !== null &&
        (progress.phase === "compositing" || progress.phase === "finalizing")

    // React to progress changes — detect completion and errors
    useEffect(() => {
        if (!progress) return

        if (progress.phase === "done") {
            setResult(outputPath)
        }
    }, [progress?.phase, outputPath])

    // Load defaults from settings + initialize output path
    useEffect(() => {
        platform.settings.getSettings().then((settings) => {
            setResolution(settings.defaultExportResolution as ExportResolution)
            setQuality(settings.defaultExportQuality as ExportQuality)

            const filename = project?.name.replace(/[/\\:"]/g, "_") ?? "export"
            setOutputPath(`${settings.defaultSavePath}/${filename}.mp4`)
        }).catch(() => {
            // Fallback for non-Tauri environments
            platform.invoke<string>("get_home_dir").then((home) => {
                const filename = project?.name.replace(/[/\\:"]/g, "_") ?? "export"
                setOutputPath(`${home}/Desktop/${filename}.mp4`)
            })
        })
    }, [project?.name]) // eslint-disable-line react-hooks/exhaustive-deps

    if (!project) return null

    const handleExport = async () => {
        setLocalError(null)
        setResult(null)
        resetShare()

        try {
            await platform.invoke("save_project_state", {
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
            console.error("[export] Export error:", e)
            setLocalError(String(e))
        }
    }

    const handleCancel = () => {
        cancelExport()
    }

    const handleShare = async () => {
        if (!result || !project) return

        try {
            // Read the exported file from disk
            const fileData = await platform.invoke<number[]>("read_file_bytes", {
                path: result,
            })
            const videoData = new Uint8Array(fileData).buffer

            const shareData = await startShare(videoData, {
                title: project.name,
                durationMs: project.timeline.out_point - project.timeline.in_point,
            }, DEFAULT_SHARE_SETTINGS)

            // Persist videoId and ownerToken in project state (triggers auto-save)
            if (shareData) {
                useEditorStore.setState((s) => ({
                    project: s.project
                        ? { ...s.project, shareVideoId: shareData.videoId, shareOwnerToken: shareData.ownerToken }
                        : s.project,
                }))
            }
        } catch (e) {
            console.error("[share] Share error:", e)
            setLocalError(String(e))
        }
    }

    const handleCopyLink = async () => {
        if (!shareResult) return
        await navigator.clipboard.writeText(shareResult.shareUrl)
        setLinkCopied(true)
        setTimeout(() => setLinkCopied(false), 2000)
    }

    const handleChooseDestination = async () => {
        const chosen = await platform.filesystem.saveDialog({
            defaultPath: outputPath,
            filters: [{ name: "MP4 Video", extensions: ["mp4"] }],
        })
        if (chosen) setOutputPath(chosen)
    }

    const handleClose = () => {
        setShowPanel(false)
        setResult(null)
        resetShare()
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
        // Share link result
        if (shareResult) {
            return (
                <div className="flex flex-col gap-3">
                    <div className="flex flex-col items-center justify-center py-4 gap-2">
                        <div className="w-10 h-10 rounded-full bg-blue-500/15 flex items-center justify-center">
                            <Link className="w-5 h-5 text-blue-400" />
                        </div>
                        <span className="text-sm text-blue-400 font-medium">
                            Link ready!
                        </span>
                    </div>

                    {/* Share URL */}
                    <div className="flex items-center gap-2 bg-white/5 rounded-lg px-3 py-2">
                        <span className="flex-1 text-xs text-white/70 truncate min-w-0">
                            {shareResult.shareUrl}
                        </span>
                        <button
                            onClick={handleCopyLink}
                            className="shrink-0 p-1.5 rounded-md text-muted-foreground hover:text-white hover:bg-white/10 transition-colors"
                        >
                            {linkCopied ? (
                                <Check className="w-3.5 h-3.5 text-green-400" />
                            ) : (
                                <Copy className="w-3.5 h-3.5" />
                            )}
                        </button>
                    </div>

                    <div className="flex gap-2">
                        <Button
                            size="sm"
                            variant="ghost"
                            className="flex-1 text-muted-foreground hover:text-white"
                            onClick={handleCopyLink}
                        >
                            <Copy className="w-4 h-4 mr-1.5" />
                            {linkCopied ? "Copied!" : "Copy Link"}
                        </Button>
                        <Button
                            size="sm"
                            variant="ghost"
                            className="flex-1 text-muted-foreground hover:text-white"
                            asChild
                        >
                            <a
                                href={shareResult.shareUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                <ExternalLink className="w-4 h-4 mr-1.5" />
                                Open
                            </a>
                        </Button>
                    </div>
                </div>
            )
        }

        // Upload progress
        if (isUploading && uploadProgress) {
            const pct = uploadProgress.percentage
            const phaseLabel =
                uploadProgress.phase === "finalizing"
                    ? "Finalizing..."
                    : `Uploading ${pct}%`

            return (
                <div className="flex flex-col gap-3">
                    <div className="flex justify-between text-xs text-muted-foreground">
                        <span>{phaseLabel}</span>
                        <span>
                            {formatBytes(uploadProgress.bytesUploaded)} /{" "}
                            {formatBytes(uploadProgress.totalBytes)}
                        </span>
                    </div>
                    <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                        <div
                            className="h-full bg-blue-500 rounded-full transition-all duration-200"
                            style={{ width: `${pct}%` }}
                        />
                    </div>
                </div>
            )
        }

        // Completion state — show save confirmation + share option
        if (result) {
            return (
                <div className="flex flex-col gap-3">
                    <div className="flex flex-col items-center justify-center py-4 gap-2">
                        <div className="w-10 h-10 rounded-full bg-green-500/15 flex items-center justify-center">
                            <Check className="w-5 h-5 text-green-400" />
                        </div>
                        <span className="text-sm text-green-400 font-medium">
                            Saved!
                        </span>
                    </div>

                    <div className="flex gap-2">
                        <Button
                            size="sm"
                            className="flex-1"
                            onClick={handleShare}
                        >
                            <Link className="w-4 h-4 mr-1.5" />
                            Share Link
                        </Button>
                        <Button
                            size="sm"
                            variant="ghost"
                            className="text-muted-foreground hover:text-white"
                            onClick={handleClose}
                        >
                            Done
                        </Button>
                    </div>
                </div>
            )
        }

        // Export progress state
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

                {/* Upgrade prompt for file_too_large quota errors */}
                {error && error.includes("file_too_large") && (
                    <div className="flex flex-col gap-2 mt-2">
                        <button
                            onClick={() => setShowKeyInput(!showKeyInput)}
                            className="text-xs text-blue-400 hover:text-blue-300 transition-colors text-left"
                        >
                            {showKeyInput ? "Hide" : "Have a Pro license key?"}
                        </button>
                        {showKeyInput && (
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    value={keyInput}
                                    onChange={(e) => setKeyInput(e.target.value)}
                                    placeholder="rk_live_..."
                                    className="flex-1 text-xs bg-white/5 border border-white/10 rounded-md px-2 py-1.5 text-white placeholder:text-white/30 focus:outline-none focus:border-white/20"
                                />
                                <button
                                    onClick={() => {
                                        if (keyInput.trim()) {
                                            localStorage.setItem("reko-license-key", keyInput.trim())
                                            setShowKeyInput(false)
                                            setLocalError(null)
                                        }
                                    }}
                                    className="text-xs px-3 py-1.5 bg-white/10 rounded-md text-white hover:bg-white/15 transition-colors"
                                >
                                    Save
                                </button>
                            </div>
                        )}
                        <a
                            href="https://reko.video/#pricing"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-muted-foreground hover:text-white transition-colors"
                        >
                            Get Pro →
                        </a>
                    </div>
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

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

import { useState, useEffect } from "react"
import {
  Copy,
  Check,
  Code2,
  Eye,
  Clock,
  AlertCircle,
  Loader2,
} from "lucide-react"
import { fetchVideo, type VideoMetadata } from "@/lib/api"
import { VideoPlayer } from "./video-player"
import { CommentsSection } from "./comments-section"

export function PlayerPage() {
  const [video, setVideo] = useState<VideoMetadata | null>(null)
  const [error, setError] = useState<
    "not_found" | "expired" | "fetch_failed" | null
  >(null)
  const [linkCopied, setLinkCopied] = useState(false)
  const [showEmbed, setShowEmbed] = useState(false)
  const [embedCopied, setEmbedCopied] = useState(false)

  const videoId = window.location.pathname.slice(1)

  useEffect(() => {
    if (!videoId) {
      setError("not_found")
      return
    }
    fetchVideo(videoId)
      .then((data) => {
        setVideo(data)
        document.title = `${data.title} \u2013 Reko`
      })
      .catch((err) => {
        setError(err.message as "not_found" | "expired" | "fetch_failed")
      })
  }, [videoId])

  const handleCopyLink = async () => {
    await navigator.clipboard.writeText(window.location.href)
    setLinkCopied(true)
    setTimeout(() => setLinkCopied(false), 2000)
  }

  const embedCode = `<iframe src="${window.location.href}?embed=1" width="640" height="360" frameborder="0" allowfullscreen></iframe>`

  const handleCopyEmbed = async () => {
    await navigator.clipboard.writeText(embedCode)
    setEmbedCopied(true)
    setTimeout(() => setEmbedCopied(false), 2000)
  }

  // Error states
  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="text-center max-w-[340px]">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-5 bg-white/[0.03] shadow-border">
            <AlertCircle className="w-6 h-6 text-white/20" />
          </div>
          <h1 className="text-white text-[17px] font-semibold -tracking-[0.01em] mb-2">
            {error === "expired" && "This video has expired"}
            {error === "not_found" && "Video not found"}
            {error === "fetch_failed" && "Failed to load video"}
          </h1>
          <p className="text-sm leading-relaxed text-white/35 mb-5">
            {error === "expired" &&
              "The owner set an expiration date on this video and it is no longer available."}
            {error === "not_found" &&
              "This video may have been deleted or the link is incorrect."}
            {error === "fetch_failed" &&
              "Something went wrong. Please try again later."}
          </p>
          <a
            href="https://reko.video"
            className="text-[13px] text-white/30 hover:text-white/60 transition-colors duration-150"
          >
            Go to reko.video &rarr;
          </a>
        </div>
      </div>
    )
  }

  // Loading
  if (!video) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-white/15" />
      </div>
    )
  }

  // Embed mode
  if (new URLSearchParams(window.location.search).has("embed")) {
    return (
      <div className="w-full h-screen bg-black">
        <VideoPlayer
          videoUrl={video.videoUrl}
          videoId={video.id}
          durationMs={video.durationMs}
          allowDownload={false}
          title={video.title}
        />
      </div>
    )
  }

  return (
    <div className="w-full min-h-screen bg-surface flex flex-col items-center">
      <div className="relative w-full max-w-[880px] mx-auto flex flex-col gap-3 pt-10">
        {/* Video */}
        <VideoPlayer
          videoUrl={video.videoUrl}
          videoId={video.id}
          durationMs={video.durationMs}
          allowDownload={video.settings.allowDownload}
          title={video.title}
        />

        {/* Info section */}
        <div className="mt-2 w-full flex flex-col items-start justify-center gap-5">
          {/* Title row with actions */}
          <div className="w-full flex items-start justify-between ">
            <div className="flex flex-col items-start justify-between ">
              <h1 className="text-white text-lg font-semibold -tracking-[0.02em] leading-snug">
                {video.title}
              </h1>
              {/* Meta row */}
              <div className="flex flex-wrap items-center gap-2.5 mt-1 text-[13px] text-white/30">
                <span className="inline-flex items-center gap-1.5">
                  <Eye className="w-3.5 h-3.5" />
                  <span className="tabular-nums">
                    {formatCount(video.analytics.views)}
                  </span>{" "}
                  views
                </span>
                <span className="w-[3px] h-[3px] rounded-full bg-white/15" />
                <span className="inline-flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5" />
                  {formatDuration(video.durationMs)}
                </span>
                <span className="w-[3px] h-[3px] rounded-full bg-white/15" />
                <span>{formatDate(video.createdAt)}</span>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <IconButton
                icon={
                  linkCopied ? (
                    <Check className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )
                }
                label={linkCopied ? "Copied!" : "Copy link"}
                onClick={handleCopyLink}
              />
              <IconButton
                icon={<Code2 className="w-4 h-4" />}
                label="Embed"
                onClick={() => setShowEmbed((v) => !v)}
                active={showEmbed}
              />
            </div>
          </div>


          {/* Embed panel */}
          {showEmbed && (
            <div className="mt-3 bg-white/[0.025] rounded-xl p-4 shadow-border">
              <p className="text-xs text-white/30 mb-2.5">
                Paste this to embed the video on your site
              </p>
              <div className="flex gap-2 items-start">
                <code className="flex-1 overflow-x-auto select-all text-xs leading-relaxed font-mono text-white/40 bg-black/30 rounded-lg p-3 shadow-[inset_0_0_0_0.5px_rgba(255,255,255,0.04)]">
                  {embedCode}
                </code>
                <button
                  onClick={handleCopyEmbed}
                  className="shrink-0 h-9 px-3.5 text-xs font-medium text-white/70 bg-white/[0.06] rounded-lg shadow-border hover:bg-white/10 hover:text-white/90 transition-[background,color] duration-150 cursor-pointer"
                >
                  {embedCopied ? "Copied!" : "Copy"}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Comments */}
        <CommentsSection
          videoId={video.id}
          enabled={video.settings.allowComments}
        />

        {/* Badge */}
        {video.settings.showBadge && (
          <div className="flex justify-center mt-12">
            <a
              href="https://reko.video"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2.5 h-9 pl-3 pr-4 text-[13px] font-medium text-white bg-surface-dark rounded-full shadow-border hover:bg-[#141416] hover:shadow-[0_0_0_0.5px_rgba(255,255,255,0.12)] transition-[background,box-shadow] duration-150"
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <circle cx="9" cy="9" r="8" fill="var(--color-reko-red)" />
                <circle cx="9" cy="9" r="2.5" fill="white" />
              </svg>
              Made with Reko
            </a>
          </div>
        )}
      </div>
    </div>
  )
}

function IconButton({
  icon,
  label,
  onClick,
  active,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  active?: boolean
}) {
  const [showTooltip, setShowTooltip] = useState(false)

  return (
    <div className="relative">
      <button
        onClick={onClick}
        aria-label={label}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        className={`w-9 h-9 flex items-center justify-center rounded-[10px] border-none cursor-pointer transition-[color,background] duration-150 ${active
            ? "text-white/80 bg-white/[0.06]"
            : "text-white/35 bg-transparent hover:text-white/80 hover:bg-white/[0.06]"
          }`}
      >
        {icon}
      </button>
      {showTooltip && (
        <div className="absolute top-[calc(100%+6px)] left-1/2 -translate-x-1/2 pointer-events-none whitespace-nowrap select-none text-[11px] font-medium text-white/80 bg-black/85 backdrop-blur-sm px-2.5 py-1 rounded-[7px] shadow-[0_0_0_0.5px_rgba(255,255,255,0.1),0_4px_12px_rgba(0,0,0,0.4)]">
          {label}
        </div>
      )}
    </div>
  )
}

function formatCount(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  if (m >= 60) {
    const h = Math.floor(m / 60)
    return `${h}:${(m % 60).toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`
  }
  return `${m}:${s.toString().padStart(2, "0")}`
}

function formatDate(epochMs: number): string {
  return new Date(epochMs).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

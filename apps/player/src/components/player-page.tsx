import { useState, useEffect } from "react"
import { Copy, Check, Code, Eye, Clock, AlertCircle, Loader2 } from "lucide-react"
import { fetchVideo, type VideoMetadata } from "@/lib/api"
import { VideoPlayer } from "./video-player"
import { CommentsSection } from "./comments-section"

export function PlayerPage() {
  const [video, setVideo] = useState<VideoMetadata | null>(null)
  const [error, setError] = useState<"not_found" | "expired" | "fetch_failed" | null>(null)
  const [linkCopied, setLinkCopied] = useState(false)
  const [showEmbed, setShowEmbed] = useState(false)

  // Extract video ID from URL path: /abc123
  const videoId = window.location.pathname.slice(1)

  useEffect(() => {
    if (!videoId) {
      setError("not_found")
      return
    }
    fetchVideo(videoId)
      .then((data) => {
        setVideo(data)
        document.title = `${data.title} - Reko`
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
    setShowEmbed(false)
  }

  // Error states
  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center space-y-4">
          <AlertCircle className="w-12 h-12 text-white/30 mx-auto" />
          <h1 className="text-xl font-semibold text-white">
            {error === "expired" && "This video has expired"}
            {error === "not_found" && "Video not found"}
            {error === "fetch_failed" && "Failed to load video"}
          </h1>
          <p className="text-sm text-white/50 max-w-md">
            {error === "expired" &&
              "The owner set an expiration date on this video and it is no longer available."}
            {error === "not_found" &&
              "This video may have been deleted or the link is incorrect."}
            {error === "fetch_failed" &&
              "Something went wrong. Please try again later."}
          </p>
          <a
            href="https://reko.video"
            className="inline-block text-sm text-blue-400 hover:text-blue-300 transition-colors"
          >
            Go to reko.video
          </a>
        </div>
      </div>
    )
  }

  // Loading state
  if (!video) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-white/30 animate-spin" />
      </div>
    )
  }

  // Embed mode — just the video player
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
    <div className="min-h-screen bg-[#0a0a0a]">
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Video player */}
        <VideoPlayer
          videoUrl={video.videoUrl}
          videoId={video.id}
          durationMs={video.durationMs}
          allowDownload={video.settings.allowDownload}
          title={video.title}
        />

        {/* Video info */}
        <div className="mt-4 space-y-3">
          <h1 className="text-xl font-semibold text-white">{video.title}</h1>

          <div className="flex items-center gap-4 text-sm text-white/50">
            <span className="flex items-center gap-1.5">
              <Eye className="w-4 h-4" />
              {formatCount(video.analytics.views)} views
            </span>
            <span className="flex items-center gap-1.5">
              <Clock className="w-4 h-4" />
              {formatDuration(video.durationMs)}
            </span>
            <span>{formatDate(video.createdAt)}</span>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 pt-2">
            <button
              onClick={handleCopyLink}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-sm text-white/70 hover:text-white transition-colors"
            >
              {linkCopied ? (
                <Check className="w-4 h-4 text-green-400" />
              ) : (
                <Copy className="w-4 h-4" />
              )}
              {linkCopied ? "Copied!" : "Copy Link"}
            </button>

            <button
              onClick={() => setShowEmbed((v) => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-sm text-white/70 hover:text-white transition-colors"
            >
              <Code className="w-4 h-4" />
              Embed
            </button>
          </div>

          {/* Embed code */}
          {showEmbed && (
            <div className="bg-white/5 rounded-lg p-3 space-y-2">
              <p className="text-xs text-white/50">
                Copy this code to embed the video on your site:
              </p>
              <div className="flex gap-2">
                <code className="flex-1 text-xs text-white/70 bg-black/30 rounded p-2 overflow-x-auto">
                  {embedCode}
                </code>
                <button
                  onClick={handleCopyEmbed}
                  className="shrink-0 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-xs text-white transition-colors"
                >
                  Copy
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
          <div className="mt-12 pt-6 border-t border-white/5 text-center">
            <a
              href="https://reko.video"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-xs text-white/30 hover:text-white/50 transition-colors"
            >
              <svg
                viewBox="0 0 24 24"
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="12" cy="12" r="10" />
                <polygon points="10 8 16 12 10 16 10 8" fill="currentColor" />
              </svg>
              Made with Reko
            </a>
          </div>
        )}
      </div>
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

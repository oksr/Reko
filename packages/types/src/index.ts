// ─── Canonical Wire Types ──────────────────────────────────────────────────
// Shared between @reko/app, @reko/api, and @reko/player.
// These types describe the shapes that cross the network boundary.

/** User-configurable sharing preferences. */
export interface VideoSettings {
  allowComments: boolean
  allowDownload: boolean
  showBadge: boolean // "Made with Reko" watermark
  passwordProtected: boolean
}

/** Aggregated view analytics returned by the API. */
export interface VideoAnalytics {
  views: number
  uniqueViewers: number
  totalWatchTimeMs: number
}

/** Public video metadata returned by GET /api/videos/:id. */
export interface VideoMetadata {
  id: string
  title: string
  thumbnailUrl: string | null
  videoUrl: string
  durationMs: number
  createdAt: number
  settings: VideoSettings
  analytics: VideoAnalytics
}

/** A comment on a shared video (wire shape from GET /api/videos/:id/comments). */
export interface VideoComment {
  id: string
  authorName: string
  content: string
  timestampMs: number | null // optional video timestamp for time-linked comments
  createdAt: number
}

// ─── API Request/Response Types ─────────────────────────────────────────────

/** POST /api/videos — create a video record and get a presigned upload URL. */
export interface CreateVideoRequest {
  title: string
  fileSizeBytes: number
  durationMs: number
  contentType: string // "video/mp4"
  settings: VideoSettings
}

/** Response from POST /api/videos. */
export interface CreateVideoResponse {
  videoId: string
  ownerToken: string // returned ONCE — must be stored securely by the client
  uploadUrl: string // presigned PUT URL to R2
  shareUrl: string // e.g. "https://share.reko.video/abc123"
}

/** POST /api/videos/:id/comments */
export interface AddCommentRequest {
  authorName: string
  content: string
  timestampMs?: number
}

/** POST /api/videos/:id/views */
export interface TrackViewRequest {
  watchTimeMs: number
  completionPercent: number
  referrer?: string
}

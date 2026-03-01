// ─── Shareable Video Links ───────────────────────────────────────────────────
// Types shared between the desktop app, backend API, and video player page.

/** A video that has been uploaded and shared via a public link. */
export interface SharedVideo {
  id: string // nanoid, used in the share URL
  projectId: string // local project ID
  title: string
  thumbnailUrl: string | null
  videoUrl: string // R2 or BYO bucket URL
  durationMs: number
  fileSizeBytes: number
  createdAt: number // epoch ms
  expiresAt: number | null // epoch ms, null = never
  settings: ShareSettings
  analytics: ShareAnalytics
}

export interface ShareSettings {
  allowComments: boolean
  allowDownload: boolean
  showBadge: boolean // "Made with Reko" watermark
  passwordProtected: boolean
}

export interface ShareAnalytics {
  views: number
  uniqueViewers: number
  totalWatchTimeMs: number
}

/** Detailed analytics for the video owner dashboard. */
export interface ViewEvent {
  id: string
  videoId: string
  viewerIp: string // hashed for privacy
  userAgent: string
  watchTimeMs: number
  completionPercent: number
  referrer: string | null
  country: string | null
  timestamp: number
}

/** Comment on a shared video. */
export interface VideoComment {
  id: string
  videoId: string
  authorName: string
  content: string
  timestampMs: number | null // optional video timestamp for time-linked comments
  createdAt: number
}

// ─── API Request/Response Types ─────────────────────────────────────────────

/** Request to create a new share link. Returns a presigned upload URL. */
export interface CreateShareRequest {
  title: string
  fileSizeBytes: number
  durationMs: number
  contentType: string // "video/mp4"
  settings: ShareSettings
}

export interface CreateShareResponse {
  videoId: string
  uploadUrl: string // presigned PUT URL to R2
  shareUrl: string // e.g. "https://share.reko.video/abc123"
}

/** Called after upload completes to finalize the share. */
export interface FinalizeShareRequest {
  videoId: string
  thumbnailData?: string // base64 encoded
}

export interface FinalizeShareResponse {
  shareUrl: string
  thumbnailUrl: string | null
}

/** Upload progress tracked locally in the desktop app. */
export interface ShareUploadProgress {
  phase: "uploading" | "finalizing" | "done" | "error"
  bytesUploaded: number
  totalBytes: number
  percentage: number
}

// ─── Storage Config (BYO) ───────────────────────────────────────────────────

export type StorageProvider = "reko" | "s3" | "r2" | "gcs"

export interface StorageConfig {
  provider: StorageProvider
  endpoint?: string // S3-compatible endpoint
  bucket?: string
  region?: string
  accessKeyId?: string
  secretAccessKey?: string
}

export const DEFAULT_SHARE_SETTINGS: ShareSettings = {
  allowComments: true,
  allowDownload: false,
  showBadge: true,
  passwordProtected: false,
}

// ─── Shareable Video Links ───────────────────────────────────────────────────
// Re-export canonical wire types from @reko/types
export type {
  VideoSettings,
  VideoAnalytics,
  VideoMetadata,
  VideoComment,
  CreateVideoRequest,
  CreateVideoResponse,
} from "@reko/types"

// Backward-compat aliases for existing code that uses the old names
import type { VideoSettings, VideoAnalytics, CreateVideoRequest, CreateVideoResponse } from "@reko/types"
export type ShareSettings = VideoSettings
export type ShareAnalytics = VideoAnalytics
export type CreateShareRequest = CreateVideoRequest
export type CreateShareResponse = CreateVideoResponse

// ─── App-internal Types ─────────────────────────────────────────────────────

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
  settings: VideoSettings
  analytics: VideoAnalytics
}

/** Detailed analytics for the video owner dashboard. */
export interface ViewEvent {
  id: string
  videoId: string
  viewerHash: string // SHA-256 truncated hash of IP (not reversible)
  watchTimeMs: number
  completionPercent: number
  referrerDomain: string | null // domain only, path/query stripped for privacy
  country: string | null // from Cloudflare cf-ipcountry (aggregate-level)
  timestamp: number
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

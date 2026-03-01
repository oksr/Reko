// Cloudflare Worker environment bindings
export interface Env {
  VIDEOS_BUCKET: R2Bucket
  DB: D1Database
  SHARE_BASE_URL: string
}

// ─── DB Row Types ───────────────────────────────────────────────────────────

export interface VideoRow {
  id: string
  project_id: string
  title: string
  thumbnail_key: string | null
  video_key: string
  duration_ms: number
  file_size_bytes: number
  status: "pending" | "ready" | "deleted"
  created_at: number
  expires_at: number | null
  allow_comments: number // SQLite boolean
  allow_download: number
  show_badge: number
  password_hash: string | null
  view_count: number
  unique_viewer_count: number
  total_watch_time_ms: number
}

export interface ViewEventRow {
  id: string
  video_id: string
  viewer_hash: string
  user_agent: string | null
  watch_time_ms: number
  completion_percent: number
  referrer: string | null
  country: string | null
  created_at: number
}

export interface CommentRow {
  id: string
  video_id: string
  author_name: string
  content: string
  timestamp_ms: number | null
  created_at: number
}

// ─── API Types ──────────────────────────────────────────────────────────────

export interface CreateVideoRequest {
  title: string
  fileSizeBytes: number
  durationMs: number
  contentType: string
  settings: {
    allowComments: boolean
    allowDownload: boolean
    showBadge: boolean
    passwordProtected: boolean
  }
}

export interface CreateVideoResponse {
  videoId: string
  uploadUrl: string
  shareUrl: string
}

export interface VideoMetadata {
  id: string
  title: string
  thumbnailUrl: string | null
  videoUrl: string
  durationMs: number
  createdAt: number
  settings: {
    allowComments: boolean
    allowDownload: boolean
    showBadge: boolean
    passwordProtected: boolean
  }
  analytics: {
    views: number
    uniqueViewers: number
    totalWatchTimeMs: number
  }
}

export interface AddCommentRequest {
  authorName: string
  content: string
  timestampMs?: number
}

export interface TrackViewRequest {
  watchTimeMs: number
  completionPercent: number
  referrer?: string
}

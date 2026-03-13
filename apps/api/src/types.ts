// Re-export shared wire types
export type {
  VideoSettings,
  VideoAnalytics,
  VideoMetadata,
  VideoComment,
  CreateVideoRequest,
  CreateVideoResponse,
  AddCommentRequest,
  TrackViewRequest,
} from "@reko/types"

// Cloudflare Worker environment bindings
export interface Env {
  VIDEOS_BUCKET: R2Bucket
  DB: D1Database
  SHARE_BASE_URL: string
  ENVIRONMENT?: string
  LEMONSQUEEZY_API_KEY: string        // wrangler secret
  LEMONSQUEEZY_WEBHOOK_SECRET: string // wrangler secret
  LEMONSQUEEZY_STORE_ID: string       // wrangler var
  LEMONSQUEEZY_VARIANT_ID: string     // wrangler var
  WEBSITE_URL: string                 // wrangler var
}

// ─── DB Row Types ───────────────────────────────────────────────────────────

export interface VideoRow {
  id: string
  owner_token_hash: string
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
  license_key_id: string | null
}

export interface ViewEventRow {
  id: string
  video_id: string
  viewer_hash: string
  watch_time_ms: number
  completion_percent: number
  referrer_domain: string | null
  country: string | null
  created_at: number
}

export interface LicenseKeyRow {
  id: string
  key_hash: string | null
  email: string
  activation_token: string | null
  ls_customer_id: string | null
  ls_subscription_id: string | null
  status: 'pending' | 'active' | 'canceled' | 'past_due'
  created_at: number
  updated_at: number
}

export interface CommentRow {
  id: string
  video_id: string
  author_name: string
  content: string
  timestamp_ms: number | null
  created_at: number
}

-- Reko Shared Videos Database Schema (Cloudflare D1 / SQLite)
--
-- Privacy notes:
--   - owner_token is hashed before storage (SHA-256) — raw token only returned once at creation
--   - viewer IPs are hashed (SHA-256, truncated to 16 hex chars) — no raw IPs stored
--   - no user_agent stored — it's a browser fingerprinting vector
--   - referrer stored as domain-only (stripped of path/query) to prevent leaking private URLs
--   - country derived from Cloudflare's cf-ipcountry header (aggregate-level, not identifying)

CREATE TABLE IF NOT EXISTS videos (
  id TEXT PRIMARY KEY,                    -- nanoid, used in share URL (unguessable)
  owner_token_hash TEXT NOT NULL,         -- SHA-256 of the owner token (never stored raw)
  project_id TEXT NOT NULL,               -- local project ID from the desktop app
  title TEXT NOT NULL,
  thumbnail_key TEXT,                     -- R2 object key for thumbnail
  video_key TEXT NOT NULL,                -- R2 object key for video file
  duration_ms INTEGER NOT NULL,
  file_size_bytes INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | ready | deleted
  created_at INTEGER NOT NULL,            -- epoch ms
  expires_at INTEGER,                     -- epoch ms, NULL = never

  -- share settings
  allow_comments INTEGER NOT NULL DEFAULT 1,
  allow_download INTEGER NOT NULL DEFAULT 0,
  show_badge INTEGER NOT NULL DEFAULT 1,
  password_hash TEXT,                     -- bcrypt hash, NULL = no password

  -- aggregated analytics (denormalized for fast reads)
  view_count INTEGER NOT NULL DEFAULT 0,
  unique_viewer_count INTEGER NOT NULL DEFAULT 0,
  total_watch_time_ms INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS view_events (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  viewer_hash TEXT NOT NULL,              -- SHA-256 of IP, truncated (not reversible)
  watch_time_ms INTEGER NOT NULL DEFAULT 0,
  completion_percent REAL NOT NULL DEFAULT 0,
  referrer_domain TEXT,                   -- domain only, no path/query
  country TEXT,                           -- from cf-ipcountry (aggregate-level)
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_view_events_video ON view_events(video_id);
CREATE INDEX IF NOT EXISTS idx_view_events_created ON view_events(created_at);

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  author_name TEXT NOT NULL,
  content TEXT NOT NULL,
  timestamp_ms INTEGER,                   -- video timestamp for time-linked comments
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_comments_video ON comments(video_id);

-- Clean up expired videos periodically via a cron trigger
CREATE INDEX IF NOT EXISTS idx_videos_expires ON videos(expires_at)
  WHERE expires_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS license_keys (
  id TEXT PRIMARY KEY,                    -- nanoid(16)
  key_hash TEXT,                          -- SHA-256 of the license key (null until activated)
  email TEXT NOT NULL DEFAULT '',         -- from Lemon Squeezy checkout
  activation_token TEXT UNIQUE,           -- correlates checkout → webhook → activate
  ls_customer_id TEXT,                    -- Lemon Squeezy customer ID
  ls_subscription_id TEXT,                -- Lemon Squeezy subscription ID
  status TEXT NOT NULL DEFAULT 'pending', -- pending | active | canceled | past_due
  created_at INTEGER NOT NULL,            -- epoch ms
  updated_at INTEGER NOT NULL             -- epoch ms
);

CREATE INDEX IF NOT EXISTS idx_license_keys_status ON license_keys(status);
CREATE INDEX IF NOT EXISTS idx_license_keys_activation ON license_keys(activation_token);
CREATE INDEX IF NOT EXISTS idx_license_keys_ls_sub ON license_keys(ls_subscription_id);

-- Migration: add license_key_id to videos (run separately)
ALTER TABLE videos ADD COLUMN license_key_id TEXT REFERENCES license_keys(id);

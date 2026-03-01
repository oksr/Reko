-- Reko Shared Videos Database Schema (Cloudflare D1 / SQLite)

CREATE TABLE IF NOT EXISTS videos (
  id TEXT PRIMARY KEY,                    -- nanoid, used in share URL
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
  viewer_hash TEXT NOT NULL,              -- hashed IP for privacy
  user_agent TEXT,
  watch_time_ms INTEGER NOT NULL DEFAULT 0,
  completion_percent REAL NOT NULL DEFAULT 0,
  referrer TEXT,
  country TEXT,
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

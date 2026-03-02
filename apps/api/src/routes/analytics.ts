import { Hono } from "hono"
import { nanoid } from "nanoid"
import type { Env, TrackViewRequest, ViewEventRow } from "../types"
import { hashShort, extractDomain } from "../lib/crypto"
import { requireOwner } from "../middleware/auth"

const analytics = new Hono<{ Bindings: Env }>()

/**
 * POST /api/videos/:id/views
 * Track a view event. Called by the video player page via beacon API.
 * Public endpoint — no auth required (anyone watching triggers a view).
 *
 * Privacy measures:
 *   - IP is hashed (SHA-256 truncated to 16 hex chars) — not reversible
 *   - user_agent is NOT stored — it's a browser fingerprinting vector
 *   - referrer is stripped to domain-only — prevents leaking private URLs
 *   - country comes from Cloudflare's cf-ipcountry (aggregate-level)
 */
analytics.post("/:id/views", async (c) => {
  const videoId = c.req.param("id")
  const body = await c.req.json<TrackViewRequest>()

  // Validate inputs
  if (typeof body.watchTimeMs !== "number" || body.watchTimeMs < 0) {
    return c.json({ error: "watchTimeMs must be a non-negative number" }, 400)
  }
  if (typeof body.completionPercent !== "number" || body.completionPercent < 0 || body.completionPercent > 100) {
    return c.json({ error: "completionPercent must be between 0 and 100" }, 400)
  }

  // Verify video exists and cap watchTimeMs at 110% of video duration
  const video = await c.env.DB.prepare(
    "SELECT duration_ms FROM videos WHERE id = ? AND status = 'ready'"
  )
    .bind(videoId)
    .first<{ duration_ms: number }>()

  if (!video) {
    return c.json({ error: "Not found" }, 404)
  }

  const watchTimeMs = Math.min(body.watchTimeMs, video.duration_ms * 1.1)
  const completionPercent = Math.min(body.completionPercent, 100)

  const ip = c.req.header("cf-connecting-ip") || "unknown"
  const viewerHash = await hashShort(ip)
  const referrerDomain = extractDomain(body.referrer)

  const eventId = nanoid(16)
  const now = Date.now()

  await c.env.DB.prepare(
    `INSERT INTO view_events (id, video_id, viewer_hash, watch_time_ms, completion_percent, referrer_domain, country, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      eventId,
      videoId,
      viewerHash,
      watchTimeMs,
      completionPercent,
      referrerDomain,
      c.req.header("cf-ipcountry") || null,
      now
    )
    .run()

  // Update denormalized counters
  const existingViewer = await c.env.DB.prepare(
    "SELECT 1 FROM view_events WHERE video_id = ? AND viewer_hash = ? AND id != ?"
  )
    .bind(videoId, viewerHash, eventId)
    .first()

  const isUnique = !existingViewer

  await c.env.DB.prepare(
    `UPDATE videos SET
      view_count = view_count + 1,
      unique_viewer_count = unique_viewer_count + CASE WHEN ? THEN 1 ELSE 0 END,
      total_watch_time_ms = total_watch_time_ms + ?
    WHERE id = ?`
  )
    .bind(isUnique ? 1 : 0, watchTimeMs, videoId)
    .run()

  return c.json({ ok: true })
})

/**
 * GET /api/videos/:id/analytics
 * Returns detailed analytics for the video owner.
 * Requires owner token — only the person who created the share link
 * can see detailed analytics. Returns 404 if unauthorized.
 */
analytics.get("/:id/analytics", async (c) => {
  const videoId = c.req.param("id")

  // Owner-only: verify token
  const owner = await requireOwner(c, videoId)
  if (!owner) return c.json({ error: "Not found" }, 404)

  const video = await c.env.DB.prepare(
    "SELECT view_count, unique_viewer_count, total_watch_time_ms FROM videos WHERE id = ?"
  )
    .bind(videoId)
    .first()

  if (!video) {
    return c.json({ error: "Not found" }, 404)
  }

  // Recent view events (last 100) — no identifying data exposed
  const { results: recentViews } = await c.env.DB.prepare(
    `SELECT created_at, watch_time_ms, completion_percent, country, referrer_domain
     FROM view_events
     WHERE video_id = ?
     ORDER BY created_at DESC
     LIMIT 100`
  )
    .bind(videoId)
    .all<ViewEventRow>()

  // Views per day (last 30 days)
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000
  const { results: dailyViews } = await c.env.DB.prepare(
    `SELECT
       date(created_at / 1000, 'unixepoch') as day,
       COUNT(*) as views,
       AVG(completion_percent) as avg_completion
     FROM view_events
     WHERE video_id = ? AND created_at > ?
     GROUP BY day
     ORDER BY day`
  )
    .bind(videoId, thirtyDaysAgo)
    .all()

  return c.json({
    totals: {
      views: video.view_count,
      uniqueViewers: video.unique_viewer_count,
      totalWatchTimeMs: video.total_watch_time_ms,
    },
    dailyViews,
    recentViews: recentViews.map((v) => ({
      timestamp: v.created_at,
      watchTimeMs: v.watch_time_ms,
      completionPercent: v.completion_percent,
      country: v.country,
      referrerDomain: v.referrer_domain,
    })),
  })
})

export { analytics }

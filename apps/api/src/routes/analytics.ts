import { Hono } from "hono"
import { nanoid } from "nanoid"
import type { Env, TrackViewRequest, ViewEventRow } from "../types"

const analytics = new Hono<{ Bindings: Env }>()

/**
 * POST /api/videos/:id/views
 * Track a view event. Called by the video player page via beacon API.
 */
analytics.post("/:id/views", async (c) => {
  const videoId = c.req.param("id")
  const body = await c.req.json<TrackViewRequest>()

  // Hash the viewer IP for privacy
  const ip = c.req.header("cf-connecting-ip") || "unknown"
  const viewerHash = await hashString(ip)

  const eventId = nanoid(16)
  const now = Date.now()

  await c.env.DB.prepare(
    `INSERT INTO view_events (id, video_id, viewer_hash, user_agent, watch_time_ms, completion_percent, referrer, country, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      eventId,
      videoId,
      viewerHash,
      c.req.header("user-agent") || null,
      body.watchTimeMs,
      body.completionPercent,
      body.referrer || null,
      c.req.header("cf-ipcountry") || null,
      now
    )
    .run()

  // Update denormalized counters on the video
  // Check if this is a unique viewer
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
    .bind(isUnique ? 1 : 0, body.watchTimeMs, videoId)
    .run()

  return c.json({ ok: true })
})

/**
 * GET /api/videos/:id/analytics
 * Returns detailed analytics for the video owner.
 */
analytics.get("/:id/analytics", async (c) => {
  const videoId = c.req.param("id")

  // Get overall stats
  const video = await c.env.DB.prepare(
    "SELECT view_count, unique_viewer_count, total_watch_time_ms FROM videos WHERE id = ?"
  )
    .bind(videoId)
    .first()

  if (!video) {
    return c.json({ error: "Video not found" }, 404)
  }

  // Get recent view events (last 100)
  const { results: recentViews } = await c.env.DB.prepare(
    `SELECT created_at, watch_time_ms, completion_percent, country, referrer
     FROM view_events
     WHERE video_id = ?
     ORDER BY created_at DESC
     LIMIT 100`
  )
    .bind(videoId)
    .all<ViewEventRow>()

  // Get views per day (last 30 days)
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
      referrer: v.referrer,
    })),
  })
})

async function hashString(input: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(input)
  const hash = await crypto.subtle.digest("SHA-256", data)
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16)
}

export { analytics }

import { Hono } from "hono"
import type { Env, VideoRow, VideoMetadata } from "../types"
import { requireOwner } from "../middleware/auth"

const video = new Hono<{ Bindings: Env }>()

/**
 * GET /api/videos/:id
 * Returns video metadata for the player page.
 * Public endpoint — no auth required.
 *
 * Returns the same 404 for "doesn't exist", "deleted", and "expired"
 * to prevent ID enumeration.
 */
video.get("/:id", async (c) => {
  const videoId = c.req.param("id")

  const row = await c.env.DB.prepare(
    "SELECT * FROM videos WHERE id = ? AND status = 'ready'"
  )
    .bind(videoId)
    .first<VideoRow>()

  // Uniform 404 for missing, deleted, or expired — prevents probing
  if (!row) {
    return c.json({ error: "Not found" }, 404)
  }

  if (row.expires_at && row.expires_at < Date.now()) {
    return c.json({ error: "expired" }, 410)
  }

  const apiBase = new URL(c.req.url).origin

  const metadata: VideoMetadata = {
    id: row.id,
    title: row.title,
    thumbnailUrl: row.thumbnail_key
      ? `${apiBase}/api/videos/${row.id}/thumbnail`
      : null,
    videoUrl: `${apiBase}/api/videos/${row.id}/stream`,
    durationMs: row.duration_ms,
    createdAt: row.created_at,
    settings: {
      allowComments: row.allow_comments === 1,
      allowDownload: row.allow_download === 1,
      showBadge: row.license_key_id ? (row.show_badge === 1) : true,
      passwordProtected: row.password_hash !== null,
    },
    analytics: {
      views: row.view_count,
      uniqueViewers: row.unique_viewer_count,
      totalWatchTimeMs: row.total_watch_time_ms,
    },
  }

  return c.json(metadata)
})

/**
 * GET /api/videos/:id/stream
 * Streams the video file from R2. Supports range requests.
 * Public endpoint — anyone with the link can watch.
 */
video.get("/:id/stream", async (c) => {
  const videoId = c.req.param("id")

  const row = await c.env.DB.prepare(
    "SELECT video_key, expires_at FROM videos WHERE id = ? AND status = 'ready'"
  )
    .bind(videoId)
    .first<{ video_key: string; expires_at: number | null }>()

  if (!row) {
    return c.json({ error: "Not found" }, 404)
  }

  if (row.expires_at && row.expires_at < Date.now()) {
    return c.json({ error: "expired" }, 410)
  }

  const rangeHeader = c.req.header("range")
  const object = await c.env.VIDEOS_BUCKET.get(row.video_key, {
    range: rangeHeader ? parseRange(rangeHeader) : undefined,
  })

  if (!object) {
    return c.json({ error: "Not found" }, 404)
  }

  const headers = new Headers()
  headers.set("content-type", "video/mp4")
  headers.set("accept-ranges", "bytes")
  headers.set("cache-control", "public, max-age=31536000, immutable")

  if (object.range) {
    const range = object.range as { offset: number; length: number }
    headers.set("content-length", String(range.length))
    headers.set(
      "content-range",
      `bytes ${range.offset}-${range.offset + range.length - 1}/${object.size}`
    )
    return new Response(object.body, { status: 206, headers })
  }

  headers.set("content-length", String(object.size))
  return new Response(object.body, { status: 200, headers })
})

/**
 * GET /api/videos/:id/thumbnail
 * Serves the thumbnail image from R2. Public endpoint.
 */
video.get("/:id/thumbnail", async (c) => {
  const videoId = c.req.param("id")

  const row = await c.env.DB.prepare(
    "SELECT thumbnail_key, expires_at FROM videos WHERE id = ? AND status = 'ready'"
  )
    .bind(videoId)
    .first<{ thumbnail_key: string | null; expires_at: number | null }>()

  if (!row?.thumbnail_key) {
    return c.json({ error: "Not found" }, 404)
  }

  if (row.expires_at && row.expires_at < Date.now()) {
    return c.json({ error: "expired" }, 410)
  }

  const object = await c.env.VIDEOS_BUCKET.get(row.thumbnail_key)
  if (!object) {
    return c.json({ error: "Not found" }, 404)
  }

  return new Response(object.body, {
    headers: {
      "content-type": "image/jpeg",
      "cache-control": "public, max-age=31536000, immutable",
    },
  })
})

/**
 * DELETE /api/videos/:id
 * Deletes a shared video and its associated files.
 * Requires owner token in Authorization header.
 * Returns 404 for both "not found" and "unauthorized" (prevents probing).
 */
video.delete("/:id", async (c) => {
  const videoId = c.req.param("id")

  const owner = await requireOwner(c, videoId)
  if (!owner) return c.json({ error: "Not found" }, 404)

  // Delete from R2
  await c.env.VIDEOS_BUCKET.delete(owner.video_key)
  if (owner.thumbnail_key) {
    await c.env.VIDEOS_BUCKET.delete(owner.thumbnail_key)
  }

  // Delete from D1 (cascades to view_events and comments)
  await c.env.DB.prepare("DELETE FROM videos WHERE id = ?")
    .bind(videoId)
    .run()

  return c.json({ ok: true })
})

function parseRange(
  rangeHeader: string
): { offset: number; length?: number } | undefined {
  const match = rangeHeader.match(/bytes=(\d+)-(\d*)/)
  if (!match) return undefined

  const offset = parseInt(match[1], 10)
  const end = match[2] ? parseInt(match[2], 10) : undefined

  return {
    offset,
    length: end !== undefined ? end - offset + 1 : undefined,
  }
}

export { video }

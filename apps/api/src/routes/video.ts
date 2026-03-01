import { Hono } from "hono"
import type { Env, VideoRow, VideoMetadata } from "../types"

const video = new Hono<{ Bindings: Env }>()

/**
 * GET /api/videos/:id
 * Returns video metadata for the player page.
 */
video.get("/:id", async (c) => {
  const videoId = c.req.param("id")

  const row = await c.env.DB.prepare(
    "SELECT * FROM videos WHERE id = ? AND status = 'ready'"
  )
    .bind(videoId)
    .first<VideoRow>()

  if (!row) {
    return c.json({ error: "Video not found" }, 404)
  }

  // Check expiration
  if (row.expires_at && row.expires_at < Date.now()) {
    return c.json({ error: "Video has expired" }, 410)
  }

  const metadata: VideoMetadata = {
    id: row.id,
    title: row.title,
    thumbnailUrl: row.thumbnail_key
      ? `${c.env.SHARE_BASE_URL}/api/videos/${row.id}/thumbnail`
      : null,
    videoUrl: `${c.env.SHARE_BASE_URL}/api/videos/${row.id}/stream`,
    durationMs: row.duration_ms,
    createdAt: row.created_at,
    settings: {
      allowComments: row.allow_comments === 1,
      allowDownload: row.allow_download === 1,
      showBadge: row.show_badge === 1,
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
 */
video.get("/:id/stream", async (c) => {
  const videoId = c.req.param("id")

  const row = await c.env.DB.prepare(
    "SELECT video_key FROM videos WHERE id = ? AND status = 'ready'"
  )
    .bind(videoId)
    .first<{ video_key: string }>()

  if (!row) {
    return c.json({ error: "Video not found" }, 404)
  }

  const rangeHeader = c.req.header("range")
  const object = await c.env.VIDEOS_BUCKET.get(row.video_key, {
    range: rangeHeader ? parseRange(rangeHeader) : undefined,
  })

  if (!object) {
    return c.json({ error: "Video file not found" }, 404)
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
 * Serves the thumbnail image from R2.
 */
video.get("/:id/thumbnail", async (c) => {
  const videoId = c.req.param("id")

  const row = await c.env.DB.prepare(
    "SELECT thumbnail_key FROM videos WHERE id = ? AND status = 'ready'"
  )
    .bind(videoId)
    .first<{ thumbnail_key: string | null }>()

  if (!row?.thumbnail_key) {
    return c.json({ error: "Thumbnail not found" }, 404)
  }

  const object = await c.env.VIDEOS_BUCKET.get(row.thumbnail_key)
  if (!object) {
    return c.json({ error: "Thumbnail file not found" }, 404)
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
 */
video.delete("/:id", async (c) => {
  const videoId = c.req.param("id")

  const row = await c.env.DB.prepare(
    "SELECT video_key, thumbnail_key FROM videos WHERE id = ?"
  )
    .bind(videoId)
    .first<{ video_key: string; thumbnail_key: string | null }>()

  if (!row) {
    return c.json({ error: "Video not found" }, 404)
  }

  // Delete from R2
  await c.env.VIDEOS_BUCKET.delete(row.video_key)
  if (row.thumbnail_key) {
    await c.env.VIDEOS_BUCKET.delete(row.thumbnail_key)
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

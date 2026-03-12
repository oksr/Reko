import { Hono } from "hono"
import { nanoid } from "nanoid"
import type { Env, CreateVideoRequest, CreateVideoResponse } from "../types"
import { hashToken } from "../lib/crypto"
import { requireOwner } from "../middleware/auth"

const MAX_FILE_SIZE = 100 * 1024 * 1024 // 100MB (free tier limit)

const upload = new Hono<{ Bindings: Env }>()

/**
 * POST /api/videos
 * Creates a video record and returns:
 *   - uploadUrl: presigned PUT URL to R2 (client uploads directly)
 *   - ownerToken: secret token for managing this video (returned ONCE, never stored raw)
 *
 * The ownerToken is hashed before storage. The raw token is only returned in this response.
 * The desktop app must store it securely (in the project JSON).
 */
upload.post("/", async (c) => {
  const body = await c.req.json<CreateVideoRequest>()

  // Input validation
  const MAX_TITLE_LENGTH = 200
  const ALLOWED_CONTENT_TYPES = ["video/mp4", "video/quicktime", "video/webm"]

  if (!body.title?.trim() || body.title.trim().length > MAX_TITLE_LENGTH) {
    return c.json({ error: "Title must be between 1 and 200 characters" }, 400)
  }
  if (typeof body.fileSizeBytes !== "number" || body.fileSizeBytes <= 0 || body.fileSizeBytes > MAX_FILE_SIZE) {
    return c.json({ error: "file_too_large", limit: MAX_FILE_SIZE, upgradeUrl: "https://reko.video/pro" }, 400)
  }
  if (typeof body.durationMs !== "number" || body.durationMs <= 0) {
    return c.json({ error: "Duration must be positive" }, 400)
  }
  if (!ALLOWED_CONTENT_TYPES.includes(body.contentType)) {
    return c.json({ error: `Content type must be one of: ${ALLOWED_CONTENT_TYPES.join(", ")}` }, 400)
  }

  const videoId = nanoid(12)
  const ownerToken = nanoid(32) // high-entropy secret
  const ownerTokenHash = await hashToken(ownerToken)
  const videoKey = `videos/${videoId}/video.mp4`
  const now = Date.now()
  const expiresAt = now + 7 * 24 * 60 * 60 * 1000 // 7-day expiry (free tier)

  await c.env.DB.prepare(
    `INSERT INTO videos (id, owner_token_hash, project_id, title, video_key, duration_ms, file_size_bytes, status, created_at, expires_at, allow_comments, allow_download, show_badge, password_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      videoId,
      ownerTokenHash,
      "",
      body.title,
      videoKey,
      body.durationMs,
      body.fileSizeBytes,
      now,
      expiresAt,
      body.settings.allowComments ? 1 : 0,
      body.settings.allowDownload ? 1 : 0,
      body.settings.showBadge ? 1 : 0,
      null
    )
    .run()

  const response: CreateVideoResponse = {
    videoId,
    ownerToken, // returned ONCE — client must persist this
    uploadUrl: `/api/videos/${videoId}/upload`,
    shareUrl: `${c.env.SHARE_BASE_URL}/${videoId}`,
  }

  return c.json(response, 201)
})

/**
 * PUT /api/videos/:id/upload
 * Proxy upload — streams the request body directly to R2.
 * Requires the owner token to prevent unauthorized uploads.
 */
upload.put("/:id/upload", async (c) => {
  const videoId = c.req.param("id")

  const owner = await requireOwner(c, videoId, { status: "pending" })
  if (!owner) return c.json({ error: "Not found" }, 404)

  const body = c.req.raw.body
  if (!body) {
    return c.json({ error: "No body" }, 400)
  }

  await c.env.VIDEOS_BUCKET.put(owner.video_key, body, {
    httpMetadata: {
      contentType: c.req.header("content-type") || "video/mp4",
    },
  })

  // Verify actual uploaded size against free tier limit
  const obj = await c.env.VIDEOS_BUCKET.head(owner.video_key)
  if (obj && obj.size > MAX_FILE_SIZE) {
    await c.env.VIDEOS_BUCKET.delete(owner.video_key)
    await c.env.DB.prepare("DELETE FROM videos WHERE id = ?").bind(videoId).run()
    return c.json({ error: "file_too_large", limit: MAX_FILE_SIZE, upgradeUrl: "https://reko.video/pro" }, 413)
  }

  // Update D1 with actual size (client-declared size may differ slightly)
  if (obj) {
    await c.env.DB.prepare("UPDATE videos SET file_size_bytes = ? WHERE id = ?")
      .bind(obj.size, videoId).run()
  }

  return c.json({ ok: true })
})

/**
 * POST /api/videos/:id/finalize
 * Called after upload completes. Marks the video as ready.
 * Requires owner token in Authorization header.
 */
upload.post("/:id/finalize", async (c) => {
  const videoId = c.req.param("id")

  // Verify owner token
  const owner = await requireOwner(c, videoId, { status: "pending" })
  if (!owner) return c.json({ error: "Not found" }, 404)

  // Verify the file exists in R2
  const object = await c.env.VIDEOS_BUCKET.head(owner.video_key)
  if (!object) {
    return c.json({ error: "Video file not uploaded yet" }, 400)
  }

  // Handle optional thumbnail
  let thumbnailKey: string | null = null
  const body = await c.req.json().catch(() => ({}))

  if (body.thumbnailData) {
    // Reject base64 payloads that would decode to >500KB (~700KB base64)
    if (body.thumbnailData.length > 700_000) {
      return c.json({ error: "Thumbnail too large (max ~500KB)" }, 400)
    }
    thumbnailKey = `videos/${videoId}/thumbnail.jpg`
    const thumbnailBytes = Uint8Array.from(atob(body.thumbnailData), (c) =>
      c.charCodeAt(0)
    )
    await c.env.VIDEOS_BUCKET.put(thumbnailKey, thumbnailBytes, {
      httpMetadata: { contentType: "image/jpeg" },
    })
  }

  await c.env.DB.prepare(
    "UPDATE videos SET status = 'ready', thumbnail_key = ? WHERE id = ?"
  )
    .bind(thumbnailKey, videoId)
    .run()

  return c.json({
    shareUrl: `${c.env.SHARE_BASE_URL}/${videoId}`,
    thumbnailUrl: thumbnailKey
      ? `${c.env.SHARE_BASE_URL}/api/videos/${videoId}/thumbnail`
      : null,
  })
})

export { upload }

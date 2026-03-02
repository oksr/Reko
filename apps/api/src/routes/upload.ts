import { Hono } from "hono"
import { nanoid } from "nanoid"
import type { Env, CreateVideoRequest, CreateVideoResponse } from "../types"
import { hashToken } from "../lib/crypto"

const upload = new Hono<{ Bindings: Env }>()

/**
 * POST /api/videos
 * Creates a video record and returns:
 *   - uploadUrl: presigned PUT URL to R2
 *   - ownerToken: secret token for managing this video (returned ONCE, never stored raw)
 *
 * The ownerToken is hashed before storage. The raw token is only returned in this response.
 * The desktop app must store it securely (in the project JSON).
 */
upload.post("/", async (c) => {
  const body = await c.req.json<CreateVideoRequest>()

  // Input validation
  const MAX_TITLE_LENGTH = 200
  const MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024 // 5GB
  const ALLOWED_CONTENT_TYPES = ["video/mp4", "video/quicktime", "video/webm"]

  if (!body.title?.trim() || body.title.trim().length > MAX_TITLE_LENGTH) {
    return c.json({ error: "Title must be between 1 and 200 characters" }, 400)
  }
  if (typeof body.fileSizeBytes !== "number" || body.fileSizeBytes <= 0 || body.fileSizeBytes > MAX_FILE_SIZE) {
    return c.json({ error: "File size must be between 1 byte and 5GB" }, 400)
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

  await c.env.DB.prepare(
    `INSERT INTO videos (id, owner_token_hash, project_id, title, video_key, duration_ms, file_size_bytes, status, created_at, allow_comments, allow_download, show_badge, password_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`
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
      body.settings.allowComments ? 1 : 0,
      body.settings.allowDownload ? 1 : 0,
      body.settings.showBadge ? 1 : 0,
      null
    )
    .run()

  const uploadUrl = await generatePresignedPutUrl(
    c.env.VIDEOS_BUCKET,
    videoKey,
    body.contentType,
    body.fileSizeBytes
  )

  const response: CreateVideoResponse = {
    videoId,
    ownerToken, // returned ONCE — client must persist this
    uploadUrl,
    shareUrl: `${c.env.SHARE_BASE_URL}/${videoId}`,
  }

  return c.json(response, 201)
})

/**
 * POST /api/videos/:id/finalize
 * Called after upload completes. Marks the video as ready.
 * Requires owner token in Authorization header.
 */
upload.post("/:id/finalize", async (c) => {
  const videoId = c.req.param("id")

  // Verify owner token
  const authHeader = c.req.header("authorization")
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null
  if (!token) {
    return c.json({ error: "Not found" }, 404)
  }

  const tokenHash = await hashToken(token)

  const video = await c.env.DB.prepare(
    "SELECT id, video_key, owner_token_hash FROM videos WHERE id = ? AND status = 'pending'"
  )
    .bind(videoId)
    .first<{ id: string; video_key: string; owner_token_hash: string }>()

  if (!video || video.owner_token_hash !== tokenHash) {
    return c.json({ error: "Not found" }, 404)
  }

  // Verify the file exists in R2
  const object = await c.env.VIDEOS_BUCKET.head(video.video_key)
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

async function generatePresignedPutUrl(
  _bucket: R2Bucket,
  key: string,
  _contentType: string,
  _fileSize: number
): Promise<string> {
  // In production, generate a presigned S3-compatible URL.
  // For the initial implementation, uploads go through the Worker.
  return `/api/videos/upload/${encodeURIComponent(key)}`
}

/**
 * PUT /api/videos/upload/:key
 * Proxy upload endpoint. In production, replace with presigned R2 URLs.
 */
upload.put("/upload/*", async (c) => {
  const key = c.req.path.replace("/api/videos/upload/", "")
  const decodedKey = decodeURIComponent(key)

  // Validate the key matches the expected pattern and corresponds to a pending video
  const keyMatch = decodedKey.match(/^videos\/([^/]+)\/video\.mp4$/)
  if (!keyMatch) {
    return c.json({ error: "Invalid upload key" }, 400)
  }

  const videoId = keyMatch[1]
  const video = await c.env.DB.prepare(
    "SELECT id FROM videos WHERE id = ? AND status = 'pending'"
  )
    .bind(videoId)
    .first()

  if (!video) {
    return c.json({ error: "Not found" }, 404)
  }

  const body = c.req.raw.body
  if (!body) {
    return c.json({ error: "No body" }, 400)
  }

  await c.env.VIDEOS_BUCKET.put(decodedKey, body, {
    httpMetadata: {
      contentType: c.req.header("content-type") || "video/mp4",
    },
  })

  return c.json({ ok: true })
})

export { upload }

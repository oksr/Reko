import { Hono } from "hono"
import { nanoid } from "nanoid"
import type { Env, CreateVideoRequest, CreateVideoResponse } from "../types"
import { hashToken } from "../lib/crypto"
import { generatePresignedPutUrl } from "../lib/presign"
import { requireOwner } from "../middleware/auth"

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

  const uploadUrl = await generatePresignedPutUrl({
    accountId: c.env.R2_ACCOUNT_ID,
    accessKeyId: c.env.R2_ACCESS_KEY_ID,
    secretAccessKey: c.env.R2_SECRET_ACCESS_KEY,
    bucket: "reko-videos",
    key: videoKey,
    contentType: body.contentType,
  })

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

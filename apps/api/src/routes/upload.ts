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

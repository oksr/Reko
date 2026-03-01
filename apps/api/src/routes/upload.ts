import { Hono } from "hono"
import { nanoid } from "nanoid"
import type { Env, CreateVideoRequest, CreateVideoResponse } from "../types"

const upload = new Hono<{ Bindings: Env }>()

/**
 * POST /api/videos
 * Creates a video record and returns a presigned upload URL.
 * The client uploads the file directly to R2 via the presigned URL.
 */
upload.post("/", async (c) => {
  const body = await c.req.json<CreateVideoRequest>()

  const videoId = nanoid(12)
  const videoKey = `videos/${videoId}/video.mp4`
  const now = Date.now()

  // Insert pending video record
  await c.env.DB.prepare(
    `INSERT INTO videos (id, project_id, title, video_key, duration_ms, file_size_bytes, status, created_at, allow_comments, allow_download, show_badge, password_hash)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`
  )
    .bind(
      videoId,
      "", // project_id set on finalize
      body.title,
      videoKey,
      body.durationMs,
      body.fileSizeBytes,
      now,
      body.settings.allowComments ? 1 : 0,
      body.settings.allowDownload ? 1 : 0,
      body.settings.showBadge ? 1 : 0,
      null // password_hash
    )
    .run()

  // Generate a presigned URL for direct upload to R2
  // R2 multipart upload for large files
  const uploadUrl = await generatePresignedPutUrl(
    c.env.VIDEOS_BUCKET,
    videoKey,
    body.contentType,
    body.fileSizeBytes
  )

  const response: CreateVideoResponse = {
    videoId,
    uploadUrl,
    shareUrl: `${c.env.SHARE_BASE_URL}/${videoId}`,
  }

  return c.json(response, 201)
})

/**
 * POST /api/videos/:id/finalize
 * Called after upload completes. Marks the video as ready.
 * Optionally accepts a thumbnail.
 */
upload.post("/:id/finalize", async (c) => {
  const videoId = c.req.param("id")

  // Verify the video exists and is pending
  const video = await c.env.DB.prepare(
    "SELECT id, video_key FROM videos WHERE id = ? AND status = 'pending'"
  )
    .bind(videoId)
    .first()

  if (!video) {
    return c.json({ error: "Video not found or already finalized" }, 404)
  }

  // Verify the file exists in R2
  const object = await c.env.VIDEOS_BUCKET.head(video.video_key as string)
  if (!object) {
    return c.json({ error: "Video file not uploaded yet" }, 400)
  }

  // Handle optional thumbnail upload
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

  // Mark as ready
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

/**
 * Generate a presigned PUT URL for R2.
 * R2 supports presigned URLs via the S3-compatible API.
 * In production, use the S3 client with R2 credentials.
 * For now, we use direct R2 put and return an API endpoint.
 */
async function generatePresignedPutUrl(
  _bucket: R2Bucket,
  key: string,
  _contentType: string,
  _fileSize: number
): Promise<string> {
  // In production, generate a presigned S3-compatible URL.
  // For the initial implementation, uploads go through the Worker.
  // The client will PUT to /api/videos/upload/:key
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

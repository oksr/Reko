import { Hono } from "hono"
import { nanoid } from "nanoid"
import type { Env, CommentRow, AddCommentRequest } from "../types"
import { requireOwner } from "../middleware/auth"

const comments = new Hono<{ Bindings: Env }>()

/**
 * GET /api/videos/:id/comments
 * Returns all comments for a video, ordered by creation time.
 */
comments.get("/:id/comments", async (c) => {
  const videoId = c.req.param("id")

  // Verify video exists and allows comments
  const video = await c.env.DB.prepare(
    "SELECT allow_comments FROM videos WHERE id = ? AND status = 'ready'"
  )
    .bind(videoId)
    .first<{ allow_comments: number }>()

  if (!video) {
    return c.json({ error: "Video not found" }, 404)
  }

  if (!video.allow_comments) {
    return c.json({ error: "Comments are disabled for this video" }, 403)
  }

  const { results } = await c.env.DB.prepare(
    `SELECT id, author_name, content, timestamp_ms, created_at
     FROM comments
     WHERE video_id = ?
     ORDER BY created_at ASC`
  )
    .bind(videoId)
    .all<CommentRow>()

  return c.json(
    results.map((row) => ({
      id: row.id,
      authorName: row.author_name,
      content: row.content,
      timestampMs: row.timestamp_ms,
      createdAt: row.created_at,
    }))
  )
})

/**
 * POST /api/videos/:id/comments
 * Add a comment to a video.
 */
comments.post("/:id/comments", async (c) => {
  const videoId = c.req.param("id")
  const body = await c.req.json<AddCommentRequest>()

  // Validate input
  if (!body.authorName?.trim() || !body.content?.trim()) {
    return c.json({ error: "Author name and content are required" }, 400)
  }

  if (body.content.length > 2000) {
    return c.json({ error: "Comment must be 2000 characters or less" }, 400)
  }

  // Verify video exists and allows comments
  const video = await c.env.DB.prepare(
    "SELECT allow_comments FROM videos WHERE id = ? AND status = 'ready'"
  )
    .bind(videoId)
    .first<{ allow_comments: number }>()

  if (!video) {
    return c.json({ error: "Video not found" }, 404)
  }

  if (!video.allow_comments) {
    return c.json({ error: "Comments are disabled for this video" }, 403)
  }

  const commentId = nanoid(16)
  const now = Date.now()

  await c.env.DB.prepare(
    `INSERT INTO comments (id, video_id, author_name, content, timestamp_ms, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(
      commentId,
      videoId,
      body.authorName.trim(),
      body.content.trim(),
      body.timestampMs ?? null,
      now
    )
    .run()

  return c.json(
    {
      id: commentId,
      authorName: body.authorName.trim(),
      content: body.content.trim(),
      timestampMs: body.timestampMs ?? null,
      createdAt: now,
    },
    201
  )
})

/**
 * DELETE /api/videos/:id/comments/:commentId
 * Delete a comment. Requires owner token.
 */
comments.delete("/:id/comments/:commentId", async (c) => {
  const videoId = c.req.param("id")
  const commentId = c.req.param("commentId")

  // Owner-only: verify token
  const owner = await requireOwner(c, videoId)
  if (!owner) return c.json({ error: "Not found" }, 404)

  const result = await c.env.DB.prepare(
    "DELETE FROM comments WHERE id = ? AND video_id = ?"
  )
    .bind(commentId, videoId)
    .run()

  if (!result.meta.changes) {
    return c.json({ error: "Comment not found" }, 404)
  }

  return c.json({ ok: true })
})

export { comments }

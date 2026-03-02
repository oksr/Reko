import type { Context } from "hono"
import type { Env } from "../types"
import { hashToken } from "../lib/crypto"

/**
 * Verify the owner token from the Authorization header against the stored hash.
 * Returns the video row if authorized, or sends a 404 and returns null.
 *
 * Uses constant 404 response (not 401/403) to avoid revealing whether a video exists —
 * this prevents ID enumeration by unauthenticated callers.
 */
export async function requireOwner(
  c: Context<{ Bindings: Env }>,
  videoId: string
): Promise<{ video_key: string; thumbnail_key: string | null } | null> {
  const authHeader = c.req.header("authorization")
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : null

  if (!token) {
    c.status(404)
    c.body(JSON.stringify({ error: "Not found" }))
    return null
  }

  const tokenHash = await hashToken(token)

  const row = await c.env.DB.prepare(
    "SELECT video_key, thumbnail_key, owner_token_hash FROM videos WHERE id = ?"
  )
    .bind(videoId)
    .first<{ video_key: string; thumbnail_key: string | null; owner_token_hash: string }>()

  // Constant-response: whether the video doesn't exist or the token is wrong,
  // always return 404 to prevent probing.
  if (!row || row.owner_token_hash !== tokenHash) {
    c.status(404)
    c.body(JSON.stringify({ error: "Not found" }))
    return null
  }

  return { video_key: row.video_key, thumbnail_key: row.thumbnail_key }
}

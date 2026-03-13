import type { Context, Next } from "hono"
import type { Env } from "../types"
import { hashShort } from "../lib/crypto"

/**
 * Simple in-memory rate limiter using a sliding window.
 * Scoped per IP hash + route prefix.
 *
 * Workers have per-isolate memory, so the rate limit is per-worker-instance,
 * not global. This is intentional — it prevents abuse from a single origin
 * without requiring external state (KV/Durable Objects) for an MVP.
 *
 * For production, upgrade to Cloudflare Rate Limiting rules or Durable Objects.
 */
const windows = new Map<string, { count: number; resetAt: number }>()

export function rateLimit(opts: { windowMs: number; maxRequests: number; prefix: string }) {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    const ip = c.req.header("cf-connecting-ip") || "unknown"
    const ipHash = await hashShort(ip)
    const key = `${opts.prefix}:${ipHash}`
    const now = Date.now()

    let entry = windows.get(key)
    if (!entry || entry.resetAt < now) {
      entry = { count: 0, resetAt: now + opts.windowMs }
      windows.set(key, entry)
    }

    entry.count++

    if (entry.count > opts.maxRequests) {
      return c.json(
        { error: "Too many requests. Please try again later." },
        429
      )
    }

    // Periodic cleanup to prevent memory leaks
    if (windows.size > 10_000) {
      for (const [k, v] of windows) {
        if (v.resetAt < now) windows.delete(k)
      }
    }

    await next()
  }
}

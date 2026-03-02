import { Hono } from "hono"
import type { Env } from "./types"
import { applyCors } from "./middleware/cors"
import { rateLimit } from "./middleware/rate-limit"
import { upload } from "./routes/upload"
import { video } from "./routes/video"
import { analytics } from "./routes/analytics"
import { comments } from "./routes/comments"

const app = new Hono<{ Bindings: Env }>()

// Global middleware
applyCors(app)

// Rate limiting — applied per-route-group
// Upload: 10 creates per minute (generous for legitimate use, blocks abuse)
app.use("/api/videos", rateLimit({ windowMs: 60_000, maxRequests: 10, prefix: "upload" }))
// Comments: 20 per minute per IP
app.use("/api/videos/*/comments", rateLimit({ windowMs: 60_000, maxRequests: 20, prefix: "comment" }))
// Views: 60 per minute (beacon fires frequently)
app.use("/api/videos/*/views", rateLimit({ windowMs: 60_000, maxRequests: 60, prefix: "view" }))

// Health check
app.get("/api/health", (c) => c.json({ status: "ok", timestamp: Date.now() }))

// Mount routes
app.route("/api/videos", upload)
app.route("/api/videos", video)
app.route("/api/videos", analytics)
app.route("/api/videos", comments)

// 404 fallback
app.notFound((c) => c.json({ error: "Not found" }, 404))

// Error handler
app.onError((err, c) => {
  console.error("[reko-api] Error:", err)
  return c.json({ error: "Internal server error" }, 500)
})

export default app

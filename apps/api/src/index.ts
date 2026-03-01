import { Hono } from "hono"
import type { Env } from "./types"
import { applyCors } from "./middleware/cors"
import { upload } from "./routes/upload"
import { video } from "./routes/video"
import { analytics } from "./routes/analytics"
import { comments } from "./routes/comments"

const app = new Hono<{ Bindings: Env }>()

// Global middleware
applyCors(app)

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

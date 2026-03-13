import { Hono } from "hono"
import { cors } from "hono/cors"
import type { Env } from "../types"

const ALLOWED_ORIGINS = [
  "https://share.reko.video",
  "https://reko.video",
  "https://reko-player.pages.dev",
  "tauri://localhost",
  "http://localhost:5173",  // Vite dev
  "http://localhost:1420",  // Tauri dev
]

export function applyCors(app: Hono<{ Bindings: Env }>) {
  app.use(
    "/api/*",
    cors({
      origin: (origin) => {
        if (ALLOWED_ORIGINS.includes(origin)) return origin
        return ""
      },
      allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization", "X-License-Key"],
      maxAge: 86400,
    })
  )
}

import { Hono } from "hono"
import { cors } from "hono/cors"
import type { Env } from "../types"

const PRODUCTION_ORIGINS = [
  "https://share.reko.video",
  "https://reko.video",
  "tauri://localhost",
]

const DEV_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:1420",
]

export function applyCors(app: Hono<{ Bindings: Env }>) {
  app.use(
    "/api/*",
    cors({
      origin: (origin, c) => {
        if (PRODUCTION_ORIGINS.includes(origin)) return origin
        if (c.env.ENVIRONMENT !== "production" && DEV_ORIGINS.includes(origin)) return origin
        return ""
      },
      allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization"],
      maxAge: 86400,
    })
  )
}

import { Hono } from "hono"
import { cors } from "hono/cors"
import type { Env } from "../types"

export function applyCors(app: Hono<{ Bindings: Env }>) {
  app.use(
    "/api/*",
    cors({
      origin: [
        "https://share.reko.video",
        "https://reko.video",
        "tauri://localhost", // Tauri desktop app
        "http://localhost:5173", // Vite dev
        "http://localhost:1420", // Tauri dev
      ],
      allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization"],
      maxAge: 86400,
    })
  )
}

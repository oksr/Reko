import path from "path"
import fs from "fs"
import react from "@vitejs/plugin-react"
import { defineConfig, type Plugin } from "vite"
import mime from "mime-types"
import tailwindcss from "@tailwindcss/vite"
import glsl from "vite-plugin-glsl"

function serveLocalAssets(): Plugin {
  return {
    name: "serve-local-assets",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith("/__asset__/")) return next()
        const filePath = decodeURIComponent(req.url.slice("/__asset__".length))
        if (!fs.existsSync(filePath)) {
          res.statusCode = 404
          res.end("Not found")
          return
        }
        const stat = fs.statSync(filePath)
        const contentType = mime.lookup(filePath) || "application/octet-stream"
        const range = req.headers.range
        if (range) {
          const parts = range.replace(/bytes=/, "").split("-")
          const start = parseInt(parts[0], 10)
          const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1
          res.writeHead(206, {
            "Content-Range": `bytes ${start}-${end}/${stat.size}`,
            "Accept-Ranges": "bytes",
            "Content-Length": end - start + 1,
            "Content-Type": contentType,
          })
          fs.createReadStream(filePath, { start, end }).pipe(res)
        } else {
          res.writeHead(200, {
            "Content-Length": stat.size,
            "Content-Type": contentType,
            "Accept-Ranges": "bytes",
          })
          fs.createReadStream(filePath).pipe(res)
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), glsl(), serveLocalAssets()],
  resolve: {
    alias: {
      "@app": path.resolve(__dirname, "../app/src"),
      "@": path.resolve(__dirname, "../app/src"),
    },
  },
})

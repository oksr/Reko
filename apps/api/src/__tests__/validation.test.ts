import { describe, it, expect, beforeAll, vi } from "vitest"
import { webcrypto } from "node:crypto"
import app from "../index"

// Polyfill crypto.subtle for Node
beforeAll(() => {
  if (!globalThis.crypto?.subtle) {
    // @ts-expect-error Node webcrypto compat
    globalThis.crypto = webcrypto
  }
})

// Minimal mock D1 binding
function createMockDB(opts: { firstResponses?: unknown[] } = {}) {
  const firstResponses = opts.firstResponses ? [...opts.firstResponses] : []
  return {
    prepare: vi.fn().mockReturnValue({
      bind: vi.fn().mockReturnValue({
        first: vi.fn().mockImplementation(() =>
          Promise.resolve(firstResponses.length > 0 ? firstResponses.shift() : null)
        ),
        run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
        all: vi.fn().mockResolvedValue({ results: [] }),
      }),
    }),
  }
}

function createMockR2() {
  return {
    put: vi.fn().mockResolvedValue({}),
    head: vi.fn().mockResolvedValue({ size: 1000 }),
    get: vi.fn().mockResolvedValue(null),
  }
}

function createEnv(dbOpts: { firstResponses?: unknown[] } = {}) {
  return {
    DB: createMockDB(dbOpts),
    VIDEOS_BUCKET: createMockR2(),
    SHARE_BASE_URL: "https://share.reko.app",
    R2_ACCESS_KEY_ID: "test-key-id",
    R2_SECRET_ACCESS_KEY: "test-secret-key",
    R2_ACCOUNT_ID: "test-account-id",
  }
}

function jsonRequest(path: string, body: unknown, method = "POST") {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

// Hono Workers-style: app.fetch(request, env, executionCtx)
function appFetch(req: Request, env: ReturnType<typeof createEnv>) {
  return app.fetch(req, env as any)
}

describe("POST /api/videos — input validation", () => {
  const validBody = {
    title: "My Video",
    fileSizeBytes: 1024 * 1024,
    durationMs: 5000,
    contentType: "video/mp4",
    settings: {
      allowComments: true,
      allowDownload: false,
      showBadge: true,
      passwordProtected: false,
    },
  }

  it("rejects empty title", async () => {
    const env = createEnv()
    const req = jsonRequest("/api/videos", { ...validBody, title: "" })
    const res = await appFetch(req, env)
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toMatch(/title/i)
  })

  it("rejects title over 200 characters", async () => {
    const env = createEnv()
    const req = jsonRequest("/api/videos", { ...validBody, title: "x".repeat(201) })
    const res = await appFetch(req, env)
    expect(res.status).toBe(400)
  })

  it("rejects zero fileSizeBytes", async () => {
    const env = createEnv()
    const req = jsonRequest("/api/videos", { ...validBody, fileSizeBytes: 0 })
    const res = await appFetch(req, env)
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toMatch(/file size/i)
  })

  it("rejects fileSizeBytes over 5GB", async () => {
    const env = createEnv()
    const req = jsonRequest("/api/videos", { ...validBody, fileSizeBytes: 6 * 1024 * 1024 * 1024 })
    const res = await appFetch(req, env)
    expect(res.status).toBe(400)
  })

  it("rejects zero durationMs", async () => {
    const env = createEnv()
    const req = jsonRequest("/api/videos", { ...validBody, durationMs: 0 })
    const res = await appFetch(req, env)
    expect(res.status).toBe(400)
  })

  it("rejects invalid contentType", async () => {
    const env = createEnv()
    const req = jsonRequest("/api/videos", { ...validBody, contentType: "application/pdf" })
    const res = await appFetch(req, env)
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toMatch(/content type/i)
  })

  it("accepts valid input", async () => {
    const env = createEnv()
    const req = jsonRequest("/api/videos", validBody)
    const res = await appFetch(req, env)
    expect(res.status).toBe(201)
    const data = await res.json()
    expect(data.videoId).toBeTruthy()
    expect(data.ownerToken).toBeTruthy()
    expect(data.uploadUrl).toBeTruthy()
  })
})

describe("POST /api/videos/:id/views — input validation", () => {
  it("rejects negative watchTimeMs", async () => {
    const env = createEnv()
    const req = jsonRequest("/api/videos/vid1/views", {
      watchTimeMs: -100,
      completionPercent: 50,
    })
    const res = await appFetch(req, env)
    expect(res.status).toBe(400)
  })

  it("rejects completionPercent over 100", async () => {
    const env = createEnv()
    const req = jsonRequest("/api/videos/vid1/views", {
      watchTimeMs: 5000,
      completionPercent: 150,
    })
    const res = await appFetch(req, env)
    expect(res.status).toBe(400)
  })

  it("returns 404 for non-existent video", async () => {
    const env = createEnv({ firstResponses: [null] })
    const req = jsonRequest("/api/videos/nonexistent/views", {
      watchTimeMs: 5000,
      completionPercent: 50,
    })
    const res = await appFetch(req, env)
    expect(res.status).toBe(404)
  })

  it("accepts valid view event", async () => {
    // first() is called twice: once for video lookup, once for existingViewer check
    const env = createEnv({ firstResponses: [{ duration_ms: 10000 }, null] })
    const req = jsonRequest("/api/videos/vid1/views", {
      watchTimeMs: 5000,
      completionPercent: 50,
    })
    const res = await appFetch(req, env)
    expect(res.status).toBe(200)
  })
})

describe("DELETE /api/videos/:id/comments/:commentId — requires auth", () => {
  it("returns 404 without auth token", async () => {
    const env = createEnv()
    const req = new Request("http://localhost/api/videos/vid1/comments/c1", {
      method: "DELETE",
    })
    const res = await appFetch(req, env)
    expect(res.status).toBe(404)
  })
})

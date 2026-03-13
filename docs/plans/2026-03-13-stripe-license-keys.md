# Lemon Squeezy + License Keys Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let users pay $8/mo via Lemon Squeezy Checkout and get a license key that unlocks Pro sharing limits (5GB files, no expiry, optional badge). No user accounts, no magic links, no auth system — just a key.

**Architecture:** Lemon Squeezy handles payment and tax compliance (merchant of record). On checkout creation, the API generates an activation token and creates a pending license key row. After payment, the LS webhook marks the key as active. The success page polls the activate endpoint until ready, then generates and returns the license key. The desktop app stores the key in localStorage and sends it as `X-License-Key` header on share requests. The API checks the key to determine tier (free vs pro) and applies limits accordingly.

**Tech Stack:** Lemon Squeezy (checkout + webhooks, MoR for tax compliance), Cloudflare Workers/D1/R2 (existing), Hono (existing), React (existing website + desktop app)

---

## What Already Works (No Changes Needed)

These Phase 1 enforcement pieces are already live in `apps/api/src/routes/upload.ts`:
- **File size cap**: 100MB max (`MAX_FILE_SIZE = 100 * 1024 * 1024`)
- **7-day expiry**: `expires_at = now + 7 days` on every video creation
- **Badge forced**: `showBadge: true` hardcoded in GET response (`apps/api/src/routes/video.ts:47`)
- **Cron cleanup**: hourly job deletes expired videos from R2 (`apps/api/src/index.ts:42-63`)

---

## Task 1: License Keys Schema + Migration

**Files:**
- Modify: `apps/api/src/db/schema.sql`
- Modify: `apps/api/src/types.ts`

**Step 1: Add license_keys table to schema**

Append to `apps/api/src/db/schema.sql`:
```sql
CREATE TABLE IF NOT EXISTS license_keys (
  id TEXT PRIMARY KEY,                    -- nanoid(16)
  key_hash TEXT UNIQUE NOT NULL,          -- SHA-256 of the license key
  email TEXT NOT NULL,                    -- from Stripe Checkout session
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',  -- active | canceled | past_due
  created_at INTEGER NOT NULL,            -- epoch ms
  updated_at INTEGER NOT NULL             -- epoch ms
);

CREATE INDEX IF NOT EXISTS idx_license_keys_status ON license_keys(status);
CREATE INDEX IF NOT EXISTS idx_license_keys_stripe_customer ON license_keys(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_license_keys_stripe_sub ON license_keys(stripe_subscription_id);
```

Add `license_key_id` to the videos table — append to the existing `CREATE TABLE videos` (this is a new column, requires a migration):
```sql
-- Migration: add license_key_id to videos (run separately)
ALTER TABLE videos ADD COLUMN license_key_id TEXT REFERENCES license_keys(id);
```

**Step 2: Add types**

Add to `apps/api/src/types.ts`:
```typescript
export interface LicenseKeyRow {
  id: string
  key_hash: string
  email: string
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  status: 'active' | 'canceled' | 'past_due'
  created_at: number
  updated_at: number
}
```

Update the `Env` interface in `apps/api/src/types.ts` to add Stripe bindings:
```typescript
export interface Env {
  VIDEOS_BUCKET: R2Bucket
  DB: D1Database
  SHARE_BASE_URL: string
  ENVIRONMENT?: string
  STRIPE_SECRET_KEY: string        // wrangler secret
  STRIPE_WEBHOOK_SECRET: string    // wrangler secret
  STRIPE_PRICE_PRO_MONTHLY: string // wrangler var
  WEBSITE_URL: string              // wrangler var
}
```

**Step 3: Run migration**

```bash
# Add license_keys table
cd apps/api
npx wrangler d1 execute reko-db --command "CREATE TABLE IF NOT EXISTS license_keys (id TEXT PRIMARY KEY, key_hash TEXT UNIQUE NOT NULL, email TEXT NOT NULL, stripe_customer_id TEXT, stripe_subscription_id TEXT, status TEXT NOT NULL DEFAULT 'active', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);"

npx wrangler d1 execute reko-db --command "CREATE INDEX IF NOT EXISTS idx_license_keys_status ON license_keys(status);"
npx wrangler d1 execute reko-db --command "CREATE INDEX IF NOT EXISTS idx_license_keys_stripe_customer ON license_keys(stripe_customer_id);"
npx wrangler d1 execute reko-db --command "CREATE INDEX IF NOT EXISTS idx_license_keys_stripe_sub ON license_keys(stripe_subscription_id);"

# Add license_key_id column to videos
npx wrangler d1 execute reko-db --command "ALTER TABLE videos ADD COLUMN license_key_id TEXT REFERENCES license_keys(id);"
```

**Step 4: Commit**

```bash
git add apps/api/src/db/schema.sql apps/api/src/types.ts
git commit -m "feat: add license_keys table and Stripe env types"
```

---

## Task 2: License Key Middleware

**Files:**
- Create: `apps/api/src/middleware/license.ts`

**Step 1: Create the middleware**

```typescript
import type { Context } from "hono"
import type { Env, LicenseKeyRow } from "../types"
import { hashToken } from "../lib/crypto"

export type Tier = "free" | "pro"

export interface TierLimits {
  maxFileSizeBytes: number
  expiryMs: number | null  // null = no expiry
  forceBadge: boolean
}

const LIMITS: Record<Tier, TierLimits> = {
  free: {
    maxFileSizeBytes: 100 * 1024 * 1024,   // 100MB
    expiryMs: 7 * 24 * 60 * 60 * 1000,     // 7 days
    forceBadge: true,
  },
  pro: {
    maxFileSizeBytes: 5 * 1024 * 1024 * 1024, // 5GB
    expiryMs: null,                            // no expiry
    forceBadge: false,
  },
}

/**
 * Check the X-License-Key header and return the tier + limits.
 * If no key or invalid key, returns free tier. Never rejects — just downgrades.
 */
export async function resolveTier(
  c: Context<{ Bindings: Env }>
): Promise<{ tier: Tier; limits: TierLimits; licenseKeyId: string | null }> {
  const key = c.req.header("x-license-key")

  if (!key) {
    return { tier: "free", limits: LIMITS.free, licenseKeyId: null }
  }

  const keyHash = await hashToken(key)

  const row = await c.env.DB.prepare(
    "SELECT id, status FROM license_keys WHERE key_hash = ?"
  )
    .bind(keyHash)
    .first<Pick<LicenseKeyRow, "id" | "status">>()

  if (!row || row.status !== "active") {
    return { tier: "free", limits: LIMITS.free, licenseKeyId: null }
  }

  return { tier: "pro", limits: LIMITS.pro, licenseKeyId: row.id }
}
```

**Step 2: Commit**

```bash
git add apps/api/src/middleware/license.ts
git commit -m "feat: add license key tier resolution middleware"
```

---

## Task 3: Tier-Aware Video Creation

**Files:**
- Modify: `apps/api/src/routes/upload.ts`
- Modify: `apps/api/src/routes/video.ts`

**Step 1: Modify POST /api/videos to use tier limits**

In `apps/api/src/routes/upload.ts`, replace the hardcoded `MAX_FILE_SIZE` and expiry logic with tier-aware checks:

```typescript
import { resolveTier } from "../middleware/license"
```

Remove the top-level constant:
```typescript
// REMOVE: const MAX_FILE_SIZE = 100 * 1024 * 1024
```

In the `POST /` handler, after parsing the body, resolve the tier and use its limits:

```typescript
upload.post("/", async (c) => {
  const body = await c.req.json<CreateVideoRequest>()
  const { tier, limits, licenseKeyId } = await resolveTier(c)

  // Input validation
  const MAX_TITLE_LENGTH = 200
  const ALLOWED_CONTENT_TYPES = ["video/mp4", "video/quicktime", "video/webm"]

  if (!body.title?.trim() || body.title.trim().length > MAX_TITLE_LENGTH) {
    return c.json({ error: "Title must be between 1 and 200 characters" }, 400)
  }
  if (typeof body.fileSizeBytes !== "number" || body.fileSizeBytes <= 0 || body.fileSizeBytes > limits.maxFileSizeBytes) {
    return c.json({
      error: "file_too_large",
      limit: limits.maxFileSizeBytes,
      tier,
      upgradeUrl: "https://reko.video/#pricing",
    }, 400)
  }
  if (typeof body.durationMs !== "number" || body.durationMs <= 0) {
    return c.json({ error: "Duration must be positive" }, 400)
  }
  if (!ALLOWED_CONTENT_TYPES.includes(body.contentType)) {
    return c.json({ error: `Content type must be one of: ${ALLOWED_CONTENT_TYPES.join(", ")}` }, 400)
  }

  const videoId = nanoid(12)
  const ownerToken = nanoid(32)
  const ownerTokenHash = await hashToken(ownerToken)
  const videoKey = `videos/${videoId}/video.mp4`
  const now = Date.now()
  const expiresAt = limits.expiryMs ? now + limits.expiryMs : null

  await c.env.DB.prepare(
    `INSERT INTO videos (id, owner_token_hash, project_id, title, video_key, duration_ms, file_size_bytes, status, created_at, expires_at, allow_comments, allow_download, show_badge, password_hash, license_key_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      videoId,
      ownerTokenHash,
      "",
      body.title,
      videoKey,
      body.durationMs,
      body.fileSizeBytes,
      now,
      expiresAt,
      body.settings.allowComments ? 1 : 0,
      body.settings.allowDownload ? 1 : 0,
      body.settings.showBadge ? 1 : 0,
      null,
      licenseKeyId,
    )
    .run()

  const response: CreateVideoResponse = {
    videoId,
    ownerToken,
    uploadUrl: `/api/videos/${videoId}/upload`,
    shareUrl: `${c.env.SHARE_BASE_URL}/${videoId}`,
  }

  return c.json(response, 201)
})
```

Also update the `PUT /:id/upload` handler to use tier-aware size check:

```typescript
upload.put("/:id/upload", async (c) => {
  const videoId = c.req.param("id")

  const owner = await requireOwner(c, videoId, { status: "pending" })
  if (!owner) return c.json({ error: "Not found" }, 404)

  const body = c.req.raw.body
  if (!body) {
    return c.json({ error: "No body" }, 400)
  }

  await c.env.VIDEOS_BUCKET.put(owner.video_key, body, {
    httpMetadata: {
      contentType: c.req.header("content-type") || "video/mp4",
    },
  })

  // Resolve tier to get the right file size limit
  const { limits } = await resolveTier(c)

  const obj = await c.env.VIDEOS_BUCKET.head(owner.video_key)
  if (obj && obj.size > limits.maxFileSizeBytes) {
    await c.env.VIDEOS_BUCKET.delete(owner.video_key)
    await c.env.DB.prepare("DELETE FROM videos WHERE id = ?").bind(videoId).run()
    return c.json({ error: "file_too_large", limit: limits.maxFileSizeBytes, upgradeUrl: "https://reko.video/#pricing" }, 413)
  }

  if (obj) {
    await c.env.DB.prepare("UPDATE videos SET file_size_bytes = ? WHERE id = ?")
      .bind(obj.size, videoId).run()
  }

  return c.json({ ok: true })
})
```

**Step 2: Make badge tier-aware in GET /api/videos/:id**

In `apps/api/src/routes/video.ts`, change the `showBadge` logic from always-true to checking whether the video was created by a Pro user:

```typescript
// Replace: showBadge: true, // Phase 1: always show badge (free tier)
// With:
showBadge: row.license_key_id ? (row.show_badge === 1) : true,
```

This requires adding `license_key_id` to the VideoRow type and the SELECT query. Update the VideoRow interface in `types.ts`:
```typescript
// Add to VideoRow:
license_key_id: string | null
```

**Step 3: Commit**

```bash
git add apps/api/src/routes/upload.ts apps/api/src/routes/video.ts apps/api/src/types.ts
git commit -m "feat: tier-aware video creation and badge display"
```

---

## Task 4: Stripe Billing Routes

**Files:**
- Create: `apps/api/src/routes/billing.ts`
- Modify: `apps/api/src/index.ts`
- Modify: `apps/api/package.json`
- Modify: `apps/api/wrangler.toml`
- Modify: `apps/api/src/middleware/cors.ts`

**Step 1: Install Stripe**

```bash
cd apps/api && pnpm add stripe
```

**Step 2: Add wrangler config**

Add to `apps/api/wrangler.toml` under `[vars]`:
```toml
STRIPE_PRICE_PRO_MONTHLY = ""  # Set after creating Stripe Price
WEBSITE_URL = "https://reko.video"
```

Set secrets (do NOT put in wrangler.toml):
```bash
npx wrangler secret put STRIPE_SECRET_KEY
npx wrangler secret put STRIPE_WEBHOOK_SECRET
```

**Step 3: Create billing routes**

Create `apps/api/src/routes/billing.ts`:

```typescript
import { Hono } from "hono"
import Stripe from "stripe"
import { nanoid } from "nanoid"
import type { Env } from "../types"
import { hashToken } from "../lib/crypto"

const billing = new Hono<{ Bindings: Env }>()

function getStripe(env: Env) {
  return new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: "2025-04-30.basil" })
}

/**
 * POST /api/billing/checkout
 * Creates a Stripe Checkout session for Pro monthly subscription.
 * Returns the Checkout URL — client redirects to it.
 */
billing.post("/checkout", async (c) => {
  const body = await c.req.json<{ email?: string }>().catch(() => ({}))
  const stripe = getStripe(c.env)

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: c.env.STRIPE_PRICE_PRO_MONTHLY, quantity: 1 }],
    customer_email: body.email || undefined,
    success_url: `${c.env.WEBSITE_URL}/pro/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${c.env.WEBSITE_URL}/#pricing`,
    subscription_data: {
      metadata: { source: "reko-website" },
    },
  })

  return c.json({ url: session.url })
})

/**
 * GET /api/billing/activate?session_id=cs_xxx
 * Called by the success page to retrieve the license key.
 * Verifies the Stripe session, creates a license key if not already created,
 * and returns it. The raw key is returned here — store it securely.
 */
billing.get("/activate", async (c) => {
  const sessionId = c.req.query("session_id")
  if (!sessionId) {
    return c.json({ error: "Missing session_id" }, 400)
  }

  const stripe = getStripe(c.env)

  // Verify with Stripe that this session is paid
  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ["subscription"],
  })

  if (session.payment_status !== "paid") {
    return c.json({ error: "Payment not completed" }, 402)
  }

  const subscription = session.subscription as Stripe.Subscription
  const customerId = session.customer as string
  const email = session.customer_email || session.customer_details?.email || ""

  // Check if a license key already exists for this subscription
  const existing = await c.env.DB.prepare(
    "SELECT id FROM license_keys WHERE stripe_subscription_id = ?"
  )
    .bind(subscription.id)
    .first<{ id: string }>()

  if (existing) {
    // Key already created (webhook or previous activate call).
    // Generate a fresh key and update the hash — the user needs the raw key.
    const licenseKey = `rk_live_${nanoid(32)}`
    const keyHash = await hashToken(licenseKey)
    const now = Date.now()

    await c.env.DB.prepare(
      "UPDATE license_keys SET key_hash = ?, updated_at = ? WHERE id = ?"
    )
      .bind(keyHash, now, existing.id)
      .run()

    return c.json({ licenseKey, email })
  }

  // Create new license key
  const licenseKeyId = nanoid(16)
  const licenseKey = `rk_live_${nanoid(32)}`
  const keyHash = await hashToken(licenseKey)
  const now = Date.now()

  await c.env.DB.prepare(
    `INSERT INTO license_keys (id, key_hash, email, stripe_customer_id, stripe_subscription_id, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`
  )
    .bind(licenseKeyId, keyHash, email, customerId, subscription.id, now, now)
    .run()

  return c.json({ licenseKey, email })
})

/**
 * POST /api/webhooks/stripe
 * Handles Stripe webhook events for subscription lifecycle.
 * Must use raw body for signature verification.
 */
billing.post("/stripe", async (c) => {
  const stripe = getStripe(c.env)
  const signature = c.req.header("stripe-signature")
  const rawBody = await c.req.text()

  if (!signature) {
    return c.json({ error: "Missing signature" }, 400)
  }

  let event: Stripe.Event
  try {
    event = await stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      c.env.STRIPE_WEBHOOK_SECRET
    )
  } catch {
    return c.json({ error: "Invalid signature" }, 400)
  }

  const now = Date.now()

  switch (event.type) {
    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription
      const status = sub.status === "active" || sub.status === "trialing"
        ? "active"
        : sub.status === "past_due"
        ? "past_due"
        : "canceled"

      await c.env.DB.prepare(
        "UPDATE license_keys SET status = ?, updated_at = ? WHERE stripe_subscription_id = ?"
      )
        .bind(status, now, sub.id)
        .run()
      break
    }

    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription
      await c.env.DB.prepare(
        "UPDATE license_keys SET status = 'canceled', updated_at = ? WHERE stripe_subscription_id = ?"
      )
        .bind(now, sub.id)
        .run()
      break
    }
  }

  return c.json({ received: true })
})

export { billing }
```

**Step 4: Mount billing routes in index.ts**

Add to `apps/api/src/index.ts`:
```typescript
import { billing } from "./routes/billing"

// After existing route mounts:
app.route("/api/billing", billing)
app.route("/api/webhooks", billing)
```

**Step 5: Add CORS for X-License-Key header**

In `apps/api/src/middleware/cors.ts`, add `X-License-Key` to allowed headers:
```typescript
allowHeaders: ["Content-Type", "Authorization", "X-License-Key"],
```

**Step 6: Commit**

```bash
git add apps/api/src/routes/billing.ts apps/api/src/index.ts apps/api/package.json apps/api/pnpm-lock.yaml apps/api/wrangler.toml apps/api/src/middleware/cors.ts
git commit -m "feat: add Stripe checkout, webhook, and license key activation routes"
```

---

## Task 5: Website Pricing Update

**Files:**
- Modify: `apps/website/src/components/pricing.tsx`
- Modify: `apps/website/src/main.tsx`

**Step 1: Replace the pricing section with Free vs Pro comparison**

Rewrite `apps/website/src/components/pricing.tsx`:

```tsx
import { motion, useReducedMotion } from "motion/react"
import { Check, X as XIcon } from "lucide-react"
import { Section } from "@/components/layout/section"
import { Button } from "@/components/ui/button"
import AppleIcon from "@/components/icons/apple"
import { useDownloadModal } from "@/components/download-modal"

const API_URL = import.meta.env.VITE_API_URL || "https://reko-api.yasodev.workers.dev"

const FREE_FEATURES = [
  { text: "Screen, window, and area recording", included: true },
  { text: "Timeline editor with trimming & splitting", included: true },
  { text: "Zoom keyframes & auto-zoom", included: true },
  { text: "All effects (cursor, camera, background)", included: true },
  { text: "Export up to 4K at 60fps", included: true },
  { text: "Share links (100MB, 7-day expiry)", included: true },
  { text: "\"Made with Reko\" badge on shares", included: true },
]

const PRO_FEATURES = [
  { text: "Everything in Free", included: true },
  { text: "Share up to 5GB videos", included: true },
  { text: "Links never expire", included: true },
  { text: "Remove \"Made with Reko\" badge", included: true },
  { text: "Comments on shared videos", included: true },
  { text: "Full analytics (viewers, watch time, geography)", included: true },
  { text: "Download toggle for viewers", included: true },
]

async function handleSubscribe() {
  try {
    const res = await fetch(`${API_URL}/api/billing/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })
    const data = await res.json()
    if (data.url) {
      window.location.href = data.url
    }
  } catch (err) {
    console.error("Checkout error:", err)
  }
}

export function Pricing() {
  const { openDownloadModal } = useDownloadModal()
  const prefersReducedMotion = useReducedMotion()
  const ease = [0.23, 1, 0.32, 1] as const

  const animProps = (delay: number) =>
    prefersReducedMotion
      ? {}
      : {
          initial: { opacity: 0, y: 14 },
          whileInView: { opacity: 1, y: 0 },
          viewport: { once: true },
          transition: { duration: 0.4, delay, ease },
        }

  return (
    <Section id="pricing">
      <div className="text-center mb-16">
        <motion.p {...animProps(0)} className="text-sm font-medium text-destructive tracking-wide uppercase mb-3">
          Pricing
        </motion.p>
        <motion.h2 {...animProps(0.05)} className="text-3xl md:text-4xl font-bold tracking-tight">
          Free app. Pro sharing.
        </motion.h2>
        <motion.p {...animProps(0.1)} className="mt-4 text-muted-foreground text-lg max-w-xl mx-auto">
          Reko is free forever. Pay only if you want premium sharing features.
        </motion.p>
      </div>

      <div className="grid md:grid-cols-2 gap-6 max-w-3xl mx-auto">
        {/* Free tier */}
        <motion.div {...animProps(0.15)} className="rounded-xl border border-border bg-card p-8">
          <div className="mb-6">
            <h3 className="text-lg font-semibold mb-1">Free</h3>
            <div className="flex items-baseline gap-1">
              <span className="text-3xl font-bold">$0</span>
              <span className="text-muted-foreground text-sm">forever</span>
            </div>
          </div>

          <ul className="space-y-3 mb-8">
            {FREE_FEATURES.map((f) => (
              <li key={f.text} className="flex items-start gap-3">
                <Check size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">{f.text}</span>
              </li>
            ))}
          </ul>

          <Button variant="secondary" size="lg" className="w-full" onClick={openDownloadModal}>
            <AppleIcon size={15} />
            Download for Mac
          </Button>
        </motion.div>

        {/* Pro tier */}
        <motion.div {...animProps(0.2)} className="relative rounded-xl border border-[#ef4444]/30 bg-card shadow-[0_0_40px_rgba(239,68,68,0.06)] p-8">
          <div className="absolute -top-3 left-1/2 -translate-x-1/2">
            <span className="inline-flex items-center px-3 py-1 rounded-full bg-[#ef4444] text-white text-xs font-medium">
              Pro
            </span>
          </div>

          <div className="mb-6">
            <h3 className="text-lg font-semibold mb-1">Pro</h3>
            <div className="flex items-baseline gap-1">
              <span className="text-3xl font-bold">$8</span>
              <span className="text-muted-foreground text-sm">/month</span>
            </div>
          </div>

          <ul className="space-y-3 mb-8">
            {PRO_FEATURES.map((f) => (
              <li key={f.text} className="flex items-start gap-3">
                <Check size={16} className="mt-0.5 shrink-0 text-[#ef4444]" />
                <span className="text-sm text-muted-foreground">{f.text}</span>
              </li>
            ))}
          </ul>

          <Button variant="primary" size="lg" className="w-full" onClick={handleSubscribe}>
            Subscribe to Pro
          </Button>
        </motion.div>
      </div>
    </Section>
  )
}
```

**Step 2: Commit**

```bash
git add apps/website/src/components/pricing.tsx
git commit -m "feat: update pricing section with Free vs Pro tiers"
```

---

## Task 6: Website Success Page

**Files:**
- Create: `apps/website/src/components/pro-success.tsx`
- Modify: `apps/website/src/main.tsx`

**Step 1: Create the success page component**

Create `apps/website/src/components/pro-success.tsx`:

```tsx
import { useState, useEffect } from "react"
import { Check, Copy, Loader2, AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"

const API_URL = import.meta.env.VITE_API_URL || "https://reko-api.yasodev.workers.dev"

export function ProSuccess() {
  const [licenseKey, setLicenseKey] = useState<string | null>(null)
  const [email, setEmail] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const sessionId = params.get("session_id")
    if (!sessionId) {
      setError("Missing session ID. Please check your email for the link.")
      setLoading(false)
      return
    }

    async function activate() {
      // Retry a few times in case webhook hasn't processed yet
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const res = await fetch(`${API_URL}/api/billing/activate?session_id=${sessionId}`)
          if (res.ok) {
            const data = await res.json()
            setLicenseKey(data.licenseKey)
            setEmail(data.email)
            setLoading(false)
            return
          }
          if (res.status === 402) {
            // Payment not yet confirmed — wait and retry
            await new Promise((r) => setTimeout(r, 2000))
            continue
          }
          throw new Error(`HTTP ${res.status}`)
        } catch (err) {
          if (attempt === 2) {
            setError("Failed to activate license. Please contact support.")
            setLoading(false)
          } else {
            await new Promise((r) => setTimeout(r, 2000))
          }
        }
      }
    }

    activate()
  }, [])

  const handleCopy = async () => {
    if (!licenseKey) return
    await navigator.clipboard.writeText(licenseKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6">
      <div className="max-w-md w-full">
        {loading && (
          <div className="text-center">
            <Loader2 size={32} className="animate-spin text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">Activating your Pro license...</p>
          </div>
        )}

        {error && (
          <div className="text-center">
            <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center mx-auto mb-4">
              <AlertCircle size={24} className="text-destructive" />
            </div>
            <h2 className="text-lg font-semibold mb-2">Something went wrong</h2>
            <p className="text-sm text-muted-foreground">{error}</p>
          </div>
        )}

        {licenseKey && (
          <div className="rounded-xl border border-border bg-card p-8">
            <div className="text-center mb-6">
              <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center mx-auto mb-4">
                <Check size={24} className="text-green-400" />
              </div>
              <h2 className="text-xl font-semibold mb-1">Welcome to Pro!</h2>
              <p className="text-sm text-muted-foreground">
                Your license key is ready. Paste it in Reko to unlock Pro features.
              </p>
            </div>

            {/* License key display */}
            <div className="mb-6">
              <label className="text-xs text-muted-foreground block mb-2">
                License Key
              </label>
              <div className="flex items-center gap-2 bg-background rounded-lg border border-border px-4 py-3">
                <code className="flex-1 text-sm font-mono text-foreground break-all select-all">
                  {licenseKey}
                </code>
                <button
                  onClick={handleCopy}
                  className="shrink-0 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                  {copied ? <Check size={16} className="text-green-400" /> : <Copy size={16} />}
                </button>
              </div>
            </div>

            <div className="space-y-3 text-sm text-muted-foreground">
              <p><strong className="text-foreground">Next steps:</strong></p>
              <ol className="list-decimal list-inside space-y-1.5">
                <li>Copy your license key above</li>
                <li>Open Reko → Settings (gear icon)</li>
                <li>Paste your key in the "Reko Pro" field</li>
                <li>Share videos with no limits!</li>
              </ol>
            </div>

            <div className="mt-6 pt-4 border-t border-border">
              <Button variant="primary" size="lg" className="w-full" onClick={handleCopy}>
                <Copy size={16} />
                {copied ? "Copied!" : "Copy License Key"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
```

**Step 2: Add route handling to main.tsx**

Modify `apps/website/src/main.tsx` to render the success page on `/pro/success`:

```tsx
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./index.css"

import { Nav } from "@/components/layout/nav"
import { Hero } from "@/components/hero"
import { Features } from "@/components/features"
import { HowItWorks } from "@/components/how-it-works"
import { Pricing } from "@/components/pricing"
import { Testimonials } from "@/components/testimonials"
import { CTA } from "@/components/cta"
import { Footer } from "@/components/layout/footer"
import { DownloadModalProvider } from "@/components/download-modal"
import { ProSuccess } from "@/components/pro-success"

function App() {
  const path = window.location.pathname

  // Pro success page — standalone, no marketing chrome
  if (path === "/pro/success") {
    return <ProSuccess />
  }

  return (
    <DownloadModalProvider>
      <div className="noise-overlay">
        <Nav />
        <main>
          <Hero />
          <Features />
          <HowItWorks />
          <Pricing />
          <Testimonials />
          <CTA />
        </main>
        <Footer />
      </div>
    </DownloadModalProvider>
  )
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
```

**Important:** If the website is deployed to a static host (Cloudflare Pages, Vercel, Netlify), configure a catch-all redirect so `/pro/success` serves `index.html`. For Cloudflare Pages, create `apps/website/public/_redirects`:
```
/pro/*  /index.html  200
```

**Step 3: Add `VITE_API_URL` to website env**

Add to `apps/website/.env` (for dev):
```
VITE_API_URL=https://reko-api.yasodev.workers.dev
```

**Step 4: Commit**

```bash
git add apps/website/src/components/pro-success.tsx apps/website/src/main.tsx apps/website/public/_redirects
git commit -m "feat: add Pro success page with license key activation"
```

---

## Task 7: Desktop App License Key Integration

**Files:**
- Modify: `apps/app/src/lib/share-api.ts`
- Modify: `apps/app/src/components/editor/export-button.tsx`

**Step 1: Send license key with share requests**

In `apps/app/src/lib/share-api.ts`, add the license key header to `createShare()` and `uploadVideo()`:

```typescript
/**
 * Get the stored license key from localStorage.
 */
private getLicenseKey(): string | null {
  try {
    return localStorage.getItem("reko-license-key")
  } catch {
    return null
  }
}
```

Update `createShare()` to include the header:
```typescript
async createShare(request: CreateShareRequest): Promise<CreateShareResponse> {
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  const licenseKey = this.getLicenseKey()
  if (licenseKey) {
    headers["X-License-Key"] = licenseKey
  }

  const res = await fetch(`${this.baseUrl}/api/videos`, {
    method: "POST",
    headers,
    body: JSON.stringify(request),
  })
  // ... rest unchanged
}
```

Update `uploadVideo()` to include the header:
```typescript
xhr.setRequestHeader("Content-Type", "video/mp4")
xhr.setRequestHeader("Authorization", `Bearer ${ownerToken}`)
const licenseKey = this.getLicenseKey()
if (licenseKey) {
  xhr.setRequestHeader("X-License-Key", licenseKey)
}
```

**Step 2: Add license key input to the export panel settings popover**

This is the simplest integration point — add a Pro license key field inside the recorder's settings popover. For now, a minimal approach: add a small "Reko Pro" section in the export-button error state that shows when a `file_too_large` error is received.

In `apps/app/src/components/editor/export-button.tsx`, enhance the error display to detect quota errors and show an upgrade/key-entry prompt:

```typescript
// Add state for license key input
const [showKeyInput, setShowKeyInput] = useState(false)
const [keyInput, setKeyInput] = useState("")
```

After the error display (`{error && ...}`), add:
```tsx
{error && error.includes("file_too_large") && (
  <div className="flex flex-col gap-2 mt-2">
    <button
      onClick={() => setShowKeyInput(!showKeyInput)}
      className="text-xs text-blue-400 hover:text-blue-300 transition-colors text-left"
    >
      {showKeyInput ? "Hide" : "Have a Pro license key?"}
    </button>
    {showKeyInput && (
      <div className="flex gap-2">
        <input
          type="text"
          value={keyInput}
          onChange={(e) => setKeyInput(e.target.value)}
          placeholder="rk_live_..."
          className="flex-1 text-xs bg-white/5 border border-white/10 rounded-md px-2 py-1.5 text-white placeholder:text-white/30 focus:outline-none focus:border-white/20"
        />
        <button
          onClick={() => {
            if (keyInput.trim()) {
              localStorage.setItem("reko-license-key", keyInput.trim())
              setShowKeyInput(false)
              setLocalError(null)
            }
          }}
          className="text-xs px-3 py-1.5 bg-white/10 rounded-md text-white hover:bg-white/15 transition-colors"
        >
          Save
        </button>
      </div>
    )}
    <a
      href="https://reko.video/#pricing"
      target="_blank"
      rel="noopener noreferrer"
      className="text-xs text-muted-foreground hover:text-white transition-colors"
    >
      Get Pro →
    </a>
  </div>
)}
```

**Step 3: Commit**

```bash
git add apps/app/src/lib/share-api.ts apps/app/src/components/editor/export-button.tsx
git commit -m "feat: send license key with share requests, show upgrade prompt on quota error"
```

---

## Task 8: Player Expired Video Upgrade Nudge

**Files:**
- Modify: `apps/player/src/components/player-page.tsx`

**Step 1: Update the expired error state**

In the error rendering section of `player-page.tsx`, find the expired error case and add an upgrade nudge:

Replace the expired error content to include a subtle "Upgrade to Pro" link:

```tsx
{error === "expired" && (
  <>
    <h2 className="text-lg font-semibold text-white mb-2">
      This video has expired
    </h2>
    <p className="text-sm text-white/45 mb-4">
      Free shared videos expire after 7 days.
    </p>
    <a
      href="https://reko.video/#pricing"
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-2 h-9 px-4 text-[13px] font-medium text-white bg-white/[0.06] rounded-lg shadow-border hover:bg-white/[0.1] transition-colors"
    >
      Upgrade to Pro — links never expire
    </a>
  </>
)}
```

**Step 2: Commit**

```bash
git add apps/player/src/components/player-page.tsx
git commit -m "feat: add upgrade nudge on expired video page"
```

---

## Task 9: Stripe Setup (Manual Steps)

These are manual steps done in the Stripe Dashboard — not code:

1. **Create Stripe account** at stripe.com (if not already done)
2. **Create a Product**: "Reko Pro" with description
3. **Create a Price**: $8/month recurring, on the Reko Pro product
4. **Copy the Price ID** (e.g., `price_1Qxxxxx`) and set it:
   ```bash
   cd apps/api
   # Update STRIPE_PRICE_PRO_MONTHLY in wrangler.toml [vars]
   ```
5. **Set secrets**:
   ```bash
   npx wrangler secret put STRIPE_SECRET_KEY    # sk_live_xxx or sk_test_xxx
   npx wrangler secret put STRIPE_WEBHOOK_SECRET # whsec_xxx
   ```
6. **Create webhook endpoint** in Stripe Dashboard:
   - URL: `https://reko-api.yasodev.workers.dev/api/webhooks/stripe`
   - Events: `customer.subscription.updated`, `customer.subscription.deleted`
7. **Deploy**:
   ```bash
   cd apps/api && pnpm deploy
   ```

---

## Task 10: Deployment & E2E Test

**Step 1: Deploy API**
```bash
cd apps/api && pnpm deploy
```

**Step 2: Deploy website**
```bash
cd apps/website && pnpm build
# Deploy to Cloudflare Pages / your hosting
```

**Step 3: E2E smoke test**

1. Open `reko.video/#pricing` → verify Free vs Pro columns render
2. Click "Subscribe to Pro" → verify Stripe Checkout opens
3. Use Stripe test card (`4242 4242 4242 4242`) to complete payment
4. Verify redirect to `/pro/success?session_id=...`
5. Verify license key appears (starts with `rk_live_`)
6. Copy key
7. Open Reko desktop app, export a large video (>100MB)
8. Click "Share Link" → expect `file_too_large` error
9. Enter license key when prompted
10. Click "Share Link" again → expect success (Pro limits applied)
11. Open the share URL → verify badge respects creator's setting
12. Wait for webhook: check D1 that `license_keys` row exists with `status = 'active'`
13. Cancel subscription in Stripe Dashboard → verify webhook updates status to `canceled`
14. Try sharing again → expect free tier limits (key is now canceled)

---

## Summary

| What | Where | Lines Changed |
|------|-------|--------------|
| License keys table | `apps/api/src/db/schema.sql` | ~15 |
| Tier middleware | `apps/api/src/middleware/license.ts` | ~55 |
| Tier-aware upload | `apps/api/src/routes/upload.ts` | ~20 modified |
| Badge tier-aware | `apps/api/src/routes/video.ts` | ~3 |
| Stripe billing routes | `apps/api/src/routes/billing.ts` | ~140 |
| Route mounting | `apps/api/src/index.ts` | ~3 |
| CORS header | `apps/api/src/middleware/cors.ts` | ~1 |
| Pricing section | `apps/website/src/components/pricing.tsx` | full rewrite |
| Success page | `apps/website/src/components/pro-success.tsx` | ~120 |
| Website routing | `apps/website/src/main.tsx` | ~10 |
| License key in API client | `apps/app/src/lib/share-api.ts` | ~15 |
| Upgrade prompt in export | `apps/app/src/components/editor/export-button.tsx` | ~30 |
| Player expired nudge | `apps/player/src/components/player-page.tsx` | ~15 |

**No user accounts. No auth system. No magic links. Just: pay → get key → paste key → Pro.**

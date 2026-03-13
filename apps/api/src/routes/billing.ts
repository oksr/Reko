import { Hono } from "hono"
import { nanoid } from "nanoid"
import type { Env } from "../types"
import { hashToken } from "../lib/crypto"

const billing = new Hono<{ Bindings: Env }>()

const LS_API = "https://api.lemonsqueezy.com/v1"

/**
 * POST /api/billing/checkout
 * Creates a Lemon Squeezy checkout session for Pro monthly subscription.
 * Returns the checkout URL — client redirects to it.
 */
billing.post("/checkout", async (c) => {
  const body = await c.req.json<{ email?: string }>().catch(() => ({} as { email?: string }))

  // Generate activation token to correlate checkout → webhook → activate
  const activationToken = nanoid(32)
  const now = Date.now()

  // Create a pending license key row
  await c.env.DB.prepare(
    `INSERT INTO license_keys (id, key_hash, email, activation_token, status, created_at, updated_at)
     VALUES (?, NULL, ?, ?, 'pending', ?, ?)`
  )
    .bind(nanoid(16), body.email || "", activationToken, now, now)
    .run()

  // Create Lemon Squeezy checkout
  const res = await fetch(`${LS_API}/checkouts`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${c.env.LEMONSQUEEZY_API_KEY}`,
      "Content-Type": "application/vnd.api+json",
      "Accept": "application/vnd.api+json",
    },
    body: JSON.stringify({
      data: {
        type: "checkouts",
        attributes: {
          product_options: {
            redirect_url: `${c.env.WEBSITE_URL}/pro/success?token=${activationToken}`,
          },
          checkout_data: {
            email: body.email || undefined,
            custom: { activation_token: activationToken },
          },
        },
        relationships: {
          store: { data: { type: "stores", id: c.env.LEMONSQUEEZY_STORE_ID } },
          variant: { data: { type: "variants", id: c.env.LEMONSQUEEZY_VARIANT_ID } },
        },
      },
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    console.error("[billing] LS checkout error:", err)
    return c.json({ error: "Failed to create checkout" }, 500)
  }

  const data = await res.json() as { data: { attributes: { url: string } } }
  return c.json({ url: data.data.attributes.url })
})

/**
 * GET /api/billing/activate?token=xxx
 * Called by the success page to retrieve the license key.
 * Polls until the webhook has processed and the license is active.
 */
billing.get("/activate", async (c) => {
  const token = c.req.query("token")
  if (!token) {
    return c.json({ error: "Missing token" }, 400)
  }

  const row = await c.env.DB.prepare(
    "SELECT id, status, email FROM license_keys WHERE activation_token = ?"
  )
    .bind(token)
    .first<{ id: string; status: string; email: string }>()

  if (!row) {
    return c.json({ error: "Not found" }, 404)
  }

  if (row.status === "pending") {
    return c.json({ status: "pending" }, 202)
  }

  // Generate the license key now (only when the user retrieves it)
  const licenseKey = `rk_live_${nanoid(32)}`
  const keyHash = await hashToken(licenseKey)
  const now = Date.now()

  await c.env.DB.prepare(
    "UPDATE license_keys SET key_hash = ?, updated_at = ? WHERE id = ?"
  )
    .bind(keyHash, now, row.id)
    .run()

  return c.json({ licenseKey, email: row.email })
})

/**
 * GET /api/billing/status?key=rk_live_xxx
 * Validates a license key and returns its tier, status, and associated email.
 * Read-only — no mutations. Used by the desktop app settings window.
 */
billing.get("/status", async (c) => {
  const key = c.req.query("key")
  if (!key) {
    return c.json({ tier: "free", status: "none", email: null })
  }

  const keyHash = await hashToken(key)
  const row = await c.env.DB.prepare(
    "SELECT status, email FROM license_keys WHERE key_hash = ?"
  )
    .bind(keyHash)
    .first<{ status: string; email: string }>()

  if (!row) {
    return c.json({ tier: "free", status: "none", email: null })
  }

  const tier = row.status === "active" ? "pro" : "free"
  return c.json({ tier, status: row.status, email: row.email })
})

/**
 * POST /api/webhooks/lemonsqueezy
 * Handles Lemon Squeezy webhook events for subscription lifecycle.
 * Verifies HMAC-SHA256 signature.
 */
billing.post("/lemonsqueezy", async (c) => {
  const signature = c.req.header("x-signature")
  const rawBody = await c.req.text()

  if (!signature) {
    return c.json({ error: "Missing signature" }, 400)
  }

  // Verify HMAC-SHA256 signature
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(c.env.LEMONSQUEEZY_WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  )
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody))
  const expectedSignature = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")

  if (signature !== expectedSignature) {
    return c.json({ error: "Invalid signature" }, 400)
  }

  const payload = JSON.parse(rawBody) as {
    meta: { event_name: string; custom_data?: { activation_token?: string } }
    data: {
      id: string
      attributes: {
        status: string
        customer_id: number
        user_email: string
      }
    }
  }

  const now = Date.now()
  const eventName = payload.meta.event_name
  const sub = payload.data
  const activationToken = payload.meta.custom_data?.activation_token

  switch (eventName) {
    case "subscription_created": {
      if (!activationToken) break

      await c.env.DB.prepare(
        `UPDATE license_keys
         SET status = 'active', email = ?, ls_customer_id = ?, ls_subscription_id = ?, updated_at = ?
         WHERE activation_token = ?`
      )
        .bind(
          sub.attributes.user_email || "",
          String(sub.attributes.customer_id),
          sub.id,
          now,
          activationToken
        )
        .run()
      break
    }

    case "subscription_updated": {
      const status =
        sub.attributes.status === "active" || sub.attributes.status === "on_trial"
          ? "active"
          : sub.attributes.status === "past_due" || sub.attributes.status === "unpaid"
            ? "past_due"
            : "canceled"

      await c.env.DB.prepare(
        "UPDATE license_keys SET status = ?, updated_at = ? WHERE ls_subscription_id = ?"
      )
        .bind(status, now, sub.id)
        .run()
      break
    }

    case "subscription_cancelled":
    case "subscription_expired": {
      await c.env.DB.prepare(
        "UPDATE license_keys SET status = 'canceled', updated_at = ? WHERE ls_subscription_id = ?"
      )
        .bind(now, sub.id)
        .run()
      break
    }
  }

  return c.json({ received: true })
})

export { billing }

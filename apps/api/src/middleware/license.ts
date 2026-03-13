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

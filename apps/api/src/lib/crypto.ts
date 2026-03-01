/**
 * SHA-256 hash a string and return the full hex digest.
 * Used for owner tokens and viewer IP hashing.
 */
export async function hashToken(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const hash = await crypto.subtle.digest("SHA-256", data)
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

/**
 * Hash a string and truncate to 16 hex chars.
 * Used for viewer IP hashing — short enough to prevent reversal,
 * long enough for uniqueness counting.
 */
export async function hashShort(input: string): Promise<string> {
  const full = await hashToken(input)
  return full.slice(0, 16)
}

/**
 * Extract just the domain from a referrer URL.
 * Strips path, query, and fragment to avoid leaking private page URLs.
 * Returns null if the referrer is empty or unparseable.
 */
export function extractDomain(referrer: string | undefined | null): string | null {
  if (!referrer) return null
  try {
    return new URL(referrer).hostname
  } catch {
    return null
  }
}

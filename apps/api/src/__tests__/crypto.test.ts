import { describe, it, expect, beforeAll } from "vitest"
import { webcrypto } from "node:crypto"
import { hashToken, hashShort, extractDomain } from "../lib/crypto"

// Polyfill crypto.subtle for Node
beforeAll(() => {
  if (!globalThis.crypto?.subtle) {
    // @ts-expect-error Node webcrypto compat
    globalThis.crypto = webcrypto
  }
})

describe("hashToken", () => {
  it("returns a 64-char hex string (SHA-256)", async () => {
    const result = await hashToken("test-token")
    expect(result).toMatch(/^[0-9a-f]{64}$/)
  })

  it("produces consistent output for same input", async () => {
    const a = await hashToken("my-secret")
    const b = await hashToken("my-secret")
    expect(a).toBe(b)
  })

  it("produces different output for different inputs", async () => {
    const a = await hashToken("token-a")
    const b = await hashToken("token-b")
    expect(a).not.toBe(b)
  })
})

describe("hashShort", () => {
  it("returns a 16-char hex string", async () => {
    const result = await hashShort("192.168.1.1")
    expect(result).toMatch(/^[0-9a-f]{16}$/)
  })

  it("is the prefix of the full hash", async () => {
    const full = await hashToken("192.168.1.1")
    const short = await hashShort("192.168.1.1")
    expect(full.startsWith(short)).toBe(true)
  })
})

describe("extractDomain", () => {
  it("extracts hostname from a valid URL", () => {
    expect(extractDomain("https://example.com/path?q=1")).toBe("example.com")
  })

  it("returns null for empty/null/undefined input", () => {
    expect(extractDomain(null)).toBeNull()
    expect(extractDomain(undefined)).toBeNull()
    expect(extractDomain("")).toBeNull()
  })

  it("returns null for an invalid URL", () => {
    expect(extractDomain("not-a-url")).toBeNull()
  })
})

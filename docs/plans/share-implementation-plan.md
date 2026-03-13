# Implementation Plan: User Accounts, Quotas & Share Link Refactor

## Scope

Build the foundation for Reko's monetization: user accounts (magic link auth), per-user quotas, tier enforcement, and the share link refactor (decoupling share URLs from video IDs). No Stripe/payments in this phase — Pro tier exists in the schema but can only be set manually.

## Decisions

- **Auth**: Magic link (email-based). Requires Resend for email delivery (free tier: 100 emails/day).
- **URL format**: Clean break — player uses `/s/{token}` only. Old `/{videoId}` URLs won't be supported.
- **Email verification**: Not needed separately — magic link click IS verification.
- **Payments**: Deferred. `tier` column exists but defaults to `'free'`. Pro can be set via D1 console for testing.

---

## Step 1: Schema Migration

**Files:**
- Modify `apps/api/src/db/schema.sql`

**Add three tables:**

```sql
-- Users (magic link auth, API key for desktop app)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  api_key_hash TEXT NOT NULL UNIQUE,
  tier TEXT NOT NULL DEFAULT 'free',
  video_count INTEGER NOT NULL DEFAULT 0,
  storage_used_bytes INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Share links (decoupled from videos — one video can have multiple links)
CREATE TABLE IF NOT EXISTS share_links (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  token TEXT NOT NULL UNIQUE,
  allow_download INTEGER NOT NULL DEFAULT 0,
  show_badge INTEGER NOT NULL DEFAULT 1,
  password_hash TEXT,
  failed_password_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER,
  view_count INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_share_links_token ON share_links(token);
CREATE INDEX IF NOT EXISTS idx_share_links_video ON share_links(video_id);

-- Access grants (temporary tokens after password verification)
CREATE TABLE IF NOT EXISTS share_access_grants (
  id TEXT PRIMARY KEY,
  share_link_id TEXT NOT NULL REFERENCES share_links(id) ON DELETE CASCADE,
  grant_token TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

-- Magic link tokens (short-lived, used once)
CREATE TABLE IF NOT EXISTS magic_link_tokens (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
```

**Also modify `videos` table** — add `user_id TEXT` column (nullable, for backward compat with owner-token videos):

```sql
ALTER TABLE videos ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE SET NULL;
```

---

## Step 2: Add Resend Email Dependency + Config

**Files:**
- Modify `apps/api/package.json` — add `resend` package
- Modify `apps/api/wrangler.toml` — add `RESEND_API_KEY` secret, `APP_URL` var
- Create `apps/api/src/lib/email.ts` — email sending utility

**Email utility** sends magic link emails via Resend API. Template: simple text email with a login link like `https://reko.video/auth/verify?token={token}`.

Since this is a Workers environment, we use Resend's REST API directly (no SDK needed) to keep the bundle small. Just a `fetch()` call.

---

## Step 3: Auth Routes (Magic Link)

**Files:**
- Create `apps/api/src/routes/auth.ts`
- Modify `apps/api/src/index.ts` — mount auth routes

**Endpoints:**

`POST /api/auth/login` — Start magic link flow
- Body: `{ email }`
- Generate a random token (nanoid 32), hash it, store in `magic_link_tokens` with 15-min expiry
- Send email with link: `{APP_URL}/auth/verify?token={rawToken}`
- Return `{ ok: true }` (never reveal if email exists)

`POST /api/auth/verify` — Complete magic link flow
- Body: `{ token }`
- Hash the token, look up in `magic_link_tokens` (not used, not expired)
- Mark token as used
- If user with that email exists → return their API key
- If no user → create one (generate API key, nanoid 32), hash and store
- Return `{ apiKey, userId, email, tier }`
- **API key is the long-lived credential** the desktop app stores and sends on every request

`POST /api/auth/me` — Get current user info
- Requires `Authorization: Bearer {apiKey}`
- Return `{ userId, email, tier, videoCount, storageUsedBytes }`

---

## Step 4: User Auth Middleware

**Files:**
- Create `apps/api/src/middleware/user-auth.ts`

**Two middleware functions:**

`requireUser()` — Strict: request must have a valid API key. Returns 401 if not.
- Extract `Authorization: Bearer {apiKey}` header
- SHA-256 hash the key
- Look up `users` by `api_key_hash`
- Set `c.set('user', userRow)` on context for downstream handlers

`optionalUser()` — Lenient: tries to authenticate but doesn't fail if no key.
- Same logic, but if no header or invalid key, just continues with `c.set('user', null)`
- Used for endpoints that behave differently for authenticated vs anonymous users

---

## Step 5: Quota Middleware

**Files:**
- Create `apps/api/src/middleware/quota.ts`

**Tier limits:**
```typescript
const TIER_LIMITS = {
  free:  { maxVideos: 5, maxFileSizeBytes: 100 * MB, maxStorageBytes: 500 * MB, maxShareLinksPerVideo: 1 },
  pro:   { maxVideos: null, maxFileSizeBytes: 5 * GB, maxStorageBytes: 50 * GB, maxShareLinksPerVideo: null },
} as const
```

**`assertUploadQuota(user, fileSizeBytes)`** — called before video creation:
- Check `user.video_count < maxVideos`
- Check `fileSizeBytes <= maxFileSizeBytes`
- Check `user.storage_used_bytes + fileSizeBytes <= maxStorageBytes` (with 10% buffer on storage)
- Return 403 with: `{ error: "quota_exceeded", type: "video_count"|"file_size"|"storage", current, limit, upgradeUrl }`

**`assertShareLinkQuota(user, videoId)`** — called before share link creation:
- Count existing share links for this video
- Check count < `maxShareLinksPerVideo`

---

## Step 6: Refactor Upload Route

**Files:**
- Modify `apps/api/src/routes/upload.ts`

**Changes to `POST /api/videos`:**
1. Add `requireUser()` middleware — uploads now require authentication
2. Call `assertUploadQuota(user, body.fileSizeBytes)` before creating video
3. Store `user_id` on the video record
4. After video creation, auto-create one share link (with token) for the video
5. Return both `videoId` and `shareLink: { token, shareUrl }` in response
6. Set `expires_at` based on user tier: free = 7 days, pro = null

**Changes to `POST /api/videos/:id/finalize`:**
1. Accept either owner token OR API key auth (owner token for backward compat)
2. On finalize, increment `user.video_count` and `user.storage_used_bytes`

**Response shape update:**
```typescript
// Old
{ videoId, ownerToken, uploadUrl, shareUrl }
// New
{ videoId, ownerToken, uploadUrl, shareUrl, shareToken }
```

---

## Step 7: Share Links Routes

**Files:**
- Create `apps/api/src/routes/share-links.ts`
- Modify `apps/api/src/index.ts` — mount share link routes

**Endpoints:**

`POST /api/videos/:videoId/share-links` — Create additional share link
- Requires auth (API key) + must own the video
- Call `assertShareLinkQuota()` before creating
- Body: `{ allowDownload?, password?, expiresInDays? }`
- If password provided, hash it (SHA-256) and store
- Generate token (nanoid 32), store share link
- Return `{ token, shareUrl }`

`GET /api/videos/:videoId/share-links` — List share links for a video
- Requires auth + must own the video
- Return array of share link metadata (token, viewCount, expiresAt, hasPassword, createdAt)

`DELETE /api/share-links/:token` — Delete a share link
- Requires auth + must own the parent video
- Soft-deletes or hard-deletes the share link

`POST /api/share-links/:token/verify-password` — Verify password for protected link
- Public endpoint (no auth needed)
- Body: `{ password }`
- Rate-limited: check `failed_password_attempts` (lock after 10 attempts for 1 hour)
- If correct: create access grant (nanoid token, 24h expiry), return `{ grantToken }`
- If wrong: increment `failed_password_attempts`, return 403

---

## Step 8: Refactor Video Retrieval for Share Links

**Files:**
- Modify `apps/api/src/routes/video.ts`

**New endpoint: `GET /api/s/:token`** — Fetch video by share link token
- Look up `share_links` by token
- Check if expired → return 410 with `{ error: "expired" }`
- Check if password-protected → if so, require `X-Access-Grant` header with valid grant token
- Join with `videos` to get full metadata
- Determine `showBadge` based on video owner's tier (free = always true, pro = respect share link setting)
- Increment `share_links.view_count`
- Return `VideoMetadata` (same shape as before, but sourced through share link)

**Keep `GET /api/videos/:id/stream`** — unchanged (serves video bytes from R2)
**Keep `GET /api/videos/:id/thumbnail`** — unchanged

---

## Step 9: Tier-Aware Responses

**Files:**
- Modify `apps/api/src/routes/video.ts`
- Modify `apps/api/src/routes/analytics.ts`
- Modify `apps/api/src/routes/comments.ts`

**Rules:**
- **Badge**: free tier → `showBadge: true` always (ignore client/share link setting). Pro → respect setting.
- **Analytics** (`GET /api/videos/:id/analytics`): free → only `{ views }`. Pro → full breakdown (unique viewers, watch time, geography, referrers, daily).
- **Comments**: free → `allowComments: false` enforced server-side. Pro → configurable.
- **Download**: free → `allowDownload: false` enforced. Pro → configurable per share link.
- **Expiry**: free → 7 days. Pro → user-set or null (no expiry).

---

## Step 10: Update Shared Types

**Files:**
- Modify `packages/types/src/index.ts`

**Add types:**
```typescript
// Auth
interface LoginRequest { email: string }
interface LoginResponse { ok: true }
interface VerifyRequest { token: string }
interface VerifyResponse { apiKey: string; userId: string; email: string; tier: string }
interface UserInfo { userId: string; email: string; tier: string; videoCount: number; storageUsedBytes: number }

// Share links
interface ShareLink { token: string; shareUrl: string; allowDownload: boolean; hasPassword: boolean; viewCount: number; expiresAt: number | null; createdAt: number }
interface CreateShareLinkRequest { allowDownload?: boolean; password?: string; expiresInDays?: number }
interface CreateShareLinkResponse { token: string; shareUrl: string }

// Quota error
interface QuotaError { error: "quota_exceeded"; type: "video_count" | "file_size" | "storage"; current: number; limit: number; upgradeUrl: string }
```

**Update `CreateVideoResponse`:**
- Add `shareToken: string` field

**Update `VideoMetadata`:**
- Add `tier: string` to settings (so player knows if badge is forced)

---

## Step 11: Update Player

**Files:**
- Modify `apps/player/src/components/player-page.tsx`
- Modify `apps/player/src/lib/api.ts`
- Create `apps/player/src/components/password-prompt.tsx`

**Routing change:**
- Extract token from URL: `/s/{token}` → `window.location.pathname.replace('/s/', '')`
- Call `fetchVideoByToken(token)` instead of `fetchVideo(videoId)`

**New API functions:**
- `fetchVideoByToken(token, grantToken?)` → `GET /api/s/{token}` with optional `X-Access-Grant` header
- `verifyPassword(token, password)` → `POST /api/share-links/{token}/verify-password`

**Password flow:**
- If API returns 401 with `{ error: "password_required" }`, show password prompt
- On submit, call `verifyPassword()` → get `grantToken` → store in `sessionStorage` → retry fetch
- On wrong password, show error and let user retry

**Expired video:**
- If API returns 410, show "This video has expired" with a link to reko.video

---

## Step 12: Update Desktop App — Auth

**Files:**
- Create `apps/app/src/lib/auth.ts` — auth state management
- Create `apps/app/src/components/share/auth-dialog.tsx` — login UI
- Modify `apps/app/src/lib/share-api.ts` — add API key to requests
- Modify `apps/app/src/platform/types.ts` — add auth methods to Platform

**Auth flow in desktop app:**
1. User clicks "Share" → check if API key is stored locally
2. If no API key → show auth dialog: "Enter your email to get started"
3. User enters email → call `POST /api/auth/login` → show "Check your email" message
4. User clicks magic link in email → opens browser to `{APP_URL}/auth/verify?token=...`
5. Verify page: calls `POST /api/auth/verify` → gets `apiKey` → needs to pass it back to desktop app

**Deep link for magic link callback:**
- Register a custom URL scheme in Tauri: `reko://auth/callback?apiKey={apiKey}`
- The web verify page, after getting the apiKey from the API, redirects to `reko://auth/callback?apiKey={apiKey}`
- Tauri handles the deep link, stores the API key securely
- Alternative (simpler): show the API key on the web page with "Copy and paste this into Reko" — less elegant but no deep link needed. Start with this, add deep link later.

**API key storage:**
- Store in Tauri's secure storage (keychain on macOS) via platform interface
- Add to `Platform` interface: `auth.getApiKey()`, `auth.setApiKey()`, `auth.clearApiKey()`

---

## Step 13: Update Desktop App — Share Flow

**Files:**
- Modify `apps/app/src/hooks/use-share.ts`
- Modify `apps/app/src/components/editor/export-button.tsx`
- Create `apps/app/src/components/share/upgrade-prompt.tsx`

**Changes to share flow:**
1. `useShare` hook now gets API key from auth state and passes to `ShareApiClient`
2. `ShareApiClient` adds `Authorization: Bearer {apiKey}` to all requests
3. On 403 quota error: parse the structured error, show upgrade prompt with specific message
4. On successful share: show the share link URL (now uses token-based URL)
5. Store `shareToken` (not just `videoId`) in project state for future reference

**Upgrade prompt component:**
- "You've used 5/5 free shares. Upgrade to Pro for unlimited sharing."
- "This video is 250MB. Free plan supports up to 100MB."
- "You've used 480MB of 500MB storage."
- Button: "Upgrade to Pro" → opens `upgradeUrl` in browser (placeholder for now, points to reko.video/pro)

---

## Step 14: Auth Verify Web Page

**Files:**
- Create a simple static page or add route to `apps/player/` or `apps/website/`

**Purpose:** The landing page for magic link clicks. When user clicks the link in their email:
1. Page extracts `token` from query params
2. Calls `POST /api/auth/verify` with the token
3. On success: shows "You're logged in!" with the API key and instructions to paste into Reko
4. Later: redirect to `reko://auth/callback?apiKey={key}` for seamless handoff

This can live as a simple route in the player app (`/auth/verify`) since it's already deployed on Cloudflare Pages.

---

## Implementation Order

Each step is deployable independently:

1. **Schema migration** (Step 1) — run against D1
2. **Email utility** (Step 2) — add Resend, test email sending
3. **Auth routes + middleware** (Steps 3-4) — register/login/verify endpoints
4. **Shared types** (Step 10) — update wire types for all new endpoints
5. **Quota middleware** (Step 5) — tier limit checks
6. **Upload route refactor** (Step 6) — require auth, enforce quotas, create share link on upload
7. **Share links routes** (Step 7) — CRUD for share links
8. **Video retrieval refactor** (Step 8) — `/api/s/:token` endpoint
9. **Tier-aware responses** (Step 9) — badge/analytics/comments gating
10. **Player update** (Step 11) — new URL routing, password flow
11. **Auth verify page** (Step 14) — magic link landing page
12. **Desktop app auth** (Step 12) — login dialog, API key storage
13. **Desktop app share flow** (Step 13) — quota errors, upgrade prompts

---

## Files Summary

**New files (10):**
- `apps/api/src/lib/email.ts`
- `apps/api/src/routes/auth.ts`
- `apps/api/src/routes/share-links.ts`
- `apps/api/src/middleware/user-auth.ts`
- `apps/api/src/middleware/quota.ts`
- `apps/app/src/lib/auth.ts`
- `apps/app/src/components/share/auth-dialog.tsx`
- `apps/app/src/components/share/upgrade-prompt.tsx`
- `apps/player/src/components/password-prompt.tsx`
- Auth verify page (location TBD — likely `apps/player/src/components/verify-page.tsx`)

**Modified files (12):**
- `apps/api/src/db/schema.sql`
- `apps/api/src/index.ts`
- `apps/api/src/routes/upload.ts`
- `apps/api/src/routes/video.ts`
- `apps/api/src/routes/analytics.ts`
- `apps/api/src/routes/comments.ts`
- `apps/api/wrangler.toml`
- `apps/api/package.json`
- `packages/types/src/index.ts`
- `apps/app/src/lib/share-api.ts`
- `apps/app/src/hooks/use-share.ts`
- `apps/app/src/components/editor/export-button.tsx`
- `apps/app/src/platform/types.ts`
- `apps/player/src/components/player-page.tsx`
- `apps/player/src/lib/api.ts`

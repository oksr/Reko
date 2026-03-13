# Monetizing Reko's Share Infrastructure

## Strategy: Free App, Paid Cloud

The desktop recording/editing app stays free and open source. Revenue comes from hosting the share infrastructure — the API (`apps/api/`), video storage (Cloudflare R2), and web player (`apps/player/`).

This is the same model as CleanShot X (free app + paid cloud) and Loom (free tier with strict limits, paid tiers for power users). It works because:

- The app is the acquisition channel — users discover Reko, record videos, hit the share button
- Every free shared video shows a "Made with Reko" badge — free marketing
- The infrastructure has real marginal cost (storage, compute) that justifies charging
- Self-hosters can run their own instance but pay their own infra costs

### Market Reference

| Product | Free Tier | Paid Tier | Model |
|---------|-----------|-----------|-------|
| Loom | 5min, 25 videos | $15-20/user/mo | Per-seat subscription |
| CleanShot X | No free tier | $29 app + $8/mo cloud | App + cloud subscription |
| Zight | 25 videos | $10/user/mo | Per-seat subscription |
| Lawn (Ping Labs) | No free tier | $5/mo basic, $25/mo pro | Per-team subscription |

---

## Competitive Analysis: Lawn (pingdotgg/lawn)

Lawn is a video review platform built by Theo Browne (Ping Labs), open-sourced under MIT. It targets creative teams who need Frame.io-style video review workflows. Key takeaways for Reko:

### What Lawn Does Right

**1. Team-first billing model**
Lawn bills per-team, not per-user. A team is the billing entity with a single Stripe subscription. Members are invited with roles (owner, admin, member, viewer). This is cleaner than per-user billing because:
- One person pays, the whole team benefits
- No awkward "who pays for seat #6?" conversations
- Storage limits are per-team, not per-user (100GB basic, 1TB pro)

**2. Mux for video processing (outsource the hard parts)**
Lawn stores raw uploads in S3, then sends them to Mux for transcoding and HLS streaming. Mux handles adaptive bitrate, thumbnails, and CDN delivery. This means Lawn doesn't need to build or maintain any video streaming infrastructure. Reko currently streams raw MP4 via R2 range requests — this works but doesn't support adaptive bitrate or quality optimization.

**3. Share links as a separate entity from videos**
In Lawn, a share link is a distinct object with its own token, expiry, password, download permission, and view count. One video can have multiple share links with different settings. This is more flexible than Reko's current model where the video IS the share.

**4. Access grant pattern for password-protected links**
When a viewer enters a correct password, Lawn issues a short-lived "access grant" token (separate from the share link token). This means the password is verified once, and subsequent requests use the grant token. Prevents constant re-verification and provides a clean session model.

**5. 7-day free trial on first subscription**
`TEAM_TRIAL_DAYS = 7` — new teams get a week to try paid features before being charged. Reduces friction. Stripe handles the trial period automatically.

**6. Storage-based limits (not video count)**
Lawn limits by storage (100GB basic, 1TB pro) not by number of videos. This is arguably fairer — a 10-second clip shouldn't count the same as a 2-hour review. Consider for Reko: storage-based limits on Pro tier instead of (or in addition to) video count.

**7. Workflow states on videos**
Videos have a `workflowStatus`: "review" → "rework" → "done". This turns Lawn from a simple sharing tool into a review/approval tool. Not directly applicable to Reko's consumer use case, but shows how to add value beyond just hosting.

### What Lawn Does Differently (and why Reko shouldn't copy it)

**1. MIT license with no protection**
Lawn is MIT — anyone can fork it and run a competing commercial service. Theo can do this because his brand and audience are the moat, not the code. Reko doesn't have that luxury yet. Stick with AGPL + commercial restriction.

**2. No free tier**
Lawn requires a paid subscription to upload. Every team starts with `billingStatus: "not_subscribed"` and must subscribe before uploading (`assertTeamHasActiveSubscription` is called before every upload). This works for Lawn's target audience (creative teams already paying for Frame.io) but would kill Reko's adoption. Reko needs a free tier for viral growth.

**3. Convex + Clerk stack**
Lawn uses Convex (real-time database) and Clerk (auth). These are powerful but add vendor lock-in and cost. Reko's Cloudflare stack (Workers + D1 + R2) is cheaper and more portable. Don't switch.

**4. Mux costs**
Mux charges ~$0.007/min for encoding + $0.007/min for streaming. For a 5-minute video watched 100 times: ~$3.54. This adds up fast. Reko's direct R2 streaming (free egress) is a major cost advantage. Consider Mux only if adaptive bitrate becomes a customer demand.

### Lessons to Apply to Reko

| Lawn Pattern | Reko Adaptation |
|-------------|-----------------|
| Team-based billing entity | Add team concept in Phase 2.5 (after individual Pro) — teams share storage pool and video management |
| Share links as separate objects | Refactor: decouple share settings from video metadata. One video can have multiple links with different expiry/password/download settings |
| Access grants for password-protected links | Adopt this pattern — issue a short-lived JWT or token after password verification, avoid re-checking password on every request |
| Storage-based limits | Pro tier: 50GB storage pool instead of (or alongside) video count limits. More intuitive and fair |
| `assertTeamCanStoreBytes()` before upload | Add equivalent `assertQuotaAvailable()` middleware that checks both video count and storage |
| Stripe Checkout + Customer Portal | Same approach — Stripe Checkout for payment, Customer Portal for self-service management |
| 7-day trial | Offer a trial for Pro — users see the full analytics, no badge, no expiry for 7 days, then convert or downgrade |
| `workflowStatus` on videos | Not needed now. But future Team tier could add review/approval workflows |

---

## Pricing Tiers

### Free (no account required)

- 5 shared videos max
- 100MB per video file size
- 7-day auto-expiry on all links
- "Made with Reko" badge always shown (server-enforced, cannot disable)
- View count only (no detailed analytics)
- No password protection
- No comments
- No download toggle (download disabled)
- Single share link per video

### Pro — $8/month or $69/year

- Unlimited shared videos
- 5GB per video file size
- 50GB total storage pool (inspired by Lawn's storage-based limits — fairer than video count alone)
- No expiry (links stay alive indefinitely)
- Badge optional (creator can toggle off)
- Full analytics: unique viewers, watch time, geography, daily breakdown, referrers
- Password protection (with access grant pattern — verify once, session-based access)
- Comments enabled
- Download toggle
- Custom thumbnails
- Multiple share links per video (different settings per link, like Lawn)
- 7-day free trial on first signup (Stripe-managed trial period)

### Team — $15/team/month (later)

Inspired by Lawn's team-first billing. One subscription, whole team benefits.

- Everything in Pro
- Team workspace: invite members with roles (owner, admin, member, viewer)
- Shared storage pool (200GB)
- Team-level analytics dashboard
- Custom branding on player (logo, accent color)
- SSO (SAML/OIDC)
- Video review workflows (approve/request changes — Lawn's `workflowStatus` pattern)

### Other considerations

- **Lifetime deal** ($199, launch-only) — one-time purchase for early adopters. Builds loyalty, funds initial infra. Limited to first 100 users to cap revenue risk.
- **Usage-based add-on** — pay per GB beyond storage cap ($0.10/GB/month). Aligns cost with revenue for heavy users.

---

## Infrastructure Economics

### Cloudflare Cost Breakdown

```
R2 storage:        $0.015/GB/month
R2 egress:         FREE (zero bandwidth cost — this is the key advantage)
R2 Class A ops:    $4.50 per million (PUT, POST, LIST)
R2 Class B ops:    $0.36 per million (GET, HEAD)
Workers:           Free tier = 100K requests/day, paid = $5/mo + $0.50/million
D1:                Free tier = 5M reads/day, 100K writes/day
```

### Per-User Cost Estimates

**Free user** (5 videos x 100MB, 7-day lifecycle):
- Peak storage: ~500MB = $0.0075/month
- With expiry cleanup, average storage is lower
- Effectively free — one Pro user subsidizes ~1,000 free users

**Pro user** (20 videos x 1GB average):
- Storage: ~20GB = $0.30/month
- Revenue: $8/month
- Gross margin: ~96%

### Break-Even

At Cloudflare's pricing, the infrastructure cost per user is negligible. The real costs are:
- Domain + DNS: ~$15/year
- Stripe fees: 2.9% + $0.30 per transaction
- Development time (the actual cost)

Even 10 paying users at $8/month covers all infrastructure with margin.

---

## Licensing Strategy

Split licensing to protect the hosted business while keeping the desktop app fully open:

```
/apps/app/       → MIT    (desktop UI — attract contributors)
/apps/tauri/     → MIT    (Tauri shell)
/RekoEngine/     → MIT    (Swift engine)
/apps/api/       → AGPL-3.0 + commercial restriction
/apps/player/    → AGPL-3.0 + commercial restriction
/packages/types/ → MIT    (shared types)
```

### AGPL + Commercial Restriction (Inbox Zero model)

The share infrastructure (`apps/api/`, `apps/player/`) uses AGPL-3.0 with an additional clause:

> You may not use this software for commercial purposes that involve monetizing the software itself — including selling access, offering it as a paid service, or incorporating it into a commercial product — without written permission from [Reko entity].

This means:
- **Individuals and small teams** can self-host freely for personal/internal use
- **Competitors** cannot take the code and run a competing hosted service
- **Contributors** can fork, modify, and submit PRs freely
- **Enterprises** with 5+ users should contact for a commercial license

### Self-Hosting Escape Hatch

Include a `BYPASS_QUOTAS=true` environment variable that disables all tier enforcement. Self-hosters set this in their own deployment. They get unlimited everything but run their own Cloudflare account and pay their own bills. The AGPL prevents them from reselling it.

---

## Technical Changes Required

### Current State

What exists today in `apps/api/`:
- Anonymous owner tokens (no user identity, no accounts)
- No usage limits or quotas
- `expires_at` column exists but is always null
- `show_badge` is a client-controlled boolean (easy to bypass)
- Rate limiting is per-worker-instance (in-memory, not global)
- No payment integration

### Phase 1: Server-Side Enforcement (no accounts needed)

**Goal:** Make the free tier real. Every shared video gets expiry and forced badge. No user accounts, no payments — just enforce limits server-side.

Changes:

**1.1 — Expiry enforcement**
- `POST /api/videos`: set `expires_at = now + 7 days` for all videos (until accounts exist, everyone is "free")
- Add Cloudflare Cron Trigger (Workers scheduled handler): runs hourly, deletes R2 objects and marks `status='deleted'` for expired videos
- `GET /api/videos/:id`: return 410 Gone for expired videos
- Player: show "This video has expired" message with link to reko.video

**1.2 — Badge enforcement**
- `GET /api/videos/:id`: always return `settings.showBadge: true` (override whatever the client sent)
- Ignore the client-provided `showBadge` value in `POST /api/videos` — store it in DB for when the user upgrades, but always serve `true` for free users
- Player already reads this from the API response, so no player changes needed

**1.3 — File size limit**
- `POST /api/videos`: enforce 100MB max file size (currently allows up to 5GB)
- Return a specific error code: `{ error: "file_too_large", limit: 104857600, upgradeUrl: "https://reko.video/pro" }`
- Desktop app catches this and shows upgrade prompt

### Phase 2: User Accounts + Quotas

**Goal:** Identify users so you can enforce per-user limits and later charge them.

Changes:

**2.1 — Users table**
```sql
CREATE TABLE users (
  id                  TEXT PRIMARY KEY,     -- nanoid(16)
  email               TEXT UNIQUE NOT NULL,
  api_key_hash        TEXT UNIQUE NOT NULL,  -- SHA-256 of API key
  tier                TEXT DEFAULT 'free',   -- 'free' | 'pro' | 'team'
  stripe_customer_id  TEXT,
  stripe_subscription_id TEXT,
  billing_status      TEXT DEFAULT 'not_subscribed', -- 'not_subscribed' | 'trialing' | 'active' | 'past_due' | 'canceled'
  trial_used          INTEGER DEFAULT 0,    -- 1 if trial already consumed (prevent re-trials)
  video_count         INTEGER DEFAULT 0,
  storage_used_bytes  INTEGER DEFAULT 0,
  created_at          INTEGER NOT NULL
);
```

Add `user_id TEXT` foreign key to `videos` table.

**2.1b — Share links table (inspired by Lawn)**

Decouple share link settings from the video itself. One video can have multiple share links with different configurations.

```sql
CREATE TABLE share_links (
  id                  TEXT PRIMARY KEY,     -- nanoid(16)
  video_id            TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  token               TEXT UNIQUE NOT NULL,  -- nanoid(32), used in share URL
  created_by_user_id  TEXT REFERENCES users(id),
  expires_at          INTEGER,              -- null = no expiry (pro only)
  allow_download      INTEGER DEFAULT 0,
  password_hash       TEXT,
  failed_attempts     INTEGER DEFAULT 0,
  locked_until        INTEGER,
  view_count          INTEGER DEFAULT 0,
  created_at          INTEGER NOT NULL
);

-- Access grants: short-lived tokens issued after password verification (Lawn pattern)
CREATE TABLE share_access_grants (
  id                  TEXT PRIMARY KEY,     -- nanoid(16)
  share_link_id       TEXT NOT NULL REFERENCES share_links(id) ON DELETE CASCADE,
  grant_token         TEXT UNIQUE NOT NULL,
  expires_at          INTEGER NOT NULL,     -- 1 hour after creation
  created_at          INTEGER NOT NULL
);
```

This replaces the current model where the video ID is the share URL. New flow:
- `POST /api/videos/:id/share` → creates a share_link, returns `{ token, shareUrl }`
- Share URL: `https://share.reko.video/s/{token}` (not `/videoId`)
- Pro users can create multiple share links per video with different settings
- Free users get one share link per video
- Revoking a share link doesn't delete the video

**2.2 — API key authentication**
- New route: `POST /api/auth/register` — email + password or magic link, returns API key (one-time, like owner token)
- New route: `POST /api/auth/login` — returns new API key
- New middleware: `requireUser()` — validates `Authorization: Bearer <api_key>` against `users.api_key_hash`
- `POST /api/videos` now requires auth (associates video with user)
- Backward compat: existing owner tokens still work for managing individual videos

**2.3 — Quota middleware (inspired by Lawn's `assertTeamCanStoreBytes`)**
```
apps/api/src/middleware/quota.ts
```

Tier limits definition:
```typescript
const TIER_LIMITS = {
  free:  { maxVideos: 5,    maxFileSizeBytes: 100 * MB, maxStorageBytes: 500 * MB, maxShareLinksPerVideo: 1 },
  pro:   { maxVideos: null, maxFileSizeBytes: 5 * GB,   maxStorageBytes: 50 * GB,  maxShareLinksPerVideo: null },
  team:  { maxVideos: null, maxFileSizeBytes: 5 * GB,   maxStorageBytes: 200 * GB, maxShareLinksPerVideo: null },
}
```

Checks before upload (similar to Lawn's `assertTeamCanStoreBytes`):
- `user.video_count < limits.maxVideos` (if not null)
- `body.fileSizeBytes <= limits.maxFileSizeBytes`
- `user.storage_used_bytes + body.fileSizeBytes <= limits.maxStorageBytes`

Return 403 with structured error:
```json
{
  "error": "quota_exceeded",
  "type": "video_count" | "file_size" | "storage",
  "current": 5,
  "limit": 5,
  "upgradeUrl": "https://reko.video/pro"
}
```

**2.4 — Tier-aware responses**
- `GET /api/videos/:id`: showBadge depends on owner's tier
- `GET /api/videos/:id/analytics`: only return full analytics if owner tier is 'pro'
- `POST /api/videos/:id/comments`: only allow if owner tier is 'pro'
- Expiry: free = 7 days, pro = null

**2.5 — Desktop app changes**
- Settings page: "Reko Cloud" section with login/register
- Store API key in system keychain via Tauri
- `ShareApiClient` sends API key in Authorization header
- Catch 403 quota errors, show upgrade modal with specific reason ("You've used 5/5 free shares")

### Phase 3: Payments

**Goal:** Accept money. Stripe Checkout for simplest integration.

Changes:

**3.1 — Stripe integration (modeled after Lawn's billing.ts)**
```
apps/api/src/routes/billing.ts   (or apps/api/ee/billing.ts)
```

Environment variables (same pattern as Lawn):
```
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
STRIPE_PRICE_PRO_MONTHLY     # Stripe Price ID for Pro monthly
STRIPE_PRICE_PRO_YEARLY      # Stripe Price ID for Pro yearly
```

Routes:
- `POST /api/billing/checkout` — create Stripe Checkout session
  - Include `subscription_data.trial_period_days: 7` for first-time subscribers (check `user.trial_used`)
  - Set metadata: `{ userId, plan, email }` for webhook reconciliation
  - Redirect user to Stripe's hosted checkout page
- `POST /api/billing/portal` — create Stripe Customer Portal session (manage subscription, cancel, update payment)
- `POST /api/webhooks/stripe` — handle events:
  - `checkout.session.completed` → set user tier to 'pro', mark `trial_used = 1`
  - `customer.subscription.updated` → update tier and billing_status
  - `customer.subscription.deleted` → downgrade to 'free'
  - `invoice.payment_failed` → set `billing_status = 'past_due'`, grace period (7 days), then downgrade

Reconciliation pattern (from Lawn's `syncTeamSubscriptionFromWebhook`): webhook handler should look up the user by multiple fields (userId in metadata → stripe_customer_id → stripe_subscription_id) to handle edge cases where metadata is missing.

**3.2 — Pricing page**
- Add to `apps/website/` or as a standalone page on reko.video
- Simple two-column: Free vs Pro comparison
- "Upgrade" button → Stripe Checkout

**3.3 — Desktop app upgrade flow**
- "Upgrade to Pro" button in share dialog (shown when hitting limits)
- Opens browser to Stripe Checkout with user's email pre-filled
- Stripe webhook updates tier server-side
- Desktop app polls or re-validates API key to pick up new tier
- Immediate access to Pro features after payment

**3.4 — Downgrade handling**
When a Pro user downgrades to free:
- Existing videos keep their current settings (no retroactive badge forcing)
- Existing videos get a 30-day grace period before expiry kicks in
- New uploads follow free limits
- Analytics access revoked (shows "Upgrade to view analytics")

### Phase 4: Growth Features

**Goal:** Maximize free-to-paid conversion.

**4.1 — Expiry warning emails**
- 24 hours before a free video expires, email the owner: "Your video [title] expires tomorrow. Upgrade to keep it alive."
- Requires email on the user account (Phase 2)

**4.2 — Analytics teaser**
- Free users see: "12 people viewed your video. Upgrade to see who, when, and how long they watched."
- Show the view count (free) but blur/lock the detailed breakdown

**4.3 — Share page branding**
- Pro users can customize: logo, accent color, call-to-action button below video
- Free users get the default Reko-branded player

**4.4 — Embed restrictions**
- Free: embed code includes "Made with Reko" footer in iframe
- Pro: clean embed, no branding

---

## Desktop App UX Changes

### Share Dialog Updates

Current flow: click "Share" → upload → get link.

New flow:
1. Click "Share" → check auth status
2. If not logged in → "Sign in to share" (register/login inline)
3. If logged in → check quota
4. If quota OK → upload → get link (same as today)
5. If quota exceeded → show upgrade prompt with specific reason
6. If free → show "link expires in 7 days" notice after sharing

### Settings Page: "Reko Cloud"

- Account section: email, tier badge, login/logout
- Usage: "3/5 videos shared" progress bar, "420MB / 500MB storage used"
- Manage subscription: opens Stripe Customer Portal in browser
- API key: show/regenerate (advanced, collapsed by default)

### Upgrade Prompts (contextual, not annoying)

Show upgrade only when the user hits a real limit:
- "This video is 250MB. Free plan supports up to 100MB. Upgrade to Pro for up to 5GB."
- "You've shared 5 videos this month. Upgrade for unlimited shares."
- "Your shared link will expire in 7 days. Upgrade to keep it alive forever."

Never show upgrade prompts during recording or editing — only in the share flow.

---

## Migration Path for Existing Videos

When launching accounts (Phase 2):
- Existing videos (uploaded without accounts) remain accessible
- Owner tokens continue to work for management
- No retroactive expiry on existing videos (grandfather them with a 30-day grace)
- Prompt users to "claim" existing videos by registering and linking their owner tokens

---

## Risks and Mitigations

### Risk: Self-hosters undercut the business
**Mitigation:** AGPL + commercial restriction prevents commercial competition. Self-hosting for personal use is fine — those users were never going to pay anyway, and they become advocates.

### Risk: Free tier too generous, no conversion
**Mitigation:** The 7-day expiry is the key conversion lever. Users share a video, send the link to colleagues, then the link dies. That's painful enough to pay $8/month. If conversion is still low, reduce to 3 videos or 3-day expiry.

### Risk: Free tier too restrictive, no adoption
**Mitigation:** 5 videos x 100MB x 7 days is enough to share a quick demo with a teammate. Monitor signup-to-share conversion. If users sign up but don't share, the limit is too tight. If they share but don't convert, the free tier is too generous.

### Risk: Abuse (spam, CSAM, piracy)
**Mitigation:** Phase 2 (accounts + email verification) makes abuse traceable. Add content reporting to player page. Implement basic hash-matching for known CSAM (required by law in many jurisdictions). Consider adding a manual review queue for videos exceeding certain view thresholds.

### Risk: GDPR/privacy with user accounts
**Mitigation:** Store minimal PII (email only). Analytics are already privacy-respecting (hashed IPs, no user-agent). Add data export and account deletion endpoints. Privacy policy page on reko.video.

---

## Success Metrics

| Metric | Target (3 months post-launch) |
|--------|-------------------------------|
| Free signups | 1,000+ |
| Videos shared (free) | 5,000+ |
| Free → Pro conversion | 3-5% |
| Monthly recurring revenue | $500+ (60+ Pro users) |
| Churn rate | <5%/month |
| Cost per free user | <$0.01/month |

---

## Open Questions

1. **Require accounts for free tier?** Phase 1 works without accounts (just enforce limits globally). But without accounts, you can't enforce per-user video counts — anyone can share 5 videos, clear cookies, share 5 more. Account requirement adds friction but enables real limits.

2. **Annual vs monthly pricing?** Offering both ($8/mo or $69/yr) gives a discount incentive for annual. But early on, monthly-only reduces commitment friction and lets you adjust pricing. Lawn only offers monthly — simpler to start.

3. **Lifetime deal?** One-time purchase (e.g., $199) can fund early development and build a loyal user base. Risk: lifetime users never generate recurring revenue. Consider offering only during launch period, capped at 100 users.

4. **Where does billing code live?** Options:
   - `apps/api/src/routes/billing.ts` — simple, all in one service
   - `apps/api/ee/billing.ts` — Inbox Zero pattern, separate license for billing code
   - Separate `apps/billing/` service — overkill for now
   - Recommendation: start with `billing.ts` in the main API, move to `ee/` folder only if/when you add the commercial license restriction.

5. **Content moderation?** At what scale does this become necessary? Probably after 10K+ shared videos. Start with a report button and manual review.

6. **Custom domains for Pro?** e.g., `share.yourcompany.com` instead of `share.reko.video`. High-value enterprise feature but complex (SSL cert provisioning, DNS verification). Defer to Team tier.

7. **Auth provider: build or buy?** Lawn uses Clerk ($25+/mo for production). Options for Reko:
   - DIY API keys in D1 (current plan, cheapest, simplest) — good enough for individual Pro users
   - Clerk/Auth0/WorkOS — better for Team tier (SSO, org management), adds cost
   - Recommendation: DIY for Phase 2, evaluate Clerk/WorkOS only when building Team tier

8. **Video processing: raw streaming vs Mux?** Lawn uses Mux for transcoding/HLS (~$0.007/min encode + $0.007/min stream). Reko streams raw MP4 from R2 (free egress). Tradeoffs:
   - R2 streaming: free, simple, but no adaptive bitrate, no quality optimization, large files = slow start
   - Mux: professional streaming quality, but adds ~$3-4 per video at 100 views
   - Recommendation: stay with R2 streaming for now. Add Mux as an optional Pro feature only if users complain about playback quality. The cost savings are a competitive advantage.

9. **Share link migration:** Current model uses video ID as the share URL (`share.reko.video/{videoId}`). New model proposes separate share link tokens (`share.reko.video/s/{token}`). Need a migration path:
   - Option A: Support both URL patterns indefinitely (old videos keep working)
   - Option B: Redirect old-style URLs to new-style (create a default share link for each existing video)
   - Recommendation: Option B during Phase 2 migration

10. **Storage limit enforcement: soft or hard?** Lawn hard-blocks uploads over storage limit (`assertTeamCanStoreBytes` throws). Options:
    - Hard limit: upload fails immediately (Lawn's approach) — clear but frustrating
    - Soft limit: allow the upload but warn + prevent next upload — more forgiving
    - Recommendation: hard limit with a 10% buffer. If you're at 48GB of 50GB, a 3GB upload still works (puts you at 51GB). But the next upload is blocked until you delete something or upgrade.

---

## Architecture Comparison: Reko vs Lawn vs Inbox Zero

| Aspect | Reko (current) | Lawn | Inbox Zero |
|--------|---------------|------|------------|
| **License** | None yet | MIT | AGPL + commercial restriction |
| **Backend** | Cloudflare Workers + D1 + R2 | Convex + S3 + Mux | Next.js + Prisma + Postgres |
| **Auth** | Anonymous (owner tokens) | Clerk (OAuth) | NextAuth (Google OAuth) |
| **Billing** | None | Stripe (per-team) | Stripe + Lemon Squeezy (per-user) |
| **Video hosting** | R2 direct streaming (free egress) | S3 → Mux (HLS transcoding) | N/A |
| **Free tier** | Currently unlimited (no enforcement) | No free tier | Free with limited AI/features |
| **Billing entity** | N/A | Team | User (with multi-account) |
| **Tier enforcement** | Client-side only | Server-side (`assertTeamCanStoreBytes`) | Server-side (`isPremium`, `hasTierAccess`) |
| **Trial** | None | 7-day Stripe trial | N/A |
| **Deployment** | Cloudflare (serverless) | Convex cloud + Vercel | Vercel |
| **Monthly infra cost** | ~$0/user (R2 free egress) | ~$3-5/user (Mux encoding) | ~$0.50/user (AI API calls) |

### Key Cost Advantage

Reko's Cloudflare stack is significantly cheaper than Lawn's Mux-based approach:

```
Reko (R2):    Upload 1GB video, 100 views → ~$0.015 storage/month, $0 egress = $0.015/month
Lawn (Mux):   Upload 1GB video, 100 views → $0.035 encode + ~$3.50 streaming = ~$3.54/month
```

This 200x cost difference means Reko can offer a generous free tier that Lawn can't afford. It also means higher margins on paid tiers.

### What to Adopt from Each

**From Lawn:**
- Share links as separate entities (multiple links per video)
- Access grant pattern for password-protected links
- Storage-based quota enforcement (`assertTeamCanStoreBytes` → `assertQuotaAvailable`)
- Team-based billing for the future Team tier
- 7-day Stripe trial
- Webhook reconciliation pattern (multi-field lookup)

**From Inbox Zero:**
- AGPL + commercial restriction licensing
- `BYPASS_PREMIUM_CHECKS` env var for self-hosters
- Feature gating with `isPremium()` / `hasTierAccess()` utility functions
- Dual payment provider support (Stripe primary, Lemon Squeezy as backup)
- Tier ranking system for comparing plan levels
- Enterprise license for 5+ user orgs

**Keep from Reko's current design:**
- Cloudflare-native stack (cost advantage is the moat)
- Direct R2 streaming (don't add Mux unless quality complaints arise)
- Privacy-first analytics (hashed IPs, no user-agent — differentiator vs competitors)
- Simple API key auth (don't need Clerk's complexity for individual users)

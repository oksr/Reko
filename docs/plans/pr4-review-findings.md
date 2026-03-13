# PR #4 Review Findings — Shareable Video Links

## P0 — Must Fix Before Merge

1. **Unauthenticated upload proxy** — `PUT /api/videos/upload/*` accepts any request with no auth. Anyone can overwrite videos or fill R2 storage. (`routes/upload.ts:136-152`)
2. **Comment deletion has no authorization** — `DELETE /:id/comments/:commentId` is publicly accessible. (`routes/comments.ts:74-89`)
3. **Owner token never persisted** — `useShare` hook receives ownerToken but never stores it in project JSON. Once share dialog closes, token is lost permanently. (`hooks/use-share.ts`)
4. **Share API bypasses Platform interface** — `share-api.ts` uses raw `fetch`/`XMLHttpRequest` instead of `usePlatform().invoke()`. Violates core architecture. (`lib/share-api.ts`)

## P1 — Should Fix

5. **No input validation on video creation** — `title`, `fileSizeBytes`, `durationMs` accepted without limits. (`routes/upload.ts:14-57`)
6. **Thumbnail base64 DoS** — `thumbnailData` in finalize has no size limit. (`routes/upload.ts:97-105`)
7. **Analytics double-counting** — 30s interval sends cumulative watchTimeMs without resetting. (`use-video-analytics.ts:57-64`)
8. **View tracking accepts arbitrary values** — No validation that `watchTimeMs <= durationMs` or `completionPercent` 0-100. (`routes/analytics.ts:39-86`)
9. **Zero test coverage** — 2,465 lines across 3 packages with no tests. No test framework for api/ or player/.
10. **Type duplication across 3 packages** — `VideoMetadata`, `Comment`, etc. defined separately in api, player, and app.

## P2 — Should Improve

11. **`export-button.tsx` component bloat** — 430+ lines mixing export and sharing. Extract `SharePanel`. (`export-button.tsx`)
12. **`requireOwner` fragile pattern** — Uses `c.status()`+`c.body()` instead of throwing `HTTPException`. (`middleware/auth.ts`)
13. **Duplicated auth logic in finalize** — Token verification re-implemented instead of reusing `requireOwner`. (`routes/upload.ts:72-87`)
14. **Localhost CORS origins in production** — Not gated behind dev flag. (`middleware/cors.ts`)
15. **No comment pagination** — Returns all comments with no limit. (`routes/comments.ts`)
16. **Missing `aria-label` on icon buttons** — Play, pause, mute, fullscreen, send. (`video-player.tsx`, `comments-section.tsx`)
17. **Unhandled promise rejection** — `fetchComments().then(setComments)` no `.catch()`. (`comments-section.tsx:19`)

## P3 — Minor

- Constant-time hash comparison (low practical risk)
- Missing error boundary in player app
- No cron trigger for expired video cleanup
- `wrangler.toml` placeholder database ID, no staging env
- Naive `pathname.slice(1)` routing in player
- Unused `StorageConfig` type with credential fields
- Unnecessary `eslint-disable` for ref in effect deps

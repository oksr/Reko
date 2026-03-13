import type { VideoMetadata, VideoComment } from "@reko/types"

const API_BASE = import.meta.env.VITE_API_URL || ""

export type { VideoMetadata, VideoComment }

export async function fetchVideo(videoId: string): Promise<VideoMetadata> {
  const res = await fetch(`${API_BASE}/api/videos/${videoId}`)
  if (!res.ok) {
    if (res.status === 410) throw new Error("expired")
    if (res.status === 404) throw new Error("not_found")
    throw new Error("fetch_failed")
  }
  return res.json()
}

export async function fetchComments(videoId: string): Promise<VideoComment[]> {
  const res = await fetch(`${API_BASE}/api/videos/${videoId}/comments`)
  if (!res.ok) return []
  return res.json()
}

export async function postComment(
  videoId: string,
  authorName: string,
  content: string,
  timestampMs?: number
): Promise<VideoComment> {
  const res = await fetch(`${API_BASE}/api/videos/${videoId}/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ authorName, content, timestampMs }),
  })
  if (!res.ok) throw new Error("Failed to post comment")
  return res.json()
}

export function trackView(
  videoId: string,
  watchTimeMs: number,
  completionPercent: number
): void {
  // Use sendBeacon for reliable delivery even when page closes
  const data = JSON.stringify({
    watchTimeMs,
    completionPercent,
    referrer: document.referrer || undefined,
  })

  if (navigator.sendBeacon) {
    navigator.sendBeacon(
      `${API_BASE}/api/videos/${videoId}/views`,
      new Blob([data], { type: "application/json" })
    )
  } else {
    fetch(`${API_BASE}/api/videos/${videoId}/views`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: data,
      keepalive: true,
    })
  }
}

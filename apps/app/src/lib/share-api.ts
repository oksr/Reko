import type {
  CreateShareRequest,
  CreateShareResponse,
  FinalizeShareRequest,
  FinalizeShareResponse,
  ShareUploadProgress,
  SharedVideo,
} from "@/types/sharing"

const API_BASE_URL =
  import.meta.env.VITE_SHARE_API_URL || "https://reko-api.yasodev.workers.dev"

/**
 * API client for the Reko sharing service.
 * Used by the desktop app to upload and manage shared videos.
 *
 * Owner-authenticated operations (delete, analytics, finalize) require
 * the ownerToken that was returned at video creation time. The token
 * is sent as a Bearer token in the Authorization header.
 */
export class ShareApiClient {
  private baseUrl: string

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl
  }

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

  /**
   * Step 1: Create a video record and get an upload URL.
   * The response includes an ownerToken that must be stored securely —
   * it is never returned again and is required for all management operations.
   */
  async createShare(
    request: CreateShareRequest
  ): Promise<CreateShareResponse> {
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

    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: "Unknown error" }))
      throw new Error(
        (error as { error: string }).error || `HTTP ${res.status}`
      )
    }

    return res.json()
  }

  /**
   * Step 2: Upload the video file to the provided URL.
   * Supports progress tracking via callback.
   */
  async uploadVideo(
    uploadUrl: string,
    videoData: ArrayBuffer,
    ownerToken: string,
    onProgress?: (progress: ShareUploadProgress) => void
  ): Promise<void> {
    const totalBytes = videoData.byteLength

    // Resolve relative upload URLs against the API base
    const resolvedUrl = uploadUrl.startsWith("/")
      ? `${this.baseUrl}${uploadUrl}`
      : uploadUrl

    // Use XMLHttpRequest for upload progress tracking
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open("PUT", resolvedUrl)
      xhr.setRequestHeader("Content-Type", "video/mp4")
      xhr.setRequestHeader("Authorization", `Bearer ${ownerToken}`)
      const licenseKey = this.getLicenseKey()
      if (licenseKey) {
        xhr.setRequestHeader("X-License-Key", licenseKey)
      }

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) {
          onProgress({
            phase: "uploading",
            bytesUploaded: e.loaded,
            totalBytes,
            percentage: Math.round((e.loaded / e.total) * 100),
          })
        }
      }

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve()
        } else {
          reject(new Error(`Upload failed: HTTP ${xhr.status}`))
        }
      }

      xhr.onerror = () => reject(new Error("Upload failed: network error"))
      xhr.send(new Uint8Array(videoData))
    })
  }

  /**
   * Step 3: Finalize the share after upload completes.
   * Requires ownerToken for authorization.
   */
  async finalizeShare(
    request: FinalizeShareRequest,
    ownerToken: string
  ): Promise<FinalizeShareResponse> {
    const res = await fetch(
      `${this.baseUrl}/api/videos/${request.videoId}/finalize`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${ownerToken}`,
        },
        body: JSON.stringify({
          thumbnailData: request.thumbnailData,
        }),
      }
    )

    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: "Unknown error" }))
      throw new Error(
        (error as { error: string }).error || `HTTP ${res.status}`
      )
    }

    return res.json()
  }

  /**
   * Get video metadata (public — for the player page).
   */
  async getVideo(videoId: string): Promise<SharedVideo> {
    const res = await fetch(`${this.baseUrl}/api/videos/${videoId}`)

    if (!res.ok) {
      throw new Error(`Failed to fetch video: HTTP ${res.status}`)
    }

    return res.json()
  }

  /**
   * Delete a shared video.
   * Requires ownerToken — only the creator can delete.
   */
  async deleteVideo(videoId: string, ownerToken: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/videos/${videoId}`, {
      method: "DELETE",
      headers: { "Authorization": `Bearer ${ownerToken}` },
    })

    if (!res.ok) {
      throw new Error(`Failed to delete video: HTTP ${res.status}`)
    }
  }

  /**
   * Get analytics for a video.
   * Requires ownerToken — only the creator can view detailed analytics.
   */
  async getAnalytics(videoId: string, ownerToken: string): Promise<unknown> {
    const res = await fetch(
      `${this.baseUrl}/api/videos/${videoId}/analytics`,
      {
        headers: { "Authorization": `Bearer ${ownerToken}` },
      }
    )

    if (!res.ok) {
      throw new Error(`Failed to fetch analytics: HTTP ${res.status}`)
    }

    return res.json()
  }
}

// No singleton — instantiated by TauriPlatform and accessed via usePlatform().share

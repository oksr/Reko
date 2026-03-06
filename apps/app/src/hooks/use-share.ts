import { useState, useCallback } from "react"
import { usePlatform } from "@/platform/PlatformContext"
import {
  DEFAULT_SHARE_SETTINGS,
  type ShareSettings,
  type ShareUploadProgress,
} from "@/types/sharing"

interface UseShareOptions {
  title: string
  durationMs: number
}

interface ShareResult {
  shareUrl: string
  videoId: string
  ownerToken: string // stored locally for management operations
}

export function useShare() {
  const platform = usePlatform()
  const [uploadProgress, setUploadProgress] =
    useState<ShareUploadProgress | null>(null)
  const [shareResult, setShareResult] = useState<ShareResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const isUploading =
    uploadProgress !== null &&
    (uploadProgress.phase === "uploading" ||
      uploadProgress.phase === "finalizing")

  /**
   * Upload a video and generate a share link.
   * @param videoData - The exported MP4 file as an ArrayBuffer
   * @param options - Video metadata
   * @param settings - Share settings (comments, download, badge)
   */
  const startShare = useCallback(
    async (
      videoData: ArrayBuffer,
      options: UseShareOptions,
      settings: ShareSettings = DEFAULT_SHARE_SETTINGS
    ) => {
      setError(null)
      setShareResult(null)
      setUploadProgress({
        phase: "uploading",
        bytesUploaded: 0,
        totalBytes: videoData.byteLength,
        percentage: 0,
      })

      try {
        // Step 1: Create video record and get upload URL + ownerToken
        const { videoId, ownerToken, uploadUrl, shareUrl } = await platform.share.createShare({
          title: options.title,
          fileSizeBytes: videoData.byteLength,
          durationMs: options.durationMs,
          contentType: "video/mp4",
          settings,
        })

        // Step 2: Upload video data with progress tracking
        await platform.share.uploadVideo(uploadUrl, videoData, ownerToken, setUploadProgress)

        // Step 3: Finalize (requires ownerToken)
        setUploadProgress({
          phase: "finalizing",
          bytesUploaded: videoData.byteLength,
          totalBytes: videoData.byteLength,
          percentage: 100,
        })

        await platform.share.finalizeShare({ videoId }, ownerToken)

        // Done
        setUploadProgress({
          phase: "done",
          bytesUploaded: videoData.byteLength,
          totalBytes: videoData.byteLength,
          percentage: 100,
        })

        const result = { shareUrl, videoId, ownerToken }
        setShareResult(result)
        return result
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Share failed"
        setError(message)
        setUploadProgress({
          phase: "error",
          bytesUploaded: 0,
          totalBytes: videoData.byteLength,
          percentage: 0,
        })
        throw err
      }
    },
    [platform]
  )

  const reset = useCallback(() => {
    setUploadProgress(null)
    setShareResult(null)
    setError(null)
  }, [])

  return {
    uploadProgress,
    shareResult,
    error,
    isUploading,
    startShare,
    reset,
  }
}

import { useEffect, useRef, useState } from "react"

export function CameraPreviewApp() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [stream, setStream] = useState<MediaStream | null>(null)

  // Read camera name from URL search params (AVFoundation IDs differ from WebRTC IDs,
  // so we match by name instead)
  const cameraName = new URLSearchParams(window.location.search).get("cameraName")

  useEffect(() => {
    if (!cameraName) return

    let active = true
    let mediaStream: MediaStream | null = null

    async function startPreview() {
      try {
        // First get a temporary stream to trigger permission and populate enumerateDevices
        const tempStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
        if (!active) {
          tempStream.getTracks().forEach((t) => t.stop())
          return
        }

        // Find the browser device ID that matches the AVFoundation camera name
        const devices = await navigator.mediaDevices.enumerateDevices()
        const match = devices.find(
          (d) => d.kind === "videoinput" && d.label === cameraName
        )

        // Stop temp stream before opening the real one
        tempStream.getTracks().forEach((t) => t.stop())

        const constraints: MediaStreamConstraints = {
          video: match ? { deviceId: { exact: match.deviceId } } : true,
          audio: false,
        }

        const s = await navigator.mediaDevices.getUserMedia(constraints)
        if (!active) {
          s.getTracks().forEach((t) => t.stop())
          return
        }
        mediaStream = s
        setStream(s)
        if (videoRef.current) {
          videoRef.current.srcObject = s
        }
      } catch (err) {
        console.error("Camera preview failed:", err)
      }
    }

    startPreview()

    return () => {
      active = false
      mediaStream?.getTracks().forEach((t) => t.stop())
    }
  }, [cameraName])

  // Sync stream to video element when ref mounts
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream
    }
  }, [stream])

  return (
    <div className="camera-preview-window">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="camera-preview-video"
      />
    </div>
  )
}

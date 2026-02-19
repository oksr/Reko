import { BackgroundPanel } from "./background-panel"
import { CameraPanel } from "./camera-panel"
import { CursorPanel } from "./cursor-panel"
import { FramePanel } from "./frame-panel"
import { ZoomPanel } from "./zoom-panel"

export function Inspector() {
  return (
    <div className="space-y-1">
      <BackgroundPanel />
      <div className="border-t border-white/[0.06]" />
      <FramePanel />
      <div className="border-t border-white/[0.06]" />
      <CameraPanel />
      <div className="border-t border-white/[0.06]" />
      <CursorPanel />
      <div className="border-t border-white/[0.06]" />
      <ZoomPanel />
    </div>
  )
}

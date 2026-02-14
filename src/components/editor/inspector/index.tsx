import { Separator } from "@/components/ui/separator"
import { BackgroundPanel } from "./background-panel"
import { CameraPanel } from "./camera-panel"
import { CursorPanel } from "./cursor-panel"
import { FramePanel } from "./frame-panel"
import { ZoomPanel } from "./zoom-panel"

export function Inspector() {
  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold">Inspector</h2>
      <BackgroundPanel />
      <Separator />
      <FramePanel />
      <Separator />
      <CameraPanel />
      <Separator />
      <CursorPanel />
      <Separator />
      <ZoomPanel />
    </div>
  )
}

import { useState } from "react"
import { Image, SquareDashed, Video, MousePointer2, ZoomIn } from "lucide-react"
import { BackgroundPanel } from "./background-panel"
import { CameraPanel } from "./camera-panel"
import { CursorPanel } from "./cursor-panel"
import { FramePanel } from "./frame-panel"
import { ZoomPanel } from "./zoom-panel"

type TabId = "background" | "frame" | "camera" | "cursor" | "zoom"

const TABS: { id: TabId; icon: React.ElementType; label: string }[] = [
  { id: "background", icon: Image,         label: "Background" },
  { id: "frame",      icon: SquareDashed,  label: "Frame"      },
  { id: "camera",     icon: Video,         label: "Camera"     },
  { id: "cursor",     icon: MousePointer2, label: "Cursor"     },
  { id: "zoom",       icon: ZoomIn,        label: "Zoom"       },
]

export function Inspector() {
  const [activeTab, setActiveTab] = useState<TabId>("background")

  return (
    <div
      className="m-3 flex flex-col rounded-2xl bg-transparent overflow-hidden shadow-2xl"
      style={{ height: "calc(100% - 24px)" }}
    >
      <div className="flex flex-1 min-h-0">
        {/* Icon tab column */}
        <div className="w-10 flex flex-col items-center pt-3 gap-1 border-r border-white/[0.06] shrink-0">
          {TABS.map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              title={label}
              onClick={() => setActiveTab(id)}
              className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${
                activeTab === id
                  ? "bg-white/[0.12] text-white"
                  : "text-white/30 hover:text-white/60 hover:bg-white/[0.06]"
              }`}
            >
              <Icon className="w-[15px] h-[15px]" />
            </button>
          ))}
        </div>

        {/* Panel content — fade transition on tab switch */}
        <div key={activeTab} className="flex-1 min-w-0 overflow-y-auto animate-fade-in">
          {activeTab === "background" && <BackgroundPanel />}
          {activeTab === "frame"      && <FramePanel />}
          {activeTab === "camera"     && <CameraPanel />}
          {activeTab === "cursor"     && <CursorPanel />}
          {activeTab === "zoom"       && <ZoomPanel />}
        </div>
      </div>
    </div>
  )
}

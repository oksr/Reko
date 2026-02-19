import { Monitor, AppWindow } from "lucide-react"

export type SourceType = "display" | "window"

interface Props {
  sourceType: SourceType
  onSourceTypeChange: (type: SourceType) => void
}

export function SourceTypeButton({ sourceType, onSourceTypeChange }: Props) {
  return (
    <div
      className="flex rounded-lg p-0.5"
      style={{ background: "rgba(255, 255, 255, 0.05)" }}
      role="radiogroup"
      aria-label="Capture source"
    >
      <button
        className={`toolbar-btn ${sourceType === "display" ? "active" : ""}`}
        role="radio"
        aria-checked={sourceType === "display"}
        onClick={() => onSourceTypeChange("display")}
      >
        <Monitor size={20} strokeWidth={2} />
        <span style={{ fontSize: 10, fontWeight: 500, opacity: 0.6 }}>Display</span>
      </button>
      <button
        className={`toolbar-btn ${sourceType === "window" ? "active" : ""}`}
        role="radio"
        aria-checked={sourceType === "window"}
        onClick={() => onSourceTypeChange("window")}
      >
        <AppWindow size={20} strokeWidth={2} />
        <span style={{ fontSize: 10, fontWeight: 500, opacity: 0.6 }}>Window</span>
      </button>
    </div>
  )
}

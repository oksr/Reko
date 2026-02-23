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
        className={`toolbar-btn ${sourceType === "display" ? "active" : "input-toggle-off"}`}
        role="radio"
        aria-checked={sourceType === "display"}
        onClick={() => onSourceTypeChange("display")}
        title="Display"
      >
        <Monitor size={16} strokeWidth={2} />
        {sourceType === "display" && <span style={{ fontSize: 12, fontWeight: 500 }}>Display</span>}
      </button>
      <button
        className={`toolbar-btn ${sourceType === "window" ? "active" : "input-toggle-off"}`}
        role="radio"
        aria-checked={sourceType === "window"}
        onClick={() => onSourceTypeChange("window")}
        title="Window"
      >
        <AppWindow size={16} strokeWidth={2} />
        {sourceType === "window" && <span style={{ fontSize: 12, fontWeight: 500 }}>Window</span>}
      </button>
    </div>
  )
}

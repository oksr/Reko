import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { RecordingTimer } from "@/components/recording/recording-timer"

describe("RecordingTimer", () => {
  it("renders nothing when not recording", () => {
    const { container } = render(<RecordingTimer isRecording={false} isPaused={false} />)
    expect(container.firstChild).toBeNull()
  })

  it("renders timer badge when recording", () => {
    render(<RecordingTimer isRecording={true} isPaused={false} />)
    expect(screen.getByText("00:00")).toBeInTheDocument()
  })
})

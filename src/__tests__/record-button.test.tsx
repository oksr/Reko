import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { RecordButton } from "@/components/recording/record-button"

describe("RecordButton", () => {
  const noop = () => {}

  it("shows Start Recording when not recording", () => {
    render(
      <RecordButton
        isRecording={false} isPaused={false}
        onStart={noop} onStop={noop} onPause={noop} onResume={noop}
        disabled={false}
      />
    )
    expect(screen.getByText("Start Recording")).toBeInTheDocument()
  })

  it("shows Stop and Pause when recording", () => {
    render(
      <RecordButton
        isRecording={true} isPaused={false}
        onStart={noop} onStop={noop} onPause={noop} onResume={noop}
        disabled={false}
      />
    )
    expect(screen.getByText("Stop")).toBeInTheDocument()
    expect(screen.getByText("Pause")).toBeInTheDocument()
  })

  it("shows Resume instead of Pause when paused", () => {
    render(
      <RecordButton
        isRecording={true} isPaused={true}
        onStart={noop} onStop={noop} onPause={noop} onResume={noop}
        disabled={false}
      />
    )
    expect(screen.getByText("Stop")).toBeInTheDocument()
    expect(screen.getByText("Resume")).toBeInTheDocument()
    expect(screen.queryByText("Pause")).not.toBeInTheDocument()
  })
})

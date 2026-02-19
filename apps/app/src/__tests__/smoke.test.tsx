import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { RecordButton } from "@/components/recording/record-button"

const noop = () => {}

describe("RecordButton", () => {
  it("renders Start Recording when not recording", () => {
    render(
      <RecordButton
        isRecording={false} isPaused={false}
        onStart={noop} onStop={noop} onPause={noop} onResume={noop}
        disabled={false}
      />
    )
    expect(screen.getByText("Start Recording")).toBeInTheDocument()
  })

  it("renders Stop when recording", () => {
    render(
      <RecordButton
        isRecording={true} isPaused={false}
        onStart={noop} onStop={noop} onPause={noop} onResume={noop}
        disabled={false}
      />
    )
    expect(screen.getByText("Stop")).toBeInTheDocument()
  })
})

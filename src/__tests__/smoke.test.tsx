import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { RecordButton } from "@/components/recording/record-button"

describe("RecordButton", () => {
  it("renders Start Recording when not recording", () => {
    render(
      <RecordButton isRecording={false} onStart={() => {}} onStop={() => {}} disabled={false} />
    )
    expect(screen.getByText("Start Recording")).toBeInTheDocument()
  })

  it("renders Stop Recording when recording", () => {
    render(
      <RecordButton isRecording={true} onStart={() => {}} onStop={() => {}} disabled={false} />
    )
    expect(screen.getByText("Stop Recording")).toBeInTheDocument()
  })
})

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { invoke } from "@tauri-apps/api/core"
import { AudioLevelMeter } from "@/components/recording/audio-level-meter"

const mockedInvoke = vi.mocked(invoke)

beforeEach(() => {
  mockedInvoke.mockReset()
  mockedInvoke.mockResolvedValue({ mic_level: 0.5, system_audio_level: 0.3 })
})

describe("AudioLevelMeter", () => {
  it("renders nothing when not recording", () => {
    const { container } = render(<AudioLevelMeter isRecording={false} isPaused={false} />)
    expect(container.firstChild).toBeNull()
  })

  it("renders mic and system labels when recording", async () => {
    render(<AudioLevelMeter isRecording={true} isPaused={false} />)
    expect(screen.getByText("Mic")).toBeInTheDocument()
    expect(screen.getByText("System")).toBeInTheDocument()
  })
})

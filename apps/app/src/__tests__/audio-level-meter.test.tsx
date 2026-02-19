import { describe, it, expect, vi, beforeEach } from "vitest"
import { screen } from "@testing-library/react"
import { AudioLevelMeter } from "@/components/recording/audio-level-meter"
import { renderWithPlatform } from "./render-with-platform"
import { createMockPlatform } from "./mock-platform"

describe("AudioLevelMeter", () => {
  let platform: ReturnType<typeof createMockPlatform>

  beforeEach(() => {
    platform = createMockPlatform()
    vi.mocked(platform.invoke).mockResolvedValue({ mic_level: 0.5, system_audio_level: 0.3 })
  })

  it("renders nothing when not recording", () => {
    const { container } = renderWithPlatform(
      <AudioLevelMeter isRecording={false} isPaused={false} />,
      platform
    )
    expect(container.firstChild).toBeNull()
  })

  it("renders mic and system labels when recording", async () => {
    renderWithPlatform(
      <AudioLevelMeter isRecording={true} isPaused={false} />,
      platform
    )
    expect(screen.getByText("Mic")).toBeInTheDocument()
    expect(screen.getByText("System")).toBeInTheDocument()
  })
})

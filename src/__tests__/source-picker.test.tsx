import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { invoke } from "@tauri-apps/api/core"
import { SourcePicker } from "@/components/recording/source-picker"

const mockedInvoke = vi.mocked(invoke)

beforeEach(() => {
  mockedInvoke.mockReset()
  mockedInvoke.mockImplementation(async (cmd: string) => {
    if (cmd === "list_displays") return [{ id: 1, width: 1920, height: 1080, is_main: true }]
    if (cmd === "list_audio_inputs") return [{ id: "mic-1", name: "Built-in Mic" }]
    if (cmd === "list_cameras") return [{ id: "cam-1", name: "FaceTime HD" }]
    return null
  })
})

describe("SourcePicker", () => {
  it("renders camera select dropdown", async () => {
    render(
      <SourcePicker
        onDisplaySelected={() => {}}
        selectedDisplayId={1}
        onMicSelected={() => {}}
        selectedMicId={null}
        onCameraSelected={() => {}}
        selectedCameraId={null}
      />
    )
    await waitFor(() => {
      expect(screen.getByText("Camera")).toBeInTheDocument()
    })
  })

  it("calls list_cameras on mount", async () => {
    render(
      <SourcePicker
        onDisplaySelected={() => {}}
        selectedDisplayId={null}
        onMicSelected={() => {}}
        selectedMicId={null}
        onCameraSelected={() => {}}
        selectedCameraId={null}
      />
    )
    await waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith("list_cameras")
    })
  })
})

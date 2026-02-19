import { describe, it, expect, vi } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { useVideoSync } from "@/hooks/use-video-sync"

function createMockVideo(currentTime = 0): HTMLVideoElement {
  const video = {
    currentTime,
    paused: true,
    play: vi.fn().mockImplementation(function(this: any) {
      this.paused = false
      return Promise.resolve()
    }),
    pause: vi.fn().mockImplementation(function(this: any) {
      this.paused = true
    }),
  } as unknown as HTMLVideoElement
  return video
}

describe("useVideoSync", () => {
  it("registers and unregisters videos", () => {
    const { result } = renderHook(() => useVideoSync())
    const video = createMockVideo()

    act(() => result.current.register(video))
    act(() => result.current.unregister(video))
  })

  it("seek sets currentTime on all registered videos", () => {
    const onTimeUpdate = vi.fn()
    const { result } = renderHook(() => useVideoSync({ onTimeUpdate }))
    const video1 = createMockVideo()
    const video2 = createMockVideo()

    act(() => {
      result.current.register(video1)
      result.current.register(video2)
    })

    act(() => result.current.seek(5000))
    expect(video1.currentTime).toBe(5)
    expect(video2.currentTime).toBe(5)
    expect(onTimeUpdate).toHaveBeenCalledWith(5000)
  })

  it("pause pauses all videos", () => {
    const { result } = renderHook(() => useVideoSync())
    const video = createMockVideo()

    act(() => result.current.register(video))
    act(() => result.current.pause())
    expect(video.pause).toHaveBeenCalled()
  })

  it("does not register null", () => {
    const { result } = renderHook(() => useVideoSync())
    act(() => result.current.register(null))
    // Should not throw
    expect(result.current.getCurrentTime()).toBe(0)
  })

  it("does not register same video twice", () => {
    const { result } = renderHook(() => useVideoSync())
    const video = createMockVideo(3)

    act(() => {
      result.current.register(video)
      result.current.register(video)
    })

    act(() => result.current.pause())
    // pause should only be called once per unique video
    expect(video.pause).toHaveBeenCalledTimes(1)
  })

  it("getCurrentTime returns primary video time in ms", () => {
    const { result } = renderHook(() => useVideoSync())
    const video = createMockVideo(2.5)

    act(() => result.current.register(video))
    expect(result.current.getCurrentTime()).toBe(2500)
  })
})

import React from "react"
import { render, renderHook } from "@testing-library/react"
import type { RenderOptions, RenderHookOptions } from "@testing-library/react"
import { PlatformProvider } from "@/platform/PlatformContext"
import { createMockPlatform } from "./mock-platform"
import type { Platform } from "@/platform/types"

function makePlatformWrapper(platform: Platform) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <PlatformProvider platform={platform}>{children}</PlatformProvider>
  }
}

export function renderWithPlatform(
  ui: React.ReactElement,
  platform?: Platform,
  options?: Omit<RenderOptions, "wrapper">
) {
  const p = platform ?? createMockPlatform()
  return {
    platform: p,
    ...render(ui, { wrapper: makePlatformWrapper(p), ...options }),
  }
}

export function renderHookWithPlatform<T>(
  hook: () => T,
  platform?: Platform,
  options?: Omit<RenderHookOptions<undefined>, "wrapper">
) {
  const p = platform ?? createMockPlatform()
  return {
    platform: p,
    ...renderHook(hook, { wrapper: makePlatformWrapper(p), ...options }),
  }
}

import { vi } from "vitest"
import type { Platform } from "@/platform/types"

export function createMockPlatform(overrides?: Partial<Platform>): Platform {
  return {
    invoke: vi.fn().mockResolvedValue(undefined),
    isTauri: false,
    window: {
      getLabel: vi.fn().mockReturnValue("recorder"),
      close: vi.fn().mockResolvedValue(undefined),
      show: vi.fn().mockResolvedValue(undefined),
      hide: vi.fn().mockResolvedValue(undefined),
      setSize: vi.fn().mockResolvedValue(undefined),
      setPosition: vi.fn().mockResolvedValue(undefined),
      setResizable: vi.fn().mockResolvedValue(undefined),
      setAlwaysOnTop: vi.fn().mockResolvedValue(undefined),
      center: vi.fn().mockResolvedValue(undefined),
      startDragging: vi.fn(),
      listen: vi.fn().mockResolvedValue(() => {}),
    },
    navigation: {
      openWindow: vi.fn().mockResolvedValue(undefined),
      closeWindow: vi.fn().mockResolvedValue(undefined),
    },
    filesystem: {
      assetUrl: vi.fn().mockImplementation((p: string) => `/__asset__${p}`),
      saveDialog: vi.fn().mockResolvedValue(null),
      openDialog: vi.fn().mockResolvedValue(null),
    },
    events: {
      emitTo: vi.fn().mockResolvedValue(undefined),
      listen: vi.fn().mockResolvedValue(() => {}),
    },
    shortcuts: {
      register: vi.fn().mockResolvedValue(undefined),
      unregister: vi.fn().mockResolvedValue(undefined),
    },
    monitor: {
      getCurrent: vi.fn().mockResolvedValue(null),
    },
    menu: {
      showDropdown: vi.fn().mockResolvedValue(undefined),
    },
    ...overrides,
  }
}

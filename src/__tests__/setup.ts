import "@testing-library/jest-dom/vitest"
import { vi } from "vitest"

// Mock Tauri IPC — tests override invoke per-test via vi.mocked()
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(null),
}))

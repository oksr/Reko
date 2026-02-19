// All Tauri-specific functionality is accessed through this interface.
// app/ components use usePlatform() — never import @tauri-apps directly.

export interface WindowInfo {
  label: string
}

export interface MonitorInfo {
  scaleFactor: number
  size: { width: number; height: number }
  position: { x: number; y: number }
}

export interface WindowOptions {
  url: string
  label: string
  title?: string
  width?: number
  height?: number
  decorations?: boolean
  transparent?: boolean
  alwaysOnTop?: boolean
  resizable?: boolean
  shadow?: boolean
  visible?: boolean
}

export interface SaveDialogOptions {
  defaultPath?: string
  filters?: Array<{ name: string; extensions: string[] }>
}

export interface OpenDialogOptions {
  multiple?: boolean
  directory?: boolean
  filters?: Array<{ name: string; extensions: string[] }>
}

export interface MenuItemDef {
  type: "item" | "separator" | "check"
  text?: string
  checked?: boolean
  action?: () => void
}

export interface PlatformWindow {
  /** Label of the current window (e.g. "recorder", "editor-abc123") */
  getLabel(): string
  close(): Promise<void>
  show(): Promise<void>
  hide(): Promise<void>
  setSize(width: number, height: number): Promise<void>
  setPosition(x: number, y: number): Promise<void>
  setResizable(value: boolean): Promise<void>
  setAlwaysOnTop(value: boolean): Promise<void>
  center(): Promise<void>
  startDragging(): void
  listen<T>(event: string, handler: (payload: T) => void): Promise<() => void>
}

export interface PlatformNavigation {
  /** Open a new Tauri window (or navigate in web context) */
  openWindow(options: WindowOptions): Promise<void>
  /** Close a specific window by label */
  closeWindow(label: string): Promise<void>
}

export interface PlatformFilesystem {
  /** Convert a local filesystem path to a URL usable in <img src> / <video src> */
  assetUrl(path: string): string
  saveDialog(options?: SaveDialogOptions): Promise<string | null>
  openDialog(options?: OpenDialogOptions): Promise<string | string[] | null>
}

export interface PlatformEvents {
  emitTo(target: string, event: string, payload?: unknown): Promise<void>
  listen<T>(event: string, handler: (payload: T) => void): Promise<() => void>
}

export interface PlatformShortcuts {
  register(shortcut: string, handler: () => void): Promise<void>
  unregister(shortcut: string): Promise<void>
}

export interface PlatformMonitor {
  getCurrent(): Promise<MonitorInfo | null>
}

export interface PlatformMenu {
  /** Show a context/dropdown menu at the cursor */
  showDropdown(items: MenuItemDef[]): Promise<void>
}

export interface Platform {
  /** Raw IPC invoke — use for all backend commands */
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>

  window: PlatformWindow
  navigation: PlatformNavigation
  filesystem: PlatformFilesystem
  events: PlatformEvents
  shortcuts: PlatformShortcuts
  monitor: PlatformMonitor
  menu: PlatformMenu

  /** True when running inside Tauri desktop app */
  isTauri: boolean
}

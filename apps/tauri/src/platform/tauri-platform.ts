import { invoke } from "@tauri-apps/api/core"
import { getCurrentWindow, LogicalSize, LogicalPosition } from "@tauri-apps/api/window"
import { WebviewWindow } from "@tauri-apps/api/webviewWindow"
import { convertFileSrc } from "@tauri-apps/api/core"
import { save, open } from "@tauri-apps/plugin-dialog"
import { emitTo } from "@tauri-apps/api/event"
import { register, unregister } from "@tauri-apps/plugin-global-shortcut"
import { currentMonitor } from "@tauri-apps/api/window"
import { Menu, MenuItem, PredefinedMenuItem } from "@tauri-apps/api/menu"
import type {
  Platform,
  PlatformWindow,
  PlatformNavigation,
  PlatformFilesystem,
  PlatformEvents,
  PlatformShortcuts,
  PlatformMonitor,
  PlatformMenu,
  PlatformShare,
  WindowOptions,
  SaveDialogOptions,
  OpenDialogOptions,
  MenuItemDef,
} from "@app/platform/types"
import { ShareApiClient } from "@app/lib/share-api"

const tauriWindow: PlatformWindow = {
  getLabel() {
    return getCurrentWindow().label
  },
  async close() {
    await getCurrentWindow().close()
  },
  async show() {
    await getCurrentWindow().show()
  },
  async hide() {
    await getCurrentWindow().hide()
  },
  async setSize(width, height) {
    await getCurrentWindow().setSize(new LogicalSize(width, height))
  },
  async setPosition(x, y) {
    await getCurrentWindow().setPosition(new LogicalPosition(x, y))
  },
  async setResizable(value) {
    await getCurrentWindow().setResizable(value)
  },
  async setAlwaysOnTop(value) {
    await getCurrentWindow().setAlwaysOnTop(value)
  },
  async center() {
    await getCurrentWindow().center()
  },
  startDragging() {
    getCurrentWindow().startDragging().catch(() => {})
  },
  async listen(event, handler) {
    const unlisten = await getCurrentWindow().listen(event, (e) => handler(e.payload as any))
    return unlisten
  },
}

const tauriNavigation: PlatformNavigation = {
  async openWindow(options: WindowOptions) {
    const win = new WebviewWindow(options.label, {
      url: options.url,
      title: options.title,
      x: options.x,
      y: options.y,
      width: options.width,
      height: options.height,
      decorations: options.decorations,
      transparent: options.transparent,
      alwaysOnTop: options.alwaysOnTop,
      resizable: options.resizable,
      shadow: options.shadow,
      visible: options.visible,
    })
    await new Promise<void>((resolve, reject) => {
      win.once("tauri://created", () => resolve())
      win.once("tauri://error", (e) => reject(new Error(String(e.payload))))
    })
  },
  async closeWindow(label: string) {
    const win = await WebviewWindow.getByLabel(label)
    await win?.close()
  },
  async showWindow(label: string) {
    const win = await WebviewWindow.getByLabel(label)
    await win?.show()
  },
}

const tauriFilesystem: PlatformFilesystem = {
  assetUrl(path: string) {
    if (path.startsWith("/__asset__/")) return path // already prefixed
    if (import.meta.env.DEV) return `/__asset__${path}` // dev: serve via Vite middleware
    return convertFileSrc(path)
  },
  async saveDialog(options?: SaveDialogOptions) {
    return await save(options)
  },
  async openDialog(options?: OpenDialogOptions) {
    return await open(options)
  },
}

const tauriEvents: PlatformEvents = {
  async emitTo(target, event, payload) {
    await emitTo(target, event, payload)
  },
  async listen(event, handler) {
    const { listen } = await import("@tauri-apps/api/event")
    const unlisten = await listen(event, (e) => handler(e.payload as any))
    return unlisten
  },
}

const tauriShortcuts: PlatformShortcuts = {
  async register(shortcut, handler) {
    await register(shortcut, handler)
  },
  async unregister(shortcut) {
    await unregister(shortcut)
  },
}

const tauriMonitor: PlatformMonitor = {
  async getCurrent() {
    const monitor = await currentMonitor()
    if (!monitor) return null
    return {
      scaleFactor: monitor.scaleFactor,
      size: { width: monitor.size.width, height: monitor.size.height },
      position: { x: monitor.position.x, y: monitor.position.y },
    }
  },
}

const tauriMenu: PlatformMenu = {
  async showDropdown(items: MenuItemDef[]) {
    const menuItems = await Promise.all(
      items.map(async (item) => {
        if (item.type === "separator") return PredefinedMenuItem.new({ item: "Separator" })
        return MenuItem.new({
          text: item.text ?? "",
          action: item.action,
        })
      })
    )
    const menu = await Menu.new({ items: menuItems })
    await menu.popup()
  },
}

const shareClient = new ShareApiClient()

const tauriShare: PlatformShare = {
  createShare: (request) => shareClient.createShare(request),
  uploadVideo: (uploadUrl, videoData, ownerToken, onProgress) => shareClient.uploadVideo(uploadUrl, videoData, ownerToken, onProgress),
  finalizeShare: (request, ownerToken) => shareClient.finalizeShare(request, ownerToken),
  getVideo: (videoId) => shareClient.getVideo(videoId),
  deleteVideo: (videoId, ownerToken) => shareClient.deleteVideo(videoId, ownerToken),
  getAnalytics: (videoId, ownerToken) => shareClient.getAnalytics(videoId, ownerToken),
}

export const tauriPlatform: Platform = {
  invoke: invoke as Platform["invoke"],
  window: tauriWindow,
  navigation: tauriNavigation,
  filesystem: tauriFilesystem,
  events: tauriEvents,
  shortcuts: tauriShortcuts,
  monitor: tauriMonitor,
  menu: tauriMenu,
  share: tauriShare,
  isTauri: true,
}

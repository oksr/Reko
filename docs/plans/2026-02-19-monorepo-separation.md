# Monorepo Hard Separation of Concerns

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Restructure Reko into a monorepo where `app/` (React UI) has zero `@tauri-apps` imports, enabling browser-based testing and future web deployment.

**Architecture:** Move frontend to `app/`, keep Tauri shell at `tauri/` (containing `src-tauri/`). Introduce a `Platform` interface injected via React context — Tauri implementation lives in `tauri/`, the `app/` package stays platform-agnostic. pnpm workspaces tie the packages together.

**Tech Stack:** pnpm workspaces, React Context, TypeScript interfaces, Vite (per-package configs), existing Tauri v2 + Rust stack unchanged.

---

## Target Directory Structure

```
reko/
├── app/                    # Pure React UI — ZERO @tauri-apps imports
│   ├── src/
│   │   ├── platform/
│   │   │   ├── types.ts         # Platform interface definitions
│   │   │   └── PlatformContext.tsx
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── lib/
│   │   ├── stores/
│   │   ├── types/
│   │   ├── __tests__/
│   │   └── main.tsx             # No Tauri imports — uses usePlatform()
│   ├── package.json             # No @tauri-apps deps
│   ├── vite.config.ts
│   ├── tsconfig.json
│   └── index.html
├── tauri/                  # Tauri shell — wires platform implementation
│   ├── src/
│   │   ├── platform/
│   │   │   └── tauri-platform.ts   # Implements Platform interface
│   │   └── main.tsx                # Injects TauriPlatform, renders app Root
│   ├── src-tauri/               # (moved from root)
│   ├── index.html
│   ├── package.json             # Has @tauri-apps deps
│   └── vite.config.ts
├── RekoEngine/             # Swift — untouched
├── docs/
├── package.json            # Workspace root (private, no deps)
├── pnpm-workspace.yaml     # pnpm workspace config
└── CLAUDE.md
```

---

## Task 1: Set Up pnpm Workspace Root

**Files:**
- Modify: `package.json` (root — becomes workspace root)
- Create: `pnpm-workspace.yaml`

**Step 1: Install pnpm (if not already)**

```bash
npm install -g pnpm
pnpm --version
# Expected: 9.x or higher
```

**Step 2: Replace root `package.json` with workspace root config**

No deps here — just scripts that delegate to packages.

```json
{
  "name": "reko-workspace",
  "private": true,
  "scripts": {
    "dev": "pnpm --filter @reko/tauri dev",
    "build": "pnpm --filter @reko/app build && pnpm --filter @reko/tauri build",
    "test": "pnpm --filter @reko/app test",
    "test:watch": "pnpm --filter @reko/app test:watch",
    "lint": "pnpm --filter @reko/app lint",
    "tauri:dev": "pnpm --filter @reko/tauri tauri:dev",
    "tauri:build": "pnpm --filter @reko/tauri tauri:build"
  },
  "engines": {
    "node": ">=20",
    "pnpm": ">=9"
  }
}
```

**Step 3: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - 'app'
  - 'tauri'
```

**Step 4: Delete the old `node_modules` and `package-lock.json`**

```bash
rm -rf node_modules package-lock.json
```

**Step 5: Commit**

```bash
git add package.json pnpm-workspace.yaml
git commit -m "chore: convert root to pnpm workspace"
```

---

## Task 2: Create `app/` Package

**Files:**
- Create: `app/package.json`
- Create: `app/tsconfig.json`
- Create: `app/tsconfig.node.json`
- Create: `app/vite.config.ts`
- Create: `app/index.html`

**Step 1: Create `app/package.json`**

No `@tauri-apps` deps — this package must stay Tauri-free.

```json
{
  "name": "@reko/app",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "lint": "eslint .",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@base-ui/react": "^1.2.0",
    "@fontsource-variable/inter": "^5.2.8",
    "@tailwindcss/vite": "^4.1.17",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "lucide-react": "^0.563.0",
    "mime-types": "^3.0.2",
    "motion": "^12.34.0",
    "mp4-muxer": "^5.2.2",
    "mp4box": "^2.3.0",
    "radix-ui": "^1.4.3",
    "react": "^19.2.0",
    "react-dom": "^19.2.0",
    "shadcn": "^3.8.4",
    "tailwind-merge": "^3.4.0",
    "tailwindcss": "^4.1.17",
    "tw-animate-css": "^1.4.0",
    "zundo": "^2.3.0",
    "zustand": "^5.0.11"
  },
  "devDependencies": {
    "@eslint/js": "^9.39.1",
    "@testing-library/jest-dom": "^6.9.1",
    "@testing-library/react": "^16.3.2",
    "@testing-library/user-event": "^14.6.1",
    "@types/mime-types": "^3.0.1",
    "@types/node": "^24.10.1",
    "@types/react": "^19.2.5",
    "@types/react-dom": "^19.2.3",
    "@vitejs/plugin-react": "^5.1.1",
    "eslint": "^9.39.1",
    "eslint-plugin-react-hooks": "^7.0.1",
    "eslint-plugin-react-refresh": "^0.4.20",
    "globals": "^16.5.0",
    "jsdom": "^28.0.0",
    "typescript": "~5.9.3",
    "typescript-eslint": "^8.46.4",
    "vite": "^7.2.4",
    "vite-plugin-glsl": "^1.5.5",
    "vitest": "^4.0.18"
  }
}
```

**Step 2: Create `app/vite.config.ts`**

Path alias changes: `@/` maps to `app/src/`.

```typescript
import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"
import glsl from "vite-plugin-glsl"

export default defineConfig({
  plugins: [react(), tailwindcss(), glsl()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/__tests__/setup.ts"],
  },
})
```

Note: The `serveLocalAssets` plugin moves to `tauri/vite.config.ts` since it's only needed when running inside Tauri dev mode.

**Step 3: Create `app/tsconfig.json`**

```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" }
  ]
}
```

**Step 4: Create `app/tsconfig.app.json`** (rename of existing `tsconfig.json` app portion)

```json
{
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.app.tsbuildinfo",
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedSideEffectImports": true,
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src"]
}
```

**Step 5: Create `app/index.html`**

Copy from root `index.html`, entry point stays `./src/main.tsx`.

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/vite.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Reko</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./src/main.tsx"></script>
  </body>
</html>
```

**Step 6: Move `src/` to `app/src/`**

```bash
mkdir -p app
mv src app/src
mv index.html app/index.html
# Do NOT move vite.config.ts / tsconfig.json yet — replaced with new ones above
```

**Step 7: Verify directory structure**

```bash
ls app/src/
# Expected: __tests__  assets  components  hooks  lib  main.tsx  stores  types  ...
```

**Step 8: Commit**

```bash
git add app/
git add -u src/  # stage deletions
git commit -m "chore: move frontend to app/ package"
```

---

## Task 3: Define the Platform Interface

**Files:**
- Create: `app/src/platform/types.ts`
- Create: `app/src/platform/PlatformContext.tsx`

This is the contract between `app/` and its host. No Tauri imports here — just TypeScript interfaces.

**Step 1: Create `app/src/platform/types.ts`**

```typescript
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
  setAlwaysOnTop(value: boolean): Promise<void>
  center(): Promise<void>
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
```

**Step 2: Create `app/src/platform/PlatformContext.tsx`**

```typescript
import { createContext, useContext, type ReactNode } from "react"
import type { Platform } from "./types"

const PlatformContext = createContext<Platform | null>(null)

export interface PlatformProviderProps {
  platform: Platform
  children: ReactNode
}

export function PlatformProvider({ platform, children }: PlatformProviderProps) {
  return (
    <PlatformContext.Provider value={platform}>
      {children}
    </PlatformContext.Provider>
  )
}

export function usePlatform(): Platform {
  const platform = useContext(PlatformContext)
  if (!platform) {
    throw new Error("usePlatform must be used within a PlatformProvider")
  }
  return platform
}
```

**Step 3: Run tests to ensure nothing broken yet**

```bash
pnpm --filter @reko/app test
# Expected: all existing tests pass (platform not yet used anywhere)
```

**Step 4: Commit**

```bash
git add app/src/platform/
git commit -m "feat(app): add Platform interface and context"
```

---

## Task 4: Create the `tauri/` Package

**Files:**
- Create: `tauri/package.json`
- Create: `tauri/vite.config.ts`
- Create: `tauri/index.html`
- Create: `tauri/tsconfig.json`
- Move: `src-tauri/` → `tauri/src-tauri/`
- Modify: `tauri/src-tauri/tauri.conf.json` (update paths)

**Step 1: Create `tauri/` directory**

```bash
mkdir -p tauri
```

**Step 2: Create `tauri/package.json`**

```json
{
  "name": "@reko/tauri",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "tauri": "tauri",
    "tauri:dev": "tauri dev",
    "tauri:build": "tauri build"
  },
  "dependencies": {
    "@reko/app": "*",
    "@tauri-apps/api": "^2.10.1",
    "@tauri-apps/plugin-dialog": "^2.6.0",
    "@tauri-apps/plugin-global-shortcut": "^2.3.1",
    "react": "^19.2.0",
    "react-dom": "^19.2.0"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2.10.0",
    "@types/node": "^24.10.1",
    "@types/react": "^19.2.5",
    "@types/react-dom": "^19.2.3",
    "@vitejs/plugin-react": "^5.1.1",
    "mime-types": "^3.0.2",
    "typescript": "~5.9.3",
    "vite": "^7.2.4"
  }
}
```

**Step 3: Create `tauri/vite.config.ts`**

The `serveLocalAssets` plugin comes here (needed for Tauri dev mode). The `frontendDist` path in `tauri.conf.json` will point to `../app/dist` — but during dev, this Vite serves the tauri shell which imports from `@reko/app`.

```typescript
import path from "path"
import fs from "fs"
import react from "@vitejs/plugin-react"
import { defineConfig, type Plugin } from "vite"
import mime from "mime-types"

function serveLocalAssets(): Plugin {
  return {
    name: "serve-local-assets",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith("/__asset__/")) return next()
        const filePath = decodeURIComponent(req.url.slice("/__asset__".length))
        if (!fs.existsSync(filePath)) {
          res.statusCode = 404
          res.end("Not found")
          return
        }
        const stat = fs.statSync(filePath)
        const contentType = mime.lookup(filePath) || "application/octet-stream"
        const range = req.headers.range
        if (range) {
          const parts = range.replace(/bytes=/, "").split("-")
          const start = parseInt(parts[0], 10)
          const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1
          res.writeHead(206, {
            "Content-Range": `bytes ${start}-${end}/${stat.size}`,
            "Accept-Ranges": "bytes",
            "Content-Length": end - start + 1,
            "Content-Type": contentType,
          })
          fs.createReadStream(filePath, { start, end }).pipe(res)
        } else {
          res.writeHead(200, {
            "Content-Length": stat.size,
            "Content-Type": contentType,
            "Accept-Ranges": "bytes",
          })
          fs.createReadStream(filePath).pipe(res)
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), serveLocalAssets()],
  resolve: {
    alias: {
      // Re-export app's path alias so tauri/ src can import from @reko/app
      "@app": path.resolve(__dirname, "../app/src"),
    },
  },
})
```

**Step 4: Create `tauri/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Reko</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./src/main.tsx"></script>
  </body>
</html>
```

**Step 5: Move `src-tauri/` into `tauri/`**

```bash
mv src-tauri tauri/src-tauri
```

**Step 6: Update `tauri/src-tauri/tauri.conf.json` — fix paths**

Change `build` section:

```json
"build": {
  "beforeDevCommand": "pnpm --filter @reko/tauri dev",
  "devUrl": "http://localhost:5173",
  "beforeBuildCommand": "pnpm --filter @reko/app build && pnpm --filter @reko/tauri build",
  "frontendDist": "../../app/dist"
}
```

(Path is `../../app/dist` because `tauri.conf.json` is inside `tauri/src-tauri/`.)

**Step 7: Update `tauri/src-tauri/build.rs`** — check any path references

Read the file:

```bash
cat tauri/src-tauri/build.rs
```

If it references `../RekoEngine`, update to `../../RekoEngine`.

**Step 8: Verify Cargo.toml swift library path**

```bash
cat tauri/src-tauri/Cargo.toml | grep -E "link|build|path"
```

Update any `../RekoEngine` references to `../../RekoEngine`.

**Step 9: Commit**

```bash
git add tauri/
git add -u src-tauri/  # stage deletions
git commit -m "chore: move src-tauri into tauri/ package"
```

---

## Task 5: Implement `TauriPlatform`

**Files:**
- Create: `tauri/src/platform/tauri-platform.ts`

This is the Tauri implementation of the `Platform` interface. It wraps every `@tauri-apps` API call.

**Step 1: Create `tauri/src/platform/tauri-platform.ts`**

```typescript
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
  WindowOptions,
  SaveDialogOptions,
  OpenDialogOptions,
  MenuItemDef,
} from "@app/platform/types"

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
  async setAlwaysOnTop(value) {
    await getCurrentWindow().setAlwaysOnTop(value)
  },
  async center() {
    await getCurrentWindow().center()
  },
}

const tauriNavigation: PlatformNavigation = {
  async openWindow(options: WindowOptions) {
    const win = new WebviewWindow(options.label, {
      url: options.url,
      title: options.title,
      width: options.width,
      height: options.height,
      decorations: options.decorations,
      transparent: options.transparent,
      alwaysOnTop: options.alwaysOnTop,
      resizable: options.resizable,
      shadow: options.shadow,
      visible: options.visible,
    })
    await win.once("tauri://created", () => {})
  },
  async closeWindow(label: string) {
    const win = await WebviewWindow.getByLabel(label)
    await win?.close()
  },
}

const tauriFilesystem: PlatformFilesystem = {
  assetUrl(path: string) {
    if (path.startsWith("/__asset__/")) return path // dev mode
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
    const unlisten = await listen(event, (e) => handler(e.payload))
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

export const tauriPlatform: Platform = {
  invoke,
  window: tauriWindow,
  navigation: tauriNavigation,
  filesystem: tauriFilesystem,
  events: tauriEvents,
  shortcuts: tauriShortcuts,
  monitor: tauriMonitor,
  menu: tauriMenu,
  isTauri: true,
}
```

**Step 2: Create `tauri/src/main.tsx`** — Tauri entry point

```typescript
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { PlatformProvider } from "@app/platform/PlatformContext"
import { tauriPlatform } from "./platform/tauri-platform"
// Import app CSS from app package
import "@app/../index.css"

// Lazy-import the app's Root — it has no Tauri deps
async function mount() {
  const { Root } = await import("@app/root")
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <PlatformProvider platform={tauriPlatform}>
        <Root />
      </PlatformProvider>
    </StrictMode>
  )
}

mount()
```

**Step 3: Commit**

```bash
git add tauri/src/
git commit -m "feat(tauri): implement TauriPlatform adapter"
```

---

## Task 6: Extract `Root` Component from `app/src/main.tsx`

**Files:**
- Create: `app/src/root.tsx`
- Modify: `app/src/main.tsx`

The `Root` component currently lives in `main.tsx` and uses `getCurrentWindow()` directly. Extract it and replace the Tauri call with `usePlatform()`.

**Step 1: Create `app/src/root.tsx`**

```typescript
import { usePlatform } from "@/platform/PlatformContext"
import { RecorderApp } from "./recorder-app"
import { EditorApp } from "./editor-app"
import { WindowPickerApp } from "./window-picker-app"
import { OnboardingApp } from "./onboarding-app"

export function Root() {
  const platform = usePlatform()
  const label = platform.window.getLabel()
  const path = window.location.pathname

  if (label === "onboarding" || path.startsWith("/onboarding")) return <OnboardingApp />
  if (label === "window-picker" || path.startsWith("/window-picker")) return <WindowPickerApp />
  if (label.startsWith("editor") || path.startsWith("/editor")) return <EditorApp />
  return <RecorderApp />
}
```

**Step 2: Update `app/src/main.tsx`** — no Tauri imports

```typescript
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import "./index.css"
import { Root } from "./root"

// In standalone mode (tests/web), inject a no-op platform
// In production, PlatformProvider is injected by tauri/src/main.tsx
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>
)
```

**Step 3: Run tests**

```bash
pnpm --filter @reko/app test 2>&1 | tail -20
# Expected: tests that mock getCurrentWindow will need updating (see Task 8)
```

**Step 4: Commit**

```bash
git add app/src/root.tsx app/src/main.tsx
git commit -m "refactor(app): extract Root component, remove getCurrentWindow import"
```

---

## Task 7: Replace Direct `invoke` Calls in `app/`

`invoke` is called in ~15 files. Replace each with `usePlatform().invoke(...)`.

The files that need changes (from grep):

| File | Tauri imports used |
|------|--------------------|
| `app/src/editor-app.tsx` | `invoke` |
| `app/src/hooks/use-export.ts` | `invoke` |
| `app/src/hooks/use-auto-save.ts` | `invoke` |
| `app/src/components/recording/permission-check.tsx` | `invoke` |
| `app/src/components/recording/recording-bar.tsx` | `invoke` |
| `app/src/components/recording/audio-level-meter.tsx` | `invoke` |
| `app/src/components/recording/window-picker-overlay.tsx` | `invoke` |
| `app/src/components/editor/export-button.tsx` | `invoke`, `save` dialog |
| `app/src/components/editor/inspector/image-background-section.tsx` | `invoke` |
| `app/src/components/editor/inspector/unsplash-background-section.tsx` | `invoke` |
| `app/src/components/editor/inspector/wallpaper-section.tsx` | `invoke` |
| `app/src/components/editor/inspector/zoom-panel.tsx` | `invoke` |
| `app/src/components/editor/inspector/custom-background-section.tsx` | `invoke`, `open` dialog |
| `app/src/onboarding-app.tsx` | `invoke`, `getCurrentWindow`, `WebviewWindow` |
| `app/src/lib/asset-url.ts` | `convertFileSrc` |
| `app/src/recorder-app.tsx` | `invoke`, `getCurrentWindow`, `currentMonitor`, `WebviewWindow`, `register/unregister` |
| `app/src/window-picker-app.tsx` | `getCurrentWindow`, `emitTo` |
| `app/src/components/recording/settings-popover.tsx` | `Menu`, `MenuItem`, `PredefinedMenuItem` |
| `app/src/components/recording/input-toggle.tsx` | `Menu`, `MenuItem`, `PredefinedMenuItem` |

**Strategy:** Do this file-by-file. For each file:
1. Remove `@tauri-apps` imports
2. Add `const platform = usePlatform()` (or accept as prop for non-component files like hooks)
3. Replace `invoke(...)` → `platform.invoke(...)`
4. Replace dialog calls → `platform.filesystem.saveDialog/openDialog`
5. Replace window calls → `platform.window.*`
6. Replace navigation → `platform.navigation.openWindow`

**Step 1: Update `app/src/lib/asset-url.ts`**

Before:
```typescript
import { convertFileSrc } from "@tauri-apps/api/core"
export function assetUrl(path: string): string { ... }
```

After — this utility now needs the platform. Convert to a hook:
```typescript
import { usePlatform } from "@/platform/PlatformContext"

export function useAssetUrl() {
  const platform = usePlatform()
  return (path: string) => platform.filesystem.assetUrl(path)
}
```

**Step 2: Update hooks (`use-export.ts`, `use-auto-save.ts`)**

Add `const platform = usePlatform()` at hook top level, replace all `invoke()` calls.

Example pattern for `use-auto-save.ts`:
```typescript
// Before
import { invoke } from "@tauri-apps/api/core"
// ...
await invoke("save_project", { projectId, project })

// After
import { usePlatform } from "@/platform/PlatformContext"
// ...
const platform = usePlatform()
// ...
await platform.invoke("save_project", { projectId, project })
```

**Step 3: Update each component file** using the same pattern

For components with menu APIs (settings-popover, input-toggle), replace:
```typescript
// Before
const menu = await Menu.new({ items: [...] })
await menu.popup()

// After
const platform = usePlatform()
await platform.menu.showDropdown([...])
```

**Step 4: Run tests after each file**

```bash
pnpm --filter @reko/app test 2>&1 | tail -20
```

Fix any test breakage before moving to the next file.

**Step 5: After all files updated, verify zero @tauri-apps in app/**

```bash
grep -r "@tauri-apps" app/src/ || echo "CLEAN"
# Expected: CLEAN
```

**Step 6: Commit**

```bash
git add app/src/
git commit -m "refactor(app): replace all @tauri-apps imports with Platform interface"
```

---

## Task 8: Update Tests to Use Mock Platform

`app/src/__tests__/setup.ts` currently mocks `@tauri-apps/api/core` globally. Now that `app/` doesn't import Tauri directly, tests need a mock platform instead.

**Files:**
- Modify: `app/src/__tests__/setup.ts`
- Create: `app/src/__tests__/mock-platform.ts`
- Modify: each test file that previously used `vi.mocked(invoke)`

**Step 1: Create `app/src/__tests__/mock-platform.ts`**

```typescript
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
      setAlwaysOnTop: vi.fn().mockResolvedValue(undefined),
      center: vi.fn().mockResolvedValue(undefined),
    },
    navigation: {
      openWindow: vi.fn().mockResolvedValue(undefined),
      closeWindow: vi.fn().mockResolvedValue(undefined),
    },
    filesystem: {
      assetUrl: vi.fn().mockImplementation((p) => `/__asset__${p}`),
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
```

**Step 2: Update `app/src/__tests__/setup.ts`**

```typescript
// No longer mock @tauri-apps/api/core — app has no Tauri imports.
// Tests that render components use renderWithPlatform() helper instead.
import "@testing-library/jest-dom"
```

**Step 3: Create `app/src/__tests__/render-with-platform.tsx`**

```typescript
import { render, type RenderOptions } from "@testing-library/react"
import { PlatformProvider } from "@/platform/PlatformContext"
import { createMockPlatform } from "./mock-platform"
import type { Platform } from "@/platform/types"

export function renderWithPlatform(
  ui: React.ReactElement,
  platform?: Partial<Platform>,
  options?: RenderOptions
) {
  const mockPlatform = createMockPlatform(platform)
  return render(
    <PlatformProvider platform={mockPlatform}>{ui}</PlatformProvider>,
    options
  )
}
```

**Step 4: Update each test file**

Replace:
```typescript
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }))
// ...
vi.mocked(invoke).mockResolvedValue(...)
```

With:
```typescript
import { renderWithPlatform } from "./render-with-platform"
import { createMockPlatform } from "./mock-platform"
// ...
const mockPlatform = createMockPlatform({
  invoke: vi.fn().mockResolvedValue(...)
})
renderWithPlatform(<Component />, mockPlatform)
```

**Step 5: Run full test suite**

```bash
pnpm --filter @reko/app test
# Expected: all tests pass
```

**Step 6: Commit**

```bash
git add app/src/__tests__/
git commit -m "test(app): replace @tauri-apps mocks with Platform mock"
```

---

## Task 9: Install Dependencies and Verify Build

**Step 1: Install all workspace deps from root**

```bash
pnpm install
# Expected: creates root node_modules + per-package node_modules,
#           app/ and tauri/ linked via pnpm's virtual store
```

**Step 2: Verify workspace links**

```bash
pnpm list --filter @reko/tauri
# Expected: @reko/app listed as a workspace dependency
```

**Step 3: Verify app/ standalone build**

```bash
pnpm --filter @reko/app build
# Expected: app/dist/ created
```

**Step 4: Verify Tauri dev starts**

```bash
pnpm tauri:dev
# Expected: Vite dev server + Tauri window opens
```

**Step 5: Commit lockfile**

```bash
git add pnpm-lock.yaml
git commit -m "chore: install workspace dependencies"
```

---

## Task 10: Update CLAUDE.md and Build Commands

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Update Build Commands section in CLAUDE.md**

```markdown
## Build Commands

```bash
# Frontend dev server (Vite on :5173) — app package only
pnpm --filter @reko/app dev

# Full Tauri app (builds Swift + Rust + starts Vite)
pnpm tauri:dev

# Build app only
pnpm --filter @reko/app build

# Full production build
pnpm tauri:build

# Lint
pnpm --filter @reko/app lint

# Tests — frontend (vitest, runs from app/ package)
pnpm test                                                        # run all once
pnpm --filter @reko/app exec vitest run src/__tests__/sequence.test.ts  # single file
pnpm test:watch                                                  # watch mode

# Tests — Rust
cargo test --manifest-path tauri/src-tauri/Cargo.toml

# Tests — Swift
cd RekoEngine && swift test
```
```

Also update the Architecture section to note the monorepo layout.

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for monorepo structure"
```

---

## Verification Checklist

After all tasks complete:

```bash
# 1. Zero Tauri imports in app/
grep -r "@tauri-apps" app/src/ || echo "CLEAN — app is Tauri-free"

# 2. All tests pass
pnpm test

# 3. App builds standalone
pnpm --filter @reko/app build

# 4. Tauri dev works
pnpm tauri:dev

# 5. Swift build still works
cd RekoEngine && swift build -c release

# 6. Rust build still works
cargo build --manifest-path tauri/src-tauri/Cargo.toml
```

---

## Notes

- **`recorder-app.tsx`** is the most complex file to migrate — it uses window positioning, monitor info, shortcuts, WebviewWindow creation, and many invoke calls. Do it last.
- **`lib/asset-url.ts`** changes from a pure function to a hook (`useAssetUrl`). Update all call sites.
- **Tauri `tsconfig.json`**: needs `paths` pointing to `@app/*` → `../app/src/*` so TypeScript resolves imports from the app package.
- **`components.json` (shadcn)**: lives in `app/` — update its `aliases.utils` path if needed.
- **`eslint.config.js`**: can stay at root or be split per-package.

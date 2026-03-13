<p align="center">
  <h1 align="center">Reko</h1>
  <p align="center">
    <strong>The open-source screen recorder and video editor for macOS.</strong>
  </p>
  <p align="center">
    Record. Edit. Export. All in one native app.
  </p>
</p>

<p align="center">
  <a href="https://github.com/nicepkg/reko/releases"><img src="https://img.shields.io/badge/macOS-Download-black?logo=apple&logoColor=white" alt="Download for macOS" /></a>
  <a href="#license"><img src="https://img.shields.io/badge/license-MIT-blue" alt="License" /></a>
</p>

---

Reko is a native macOS screen recorder with a built-in Premiere-style timeline editor. Capture your screen, microphone, system audio, and camera — then trim, zoom, add transitions, and export a polished video without ever leaving the app.

No Electron. No cloud uploads. Just a fast, native app built with Swift, Rust, and React.

## Features

- **Screen Recording** — Capture your entire screen, a single window, or a custom region with pixel-perfect fidelity via ScreenCaptureKit
- **Timeline Editor** — Clip trimming, splitting, and precise frame-level control in a full NLE timeline
- **Audio Capture** — Record microphone and system audio simultaneously with independent volume control
- **Zoom Keyframes** — Smooth zoom and pan effects to highlight key moments, scoped per-clip for granular control
- **Camera Overlay** — Picture-in-picture webcam bubble with resizable positioning
- **Cursor Effects** — Automatic mouse tracking with click highlights and smooth cursor animations
- **Transitions** — Built-in transition effects between clips for polished, professional cuts
- **Shareable Links** — Generate a shareable link for any video with one click; viewers watch instantly in the browser
- **Native Performance** — Hardware-accelerated recording via ScreenCaptureKit and VideoToolbox encoding on Apple Silicon
- **Pro Tier** — Optional $8/mo subscription for larger uploads, non-expiring links, and badge removal

## Tech Stack

Reko is a three-layer native stack — no compromises:

| Layer | Technology | Role |
|-------|-----------|------|
| **RekoEngine** | Swift, ScreenCaptureKit, AVFoundation, VideoToolbox | Native capture, compositing, and export |
| **Backend** | Rust, Tauri v2 | Orchestration, IPC, project management |
| **Frontend** | React, TypeScript, Zustand, Tailwind CSS v4, shadcn/ui | Timeline editor UI |

## Getting Started

```bash
# Clone the repo
git clone https://github.com/nicepkg/reko.git
cd reko

# Install dependencies
pnpm install

# Run the full app (Swift + Rust + Vite)
pnpm dev
```

### Other Commands

```bash
# Frontend dev server only (at :5173)
pnpm --filter @reko/app dev

# Production build
pnpm build

# Run tests
pnpm --filter @reko/app test          # Frontend (vitest)
cargo test --manifest-path apps/tauri/src-tauri/Cargo.toml  # Rust
cd RekoEngine && swift test           # Swift
```

## Project Structure

```
reko/
├── apps/
│   ├── app/          # React UI (platform-agnostic, zero Tauri imports)
│   ├── tauri/        # Tauri v2 shell + Rust backend
│   ├── api/          # Cloudflare Workers API (sharing, billing)
│   ├── player/       # Shareable video link viewer (Cloudflare Pages)
│   └── website/      # Marketing site
└── RekoEngine/       # Swift framework (ScreenCaptureKit, AVFoundation, VideoToolbox)
```

## Contributing

Contributions are welcome! Feel free to open issues and pull requests.

## License

MIT

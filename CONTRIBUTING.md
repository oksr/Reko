# Contributing to Reko

Thanks for your interest in contributing!

## Building Locally

No signing is required for development builds.

### Prerequisites

- macOS 14+
- [pnpm](https://pnpm.io) (`npm install -g pnpm`)
- Xcode Command Line Tools (`xcode-select --install`)
- Rust (via Homebrew: `brew install rust`)
- Swift (included with Xcode)

### Run in development

```bash
pnpm install
pnpm dev
```

This starts the full Tauri app with hot-reload.

### Frontend only (no native code)

```bash
pnpm --filter @reko/app dev
```

Vite dev server at `http://localhost:5173`.

### Run tests

```bash
# Frontend
pnpm --filter @reko/app test

# Rust
cargo test --manifest-path apps/tauri/src-tauri/Cargo.toml

# Swift
cd RekoEngine && swift test
```

## Pull Requests

- PRs trigger the `build-check.yml` CI workflow which builds the app (unsigned) and runs tests
- Signing and notarization only happen on version tags pushed by the maintainer — you don't need any Apple credentials to contribute
- Keep PRs focused; one feature or fix per PR

## Architecture Overview

See [CLAUDE.md](./CLAUDE.md) for a detailed breakdown of the monorepo structure, data model, and key conventions.

## Releases

Only the repo owner can cut signed releases. See [docs/RELEASING.md](./docs/RELEASING.md) for the release process.

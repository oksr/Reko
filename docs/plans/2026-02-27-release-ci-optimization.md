# Release CI Optimization

## Problem

The release workflow takes ~11 minutes end-to-end. Step-level timing shows the "Build universal binary" step accounts for ~10 minutes (95% of total). Everything else (setup, release creation) is ~1 minute combined.

## Optimizations

### 1. Drop Intel — Single-Arch Build (aarch64 only)

**Savings: ~4-5 min**

The universal binary builds Rust+Swift for both aarch64 and x86_64, roughly doubling compilation time. Apple stopped selling Intel Macs in 2020; dropping x86_64 eliminates an entire compilation pass.

Changes in `release.yml`:
- Build target: `universal-apple-darwin` → `aarch64-apple-darwin`
- Rust toolchain targets: remove `x86_64-apple-darwin`
- Artifact paths: `target/universal-apple-darwin/` → `target/aarch64-apple-darwin/`

### 2. sccache for Rust Compilation

**Savings: ~1-2 min (warm cache)**

`Swatinem/rust-cache` caches the `target/` directory. `sccache` is more granular — it caches individual `rustc` invocations, so partial code changes get cache hits on unchanged crates.

Changes in both `release.yml` and `build-check.yml`:
- Add `mozilla-actions/sccache-action@v0.0.7` step
- Set `RUSTC_WRAPPER: sccache` env var on build steps
- Keep `Swatinem/rust-cache` alongside (they complement each other)

### 3. Swift Build Cache

**Savings: ~30s-1 min (when Swift sources unchanged)**

Cache `RekoEngine/.build` to avoid recompiling the Swift framework when sources haven't changed.

Changes in both `release.yml` and `build-check.yml`:
- Add `actions/cache@v4` for `RekoEngine/.build`
- Cache key based on `Package.swift` + source file hashes

### 4. Share Caches Between Workflows

**Savings: prevents cold-cache penalty (~2-3 min)**

GitHub Actions caches are scoped to branch+workflow by default. Since `release` runs on tags, it can't restore caches from `build-check` on `main` without explicit config.

Changes:
- Add `shared-key` parameter to `Swatinem/rust-cache` in both workflows
- Add `save-always: true` to rust-cache so it saves even on build failure
- sccache already shares across workflows via GitHub Actions cache backend

## Expected Result

| Scenario | Before | After |
|---|---|---|
| Warm cache | ~11 min | ~4-5 min |
| Cold cache | ~11 min | ~6-7 min |

## Constraints

- Free GitHub plan (no larger runners)
- macOS-only (no Linux cross-compilation)
- Weekly release cadence (caches stay warm)

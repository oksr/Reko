# Release CI Optimization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reduce the release workflow from ~11 minutes to ~4-5 minutes by dropping Intel, adding sccache, caching Swift builds, and sharing caches across workflows.

**Architecture:** Four independent optimizations applied to `.github/workflows/release.yml` and `.github/workflows/build-check.yml`. No application code changes — CI-only.

**Tech Stack:** GitHub Actions, sccache, Swatinem/rust-cache, actions/cache

---

### Task 1: Drop Intel target from release workflow

**Files:**
- Modify: `.github/workflows/release.yml:35-37` (Rust toolchain targets)
- Modify: `.github/workflows/release.yml:77-86` (build command + step name)
- Modify: `.github/workflows/release.yml:88-93` (artifact path)
- Modify: `.github/workflows/release.yml:103` (latest.json path)

**Step 1: Update Rust toolchain to aarch64 only**

In `.github/workflows/release.yml`, change the Setup Rust step:

```yaml
      - name: Setup Rust
        uses: dtolnay/rust-toolchain@stable
        with:
          targets: aarch64-apple-darwin
```

**Step 2: Update build command and step name**

Change the build step:

```yaml
      - name: Build aarch64 binary
        env:
          APPLE_SIGNING_IDENTITY: ${{ secrets.APPLE_SIGNING_IDENTITY }}
          APPLE_ID: ${{ secrets.APPLE_ID }}
          APPLE_PASSWORD: ${{ secrets.APPLE_PASSWORD }}
          APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
        run: |
          pnpm --filter @reko/tauri tauri:build --target aarch64-apple-darwin
```

**Step 3: Update artifact paths**

Change the "Find bundle artifacts" step:

```yaml
      - name: Find bundle artifacts
        id: artifacts
        run: |
          DMG=$(find apps/tauri/src-tauri/target/aarch64-apple-darwin/release/bundle/dmg -name "*.dmg" | head -1)
          echo "dmg=$DMG" >> "$GITHUB_OUTPUT"
          echo "Found DMG: $DMG"
```

Change the release files path:

```yaml
          files: |
            ${{ steps.artifacts.outputs.dmg }}
            apps/tauri/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/latest.json
```

**Step 4: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "perf(ci): drop Intel target, build aarch64 only"
```

---

### Task 2: Add sccache to both workflows

**Files:**
- Modify: `.github/workflows/release.yml` (add sccache step + env var)
- Modify: `.github/workflows/build-check.yml` (add sccache step + env var)

**Step 1: Add sccache to release.yml**

Add this step right after "Cache Rust" (after line 42), before the certificate import:

```yaml
      - name: Setup sccache
        uses: mozilla-actions/sccache-action@v0.0.7
```

Add `RUSTC_WRAPPER: sccache` to the build step's env block (alongside the existing env vars):

```yaml
      - name: Build aarch64 binary
        env:
          RUSTC_WRAPPER: sccache
          APPLE_SIGNING_IDENTITY: ${{ secrets.APPLE_SIGNING_IDENTITY }}
          APPLE_ID: ${{ secrets.APPLE_ID }}
          APPLE_PASSWORD: ${{ secrets.APPLE_PASSWORD }}
          APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
        run: |
          pnpm --filter @reko/tauri tauri:build --target aarch64-apple-darwin
```

**Step 2: Add sccache to build-check.yml**

Add this step right after "Cache Rust" (after line 41):

```yaml
      - name: Setup sccache
        uses: mozilla-actions/sccache-action@v0.0.7
```

Add `RUSTC_WRAPPER: sccache` as an env var on the cargo build step:

```yaml
      - name: Build Rust (no bundle)
        env:
          RUSTC_WRAPPER: sccache
        run: cargo build --manifest-path apps/tauri/src-tauri/Cargo.toml
```

And also on the test step (so test compilation is cached too):

```yaml
      - name: Run Rust tests
        env:
          RUSTC_WRAPPER: sccache
        run: cargo test --manifest-path apps/tauri/src-tauri/Cargo.toml
```

**Step 3: Commit**

```bash
git add .github/workflows/release.yml .github/workflows/build-check.yml
git commit -m "perf(ci): add sccache for Rust compilation caching"
```

---

### Task 3: Add Swift build cache to both workflows

**Files:**
- Modify: `.github/workflows/release.yml` (add cache step)
- Modify: `.github/workflows/build-check.yml` (add cache step)

**Step 1: Add Swift cache to release.yml**

Add this step right after "Setup sccache", before the certificate import:

```yaml
      - name: Cache Swift build
        uses: actions/cache@v4
        with:
          path: RekoEngine/.build
          key: swift-${{ runner.os }}-${{ hashFiles('RekoEngine/Package.swift', 'RekoEngine/Sources/**') }}
          restore-keys: |
            swift-${{ runner.os }}-
```

**Step 2: Add Swift cache to build-check.yml**

Add the same step right after "Setup sccache":

```yaml
      - name: Cache Swift build
        uses: actions/cache@v4
        with:
          path: RekoEngine/.build
          key: swift-${{ runner.os }}-${{ hashFiles('RekoEngine/Package.swift', 'RekoEngine/Sources/**') }}
          restore-keys: |
            swift-${{ runner.os }}-
```

**Step 3: Commit**

```bash
git add .github/workflows/release.yml .github/workflows/build-check.yml
git commit -m "perf(ci): cache Swift build artifacts"
```

---

### Task 4: Share Rust caches across workflows

**Files:**
- Modify: `.github/workflows/release.yml` (rust-cache config)
- Modify: `.github/workflows/build-check.yml` (rust-cache config)

**Step 1: Update rust-cache in release.yml**

Change the "Cache Rust" step to use a shared key and save-always:

```yaml
      - name: Cache Rust
        uses: Swatinem/rust-cache@v2
        with:
          workspaces: apps/tauri/src-tauri
          shared-key: reko-rust
          save-always: true
```

**Step 2: Update rust-cache in build-check.yml**

Change the "Cache Rust" step to match:

```yaml
      - name: Cache Rust
        uses: Swatinem/rust-cache@v2
        with:
          workspaces: apps/tauri/src-tauri
          shared-key: reko-rust
          save-always: true
```

**Step 3: Commit**

```bash
git add .github/workflows/release.yml .github/workflows/build-check.yml
git commit -m "perf(ci): share Rust cache across workflows"
```

---

### Task 5: Verify final workflow files

**Step 1: Review release.yml**

Read `.github/workflows/release.yml` end-to-end and verify:
- Rust targets only `aarch64-apple-darwin`
- Build target is `aarch64-apple-darwin`
- Artifact paths reference `aarch64-apple-darwin`
- sccache step exists before build
- Swift cache step exists before build
- rust-cache has `shared-key: reko-rust` and `save-always: true`
- `RUSTC_WRAPPER: sccache` is in the build env

**Step 2: Review build-check.yml**

Read `.github/workflows/build-check.yml` end-to-end and verify:
- sccache step exists before build
- Swift cache step exists before build
- rust-cache has `shared-key: reko-rust` and `save-always: true`
- `RUSTC_WRAPPER: sccache` is on both cargo build and cargo test steps

**Step 3: Validate YAML syntax**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/release.yml')); yaml.safe_load(open('.github/workflows/build-check.yml')); print('YAML valid')"` or use `yq` if available.

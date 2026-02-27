# Fix Thread-Safety Issues in RekoEngine Recording Subsystem

## Context

The app crashes (SIGTRAP) when starting recording in dev mode. The root cause in MouseLogger was a UInt64 underflow (already fixed). A full audit revealed the same class of bugs — race conditions and unsigned integer underflow — across all recording writers and the pipeline itself. These need to be fixed to prevent intermittent crashes.

## Approach

Add `NSLock` synchronization (consistent with existing `levelsLock` and MouseLogger's `lock`) to each file. Locks are never nested to avoid deadlocks.

## Changes

### 1. `RekoEngine/Sources/RekoEngine/recording/video-writer.swift`
- Add `private let lock = NSLock()`
- `appendVideoSample()`: wrap body in lock (protects `isStarted` check + `assetWriter`/`videoInput` access)
- `finish()`: set `isStarted = false` and call `markAsFinished()` under lock, release before `await finishWriting()`

### 2. `RekoEngine/Sources/RekoEngine/recording/mic-writer.swift`
- Add `private let lock = NSLock()`
- `write()`: wrap `audioFile?.write()` in lock
- `finish()`: wrap `audioFile = nil` in lock

### 3. `RekoEngine/Sources/RekoEngine/recording/audio-file-writer.swift`
- Add `private let lock = NSLock()`
- `appendAudioSample()`: capture `audioFile` into local under lock, do format conversion unlocked, then write
- `finish()`: wrap `audioFile = nil` in lock

### 4. `RekoEngine/Sources/RekoEngine/recording/recording-pipeline.swift`
- Add `private let stateLock = NSLock()` (separate from existing `levelsLock`)
- **Callbacks** (video, audio, mic, camera): guard `isRecording`/`isPaused` under `stateLock`, release before calling writers
- **`start()`**: set `startTime`/`isRecording` under `stateLock`
- **`stop()`**: snapshot `isRecording=false`, `frameCount`, `startTime`, `totalPausedNano` into locals under `stateLock`; use saturating subtraction for elapsed calculation to prevent UInt64 underflow
- **`pause()`/`resume()`**: read/write `isPaused`, `pauseStartNano`, `totalPausedNano` under `stateLock`; call `mouseLogger` methods outside lock

### Lock hierarchy (no nesting)
`stateLock` → release → writer's `lock` (internal) → release → `levelsLock` → release

## Verification

```bash
cd RekoEngine && swift build -c release   # release build compiles
cd RekoEngine && swift build              # debug build compiles
cd RekoEngine && swift test               # existing tests pass
pnpm dev                                  # manual: start recording, no crash
```

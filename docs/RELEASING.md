# Releasing Reko

This document is for the repo owner. It covers the one-time setup and the steps to cut a signed, notarized release.

## One-Time Setup

### 1. Generate the updater keypair

```bash
pnpm tauri signer generate -w ~/.tauri/reko.key
```

This prints a public key. Copy it and replace `TAURI_PUBLIC_KEY_PLACEHOLDER` in `apps/tauri/src-tauri/tauri.conf.json`:

```json
"plugins": {
  "updater": {
    "pubkey": "<paste public key here>"
  }
}
```

Add the private key and its password to GitHub Secrets:
- `TAURI_SIGNING_PRIVATE_KEY` — contents of `~/.tauri/reko.key`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — the password you chose

### 2. Export your Developer ID Application certificate

1. Open **Keychain Access** → My Certificates
2. Right-click **Developer ID Application: Your Name (TEAMID)** → Export
3. Save as `.p12`, set an export password
4. Base64-encode it:
   ```bash
   base64 -i certificate.p12 | pbcopy
   ```
5. Add to GitHub Secrets:
   - `APPLE_CERTIFICATE` — the base64 string
   - `APPLE_CERTIFICATE_PASSWORD` — the export password
   - `APPLE_SIGNING_IDENTITY` — `"Developer ID Application: Your Name (TEAMID)"`

### 3. Set up notarization credentials

1. Go to [appleid.apple.com](https://appleid.apple.com) → App-Specific Passwords → Generate
2. Add to GitHub Secrets:
   - `APPLE_ID` — your Apple ID email
   - `APPLE_PASSWORD` — the app-specific password
   - `APPLE_TEAM_ID` — your 10-character team ID from [developer.apple.com](https://developer.apple.com/account)

## Cutting a Release

1. Bump `version` in `apps/tauri/src-tauri/tauri.conf.json`
2. Commit: `git commit -am "chore: bump version to X.Y.Z"`
3. Tag and push:
   ```bash
   git tag vX.Y.Z
   git push origin main --tags
   ```
4. The `release.yml` workflow runs automatically, builds a universal DMG, signs + notarizes it, and publishes to GitHub Releases with `latest.json`

## Required GitHub Secrets

| Secret | Description |
|--------|-------------|
| `APPLE_CERTIFICATE` | Base64-encoded Developer ID Application .p12 |
| `APPLE_CERTIFICATE_PASSWORD` | .p12 export password |
| `APPLE_SIGNING_IDENTITY` | `"Developer ID Application: Name (TEAMID)"` |
| `APPLE_ID` | Apple ID email |
| `APPLE_PASSWORD` | App-specific password from appleid.apple.com |
| `APPLE_TEAM_ID` | 10-char team ID from developer.apple.com |
| `TAURI_SIGNING_PRIVATE_KEY` | From `pnpm tauri signer generate` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Password chosen during key generation |

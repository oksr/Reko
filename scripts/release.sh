#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Get the latest release tag and compute the next patch version
LATEST=$(git tag --sort=-v:refname | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -1)

if [ -z "$LATEST" ]; then
  echo "No existing release tags found."
  exit 1
fi

# Parse major.minor.patch
IFS='.' read -r MAJOR MINOR PATCH <<< "${LATEST#v}"
NEXT_PATCH=$((PATCH + 1))
NEXT_VERSION="v${MAJOR}.${MINOR}.${NEXT_PATCH}"

# Allow override: ./scripts/release.sh v1.0.0
if [ "${1:-}" != "" ]; then
  NEXT_VERSION="$1"
  # Ensure v prefix
  [[ "$NEXT_VERSION" != v* ]] && NEXT_VERSION="v$NEXT_VERSION"
fi

VERSION="${NEXT_VERSION#v}"

echo "Latest release: $LATEST"
echo "Next release:   $NEXT_VERSION ($VERSION)"
echo ""

# Update version in all 3 files
echo "Updating version files..."

# package.json
jq --arg v "$VERSION" '.version = $v' "$ROOT/package.json" > "$ROOT/package.json.tmp"
mv "$ROOT/package.json.tmp" "$ROOT/package.json"

# tauri.conf.json
jq --arg v "$VERSION" '.version = $v' "$ROOT/apps/tauri/src-tauri/tauri.conf.json" > "$ROOT/apps/tauri/src-tauri/tauri.conf.json.tmp"
mv "$ROOT/apps/tauri/src-tauri/tauri.conf.json.tmp" "$ROOT/apps/tauri/src-tauri/tauri.conf.json"

# Cargo.toml — update the version line under [package]
sed -i '' "s/^version = \".*\"/version = \"$VERSION\"/" "$ROOT/apps/tauri/src-tauri/Cargo.toml"

echo "  package.json              -> $VERSION"
echo "  tauri.conf.json           -> $VERSION"
echo "  Cargo.toml                -> $VERSION"
echo ""

read -p "Release $NEXT_VERSION? [y/N] " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Aborted. Version files were updated but not committed."
  exit 0
fi

# Commit, tag, and push
git add "$ROOT/package.json" "$ROOT/apps/tauri/src-tauri/tauri.conf.json" "$ROOT/apps/tauri/src-tauri/Cargo.toml"
git commit -m "release: $NEXT_VERSION"
git tag "$NEXT_VERSION"

echo ""
echo "Pushing commit and tag..."
git push origin main
git push origin "$NEXT_VERSION"

echo ""
echo "Tagged and pushed $NEXT_VERSION — CI will build and publish the release."
echo "Track it: gh run watch"

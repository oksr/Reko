#!/bin/bash
set -euo pipefail

APP_NAME="Reko"
BUNDLE_ID="com.reko.app"
APP_PATH="/Applications/${APP_NAME}.app"
APP_SUPPORT="$HOME/Library/Application Support/${BUNDLE_ID}"
WEBVIEW_DATA="$HOME/Library/WebKit/${BUNDLE_ID}"

# Find latest Reko DMG in ~/Downloads
DMG=$(ls -t ~/Downloads/Reko*.dmg 2>/dev/null | head -1)
if [ -z "$DMG" ]; then
  echo "No Reko DMG found in ~/Downloads/"
  exit 1
fi
echo "Using DMG: $DMG"

# 1. Quit app if running
if pgrep -xq "$APP_NAME"; then
  echo "Quitting ${APP_NAME}..."
  osascript -e "tell application \"${APP_NAME}\" to quit" 2>/dev/null || true
  sleep 1
  pkill -x "$APP_NAME" 2>/dev/null || true
fi

# 2. Delete existing app
if [ -d "$APP_PATH" ]; then
  echo "Removing ${APP_PATH}..."
  rm -rf "$APP_PATH"
fi

# 3. Clear app data
if [ -d "$APP_SUPPORT" ]; then
  echo "Clearing app data..."
  rm -rf "$APP_SUPPORT"
fi

# 4. Clear WebView/localStorage data
if [ -d "$WEBVIEW_DATA" ]; then
  echo "Clearing WebView data..."
  rm -rf "$WEBVIEW_DATA"
fi

# 5. Reset macOS permissions
# Only reset Screen Recording and Accessibility — these are re-added when the
# app requests access. Camera/Microphone are skipped because tccutil removes
# the app from the list entirely, and macOS only re-adds it when the app
# triggers a native permission prompt (AVCaptureDevice.requestAccess), which
# happens at recording time, not during onboarding.
echo "Resetting macOS permissions..."
tccutil reset ScreenCapture "$BUNDLE_ID" 2>/dev/null || true
tccutil reset Accessibility "$BUNDLE_ID" 2>/dev/null || true

# 6. Clear Saved Application State (window positions etc.)
rm -rf "$HOME/Library/Saved Application State/${BUNDLE_ID}.savedState" 2>/dev/null || true

# 7. Clear caches
rm -rf "$HOME/Library/Caches/${BUNDLE_ID}" 2>/dev/null || true

# 8. Clear preferences
defaults delete "$BUNDLE_ID" 2>/dev/null || true

# 9. Mount DMG, copy app, eject
echo "Installing from DMG..."
MOUNT_POINT=$(hdiutil attach "$DMG" -nobrowse -noverify | grep "/Volumes" | awk -F'\t' '{print $NF}')
if [ -z "$MOUNT_POINT" ]; then
  echo "Failed to mount DMG"
  exit 1
fi

cp -R "${MOUNT_POINT}/${APP_NAME}.app" /Applications/
hdiutil detach "$MOUNT_POINT" -quiet

echo "Done. Opening ${APP_NAME}..."
open "$APP_PATH"

#!/bin/bash
# Install / reinstall the Quay 1 Mission Control collector as a launchd agent.
# Idempotent: safe to re-run. It (re)loads the plist from this repo.
set -euo pipefail

REPO="/Users/paganstorm/Projects/quay-mission-control"
LABEL="com.quay1.mission-control-collector"
SRC_PLIST="$REPO/collector/$LABEL.plist"
DEST_DIR="$HOME/Library/LaunchAgents"
DEST_PLIST="$DEST_DIR/$LABEL.plist"

echo "==> Mission Control collector installer"

if [ ! -f "$SRC_PLIST" ]; then
  echo "ERROR: plist not found at $SRC_PLIST" >&2
  exit 1
fi

mkdir -p "$DEST_DIR"
mkdir -p "$REPO/collector/logs"

echo "==> Copying plist -> $DEST_PLIST"
cp -f "$SRC_PLIST" "$DEST_PLIST"

echo "==> Unloading any existing agent (ignoring errors)"
launchctl unload "$DEST_PLIST" 2>/dev/null || true

echo "==> Loading agent"
launchctl load "$DEST_PLIST"

echo "==> Status:"
launchctl list "$LABEL" 2>/dev/null || echo "    (not yet listed - give it a moment)"

echo "==> Done. Logs:"
echo "    $REPO/collector/logs/collector.stdout.log"
echo "    $REPO/collector/logs/collector.stderr.log"
echo "    Runs every 300s (StartInterval) + once at load (RunAtLoad)."

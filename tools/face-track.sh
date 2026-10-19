#!/bin/bash
# macOS only (uses Apple's Vision framework through swift, which ships with Xcode Command Line Tools).
# Usage (from a project folder): bash <repo>/tools/face-track.sh assets/face.mp4 [fps]
# Writes fx/face-track.js -> include with <script src="fx/face-track.js"></script> BEFORE your timeline script.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
mkdir -p fx
swift "$HERE/face-track.swift" "$1" fx/face-track.js "${2:-10}" 1080 1920

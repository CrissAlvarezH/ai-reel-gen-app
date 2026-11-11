#!/bin/bash
# Render every slide of carousel.json, in its order, as a new version: out/vN/01.png … NN.png (1080×1350 by default),
# with out/vN/version.json (each slide's id, title, text and a hash of its source) and out/vN/source/ (carousel.json and
# src/ as they were), so any version can be read back and rendered again. A version is never overwritten.
# usage: ./render.sh [note]     → prints out/vN
set -e; cd "$(dirname "$0")"
[ -f shared-chrome.sh ] && . ./shared-chrome.sh  # one headless Chrome for all videos and carousels
gl=; [ "$(uname)" = Darwin ] && gl=--gl=angle  # Chrome's ANGLE GL backend: needed on macOS only
n=$(node -p "require('./carousel.json').slides.length")
[ "$n" -gt 0 ] || { echo "carousel.json no tiene láminas todavía" >&2; exit 1; }
npx tsc -p .
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
npx remotion render src/index.ts Carousel "$tmp/frames" --sequence --image-format=png $gl --concurrency=${CONCURRENCY:-2} --log=${RENDER_LOG:-error}
node version.mjs "$tmp/frames" "$*"

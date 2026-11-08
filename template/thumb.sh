#!/bin/bash
# Render the video's thumbnail (src/thumbnail/Thumbnail.tsx, its own entry src/thumbnail/index.tsx) → out/miniatura.png,
# next to the renders (the folder "Descargar video" opens); Reel Studio shows it in the video's Miniatura tab.
# usage: ./thumb.sh
set -e; cd "$(dirname "$0")"; mkdir -p out
[ -f shared-chrome.sh ] && . ./shared-chrome.sh  # one headless Chrome for all videos
gl=; [ "$(uname)" = Darwin ] && gl=--gl=angle  # Chrome's ANGLE GL backend: needed on macOS only
npx tsc -p .
npx remotion still src/thumbnail/index.tsx Thumbnail out/miniatura.png $gl --frame=0 --log=error >/dev/null
echo out/miniatura.png

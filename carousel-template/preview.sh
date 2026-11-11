#!/bin/bash
# Render some slides to look at while working, without making a version: out/preview/<id>.png.
# usage: ./preview.sh [id…]   (no ids: every slide)   → prints the files
set -e; cd "$(dirname "$0")"
[ -f shared-chrome.sh ] && . ./shared-chrome.sh
gl=; [ "$(uname)" = Darwin ] && gl=--gl=angle
npx tsc -p .
ids=("$@"); [ ${#ids[@]} -gt 0 ] || ids=($(node -p "require('./carousel.json').slides.map((s) => s.id).join(' ')"))
mkdir -p out/preview
b=$(mktemp -d)/bundle; npx remotion bundle src/index.ts --out-dir "$b" --log=error >/dev/null
for id in "${ids[@]}"; do
  i=$(node -p "require('./carousel.json').slides.findIndex((s) => s.id === '$id')")
  [ "$i" -ge 0 ] || { echo "no hay ninguna lámina $id en carousel.json" >&2; exit 1; }
  npx remotion still "$b" Carousel "out/preview/$id.png" $gl --frame="$i" --log=error >/dev/null
  echo "out/preview/$id.png"
done
rm -rf "$(dirname "$b")"

#!/bin/bash
# Render stills of the film at the given seconds and a contact sheet.
# usage: ./snap.sh <outdir> <sec> [sec...]   -> <outdir>/t<sec>.png + <outdir>/sheet.png
# Renders two stills at a time so several agents can share the machine.
set -e; cd "$(dirname "$0")"; out=$1; shift; mkdir -p "$out"
fps=$(node -p "require('./src/format.json').fps" 2>/dev/null || echo 30)
gl=; [ "$(uname)" = Darwin ] && gl=--gl=angle  # Chrome's ANGLE GL backend: needed on macOS only
# The workspace, with .venv/ and tools/: up from this video (projects/<id>/videos/<slug>/, or videos/<slug>/ before projects).
root=..; while [ ! -d "$root/tools" ] && [ "$(cd "$root" && pwd)" != / ]; do root=$root/..; done
py=$root/.venv/bin/python; [ -x "$py" ] || py=$root/.venv/Scripts/python.exe  # Windows venv
npx tsc -p .
b=$(mktemp -d)/bundle; npx remotion bundle src/index.ts --out-dir "$b" --log=error >/dev/null
printf '%s\n' "$@" | xargs -P 2 -I{} sh -c 'npx remotion still "$0" Film "$1/t{}.png" $3 --frame=$(node -p "Math.round({}*$2)") --log=error >/dev/null' "$b" "$out" "$fps" "$gl"
if [ -x "$py" ]; then
  "$py" "$root/tools/sheet.py" "$out/sheet.png" $(for s in "$@"; do echo "$out/t$s.png"; done)
else  # no venv (styles without cutouts): the same sheet with ffmpeg, without the file names
  n=$#; in=(); f=; for s in "$@"; do in+=(-i "$out/t$s.png"); done
  for i in $(seq 0 $((n - 1))); do f="$f[$i]scale=360:-2[s$i];"; done
  for i in $(seq 0 $((n - 1))); do f="$f[s$i]"; done
  ffmpeg -v error -y "${in[@]}" -filter_complex "${f}concat=n=$n:v=1:a=0,tile=5x$(( (n + 4) / 5 ))" -frames:v 1 "$out/sheet.png"
fi
rm -rf "$(dirname "$b")"
echo "$out/sheet.png"

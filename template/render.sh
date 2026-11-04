#!/bin/bash
# Full render + two-pass loudness-normalize to the platform's target (src/format.json "lufs", -14 by default)
# with peaks at -1.5 dBTP. usage: [CONCURRENCY=n] ./render.sh <name>
set -e; cd "$(dirname "$0")"; n=${1:-reel}
I=$(node -p "require('./src/format.json').lufs ?? -14" 2>/dev/null || echo -14)
# Chrome's ANGLE GL backend: needed on macOS, the default works on Linux and Windows.
gl=; [ "$(uname)" = Darwin ] && gl=--gl=angle
npx tsc -p .
npx remotion render src/index.ts ${COMP:-Film} $gl out/$n.raw.mp4 --codec h264 --crf 18 --concurrency=${CONCURRENCY:-2} --log=${RENDER_LOG:-error}
# Pass 1 measures; pass 2 applies one linear gain (no pumping). linear=true alone can overshoot
# the peak target, so an oversampled limiter at -2.5 dB catches peaks (measured -2.5 dBTP after AAC).
m=$(ffmpeg -hide_banner -nostats -i out/$n.raw.mp4 -af loudnorm=I=$I:TP=-2:LRA=11:print_format=json -f null - 2>&1 | sed -n '/^{/,/^}/p')
v() { printf '%s' "$m" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s)['$1']))"; }
ffmpeg -y -v error -i out/$n.raw.mp4 -c:v copy -af "loudnorm=I=$I:TP=-2:LRA=11:measured_I=$(v input_i):measured_TP=$(v input_tp):measured_LRA=$(v input_lra):measured_thresh=$(v input_thresh):offset=$(v target_offset):linear=true,aresample=192000,alimiter=limit=0.75:attack=1:release=50:level=false,aresample=48000" -ar 48000 -c:a aac -b:a 192k out/$n.mp4 && rm out/$n.raw.mp4
echo out/$n.mp4

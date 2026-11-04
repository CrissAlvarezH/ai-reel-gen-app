# Remotion pipeline

## Template (`templates/remotion-film/`): style-neutral infrastructure

Usage lines live in each script's header.
- `src/lib.ts`: `cue()`/`cueEnd()` (phrase to seconds; a phrase said twice needs `nth`), `f()`
  (seconds to frames), `prog()` (eased 0→1), `pop()` (spring), `voLevel(fr)` (VO loudness),
  `chunk()` (hand-authored caption lines checked against the transcript), and an `ACTS` table.
- `src/kit/camera.tsx`: keyframed pan, zoom and rotate, shake, handheld drift, parallax layers.
- `src/kit/three-canvas.tsx`, `src/kit/finish.tsx`: see [three.js](three.md).
- `audio/dsp.py`: numpy/scipy synthesis and mixing helpers, plus a `cue()` that reads the same
  `src/words.json`, so sound is timed from the words too.
- `align.py` (word timestamps and VO envelope), `snap.sh` (stills from one bundle plus a contact
  sheet), `render.sh` (full MP4, two-pass linear loudnorm to -14 LUFS with a peak limiter),
  `sheet.py`, `board.py` (key-frame board with each beat's time and line), `motion_check.py`.
- Optional parts with a look of their own: [templates/parts/](../templates/parts/README.md).
- Written per project: `src/index.ts`, `src/Root.tsx`, a film shell that switches acts and draws
  captions and audio, the scenes, and every visual asset.
- Setup: `npm i remotion @remotion/cli @remotion/google-fonts react react-dom typescript
  @types/react`, a tsconfig with `lib: ["ES2023","DOM"]`, a Python venv with `faster-whisper`,
  and `git init`.

## Structural conventions

- Scene logic uses absolute frames (`fr`), with no nested `<Sequence>` offsets, so a cue means the
  same frame everywhere. Every time comes from `cue()`, so re-aligning a new VO re-times the film.
- Draw every frame from `useCurrentFrame()` and Remotion's `random(seed)`, never `Math.random()`
  or a clock, so every render matches its stills. A `<canvas>` inside a component suits
  procedural art (grain, boil, particles).
- Captions come from hand-authored sense-unit lines, verified against the transcript at load.
  Their look is a per-project choice. Give the film shell a `captions` prop (on by default) so the
  [mute test](review.md#mute-test) can render without them.
- If the film will be sped up for delivery, lock the speed before final renders, and derive every
  on-screen number that depends on runtime (a video length, an elapsed-time chip) from one
  delivery-speed constant: the platform shows the sped-up length.

## Platform facts (Instagram Reels 9:16, as of 2026-09; recheck)

- The top ~220 px and bottom ~420 px are covered by UI, and so is a right rail (x > 930 at
  y > 1100). Keep faces, key props and on-screen text inside the rest.
- Frame 0 is the cover: legible at phone size and already moving.
- Deliver around -14 LUFS integrated and under -1.5 dBTP.

## Before the VO exists

Generate `words.json` from the script at the speaker's measured pace (words per second of an
earlier recording) and build every beat from `cue()` as usual; label it a stand-in. After
recording, align the real VO and re-render: a cue phrase the speaker changed throws by name, and
so does the caption check at load. Update the caption lines with the words, then run a script that
loads each act's cue module on its own and lists every phrase that no longer resolves, with the
nearest phrase in the new transcript, so each act owner fixes only their own.

## Sound events

Sound stays on the picture when both come from the same numbers.
- The template's convention: each act has a pure events module (no React, three or DOM imports)
  exporting `EVENTS: SoundEvent[]` (`{id, fr, dur?, what, x?}` from `lib.ts`): `fr` is the frame
  the thing visibly happens (contact, not the approach), `dur` for anything that lasts, `x` from -1
  to 1 for its place on screen. The scene imports its timing constants from it. To hand them to a
  Python mixer:
  `npx esbuild dump-events.mts --bundle --platform=node --format=esm | node --input-type=module > out/events.json`
  (a two-line script that prints `JSON.stringify(EVENTS)`).
- List what visibly happens (appearances, hits, landings, travel and camera moves, transitions)
  and each place change with its span, for an ambience bed; many repeats can be first, last and a
  count.
- One cue sheet maps event ids to sounds, levels and treatments: each place one ambience, each
  recurring thing one recognisable sound, the rest varied so no sample repeats until it's noticed.
- Drop effects under any stretch replaced by other footage (a talking-head insert).
- Exported events are candidates, not cues: sound the ones that carry meaning. Acts that export
  everything they draw can hand the mixer several events a second.

## Audio mechanics

- Keep the narrator's voice close to the raw recording: a high-pass, one static gain, a linear
  loudness pass, no compressor unless the raw needs it. The level changes between lines are the
  performance: give a take its own gain only when its level is clearly off (another mic distance
  or session), not to match the others. The master limiter shaves transients only (lookahead,
  short release); when it holds speech down, master quieter instead. Measure it: the narration
  stem's loudness range (`ebur128` LRA) in the mix stays close to the selected raw takes joined
  without gain (matched takes plus a busy limiter measured 2.6 LU against 4.5 raw, and the
  narrator heard his voice as flattened). Choose the speed-up stretcher by a round trip on the actual voice
  ([video-edit's audio notes](../../video-edit/references/technical.md)).
- Before the VO exists, mix music and effects at the level they will sit under the voice.
- Duck music by phrase, merging close words; per-word ducking pumps.
- Keep effects off key spoken words.
- Real footage brings its own sound (crowd, engines); duck it under speech like music, or it
  reads as a random burst over the voice.
- Measure instead of guessing: `ffmpeg -af ebur128` for loudness and true peak; render a stem
  without the VO for the VO-to-bed ratio in the 1–4 kHz band.

## Gotchas

- A killed `remotion still` or `render` can orphan its `chrome-headless-shell` (parent pid 1); in
  one long multi-agent session they reached about 175 processes and 3 GB. Reap before each render:
  `ps -A -o pid=,ppid=,command= | awk '$2==1 && /chrome-headless-shell/ {print $1}' | xargs kill`.
- Never rewrite a file a running render reads (a matte, texture, image sequence or audio): build
  replacements in a staging folder, swap them in between renders, re-render only the chunks that
  use them.
- zsh (the macOS default) doesn't word-split unquoted variables: in `for r in "0 300" "600 900";
  do set -- $r`, `$1` stays `"0 300"`, so a chunk loop can render nothing and exit 0. Call each
  range explicitly or use arrays.
- Agents rendering on one machine starve each other: a full render can be killed (exit 137), and a
  3,500-frame 3D render beside another job crashed a machine. Before fanning out, check memory,
  swap and load (`memory_pressure`, `sysctl vm.swapusage`, `uptime`): with swap 95% full and load
  20 on 12 cores every agent crawled, and stopping an idle VM halved the load. Route every heavy process
  (renders, encoders, compositing scripts, your own jobs) through one queue, render finals in
  chunks one at a time (300 frames worked), skip chunks already on disk so a rerun resumes, join
  with FFmpeg's concat demuxer (`-c copy`), mux the mix, and check the frame count against
  `TOTAL`.
- Parallel `remotion still` calls on the entry file race on the webpack cache. Bundle once, then
  render stills from the bundle (`snap.sh` does). Keep the bundle between batches and rebuild it
  only after source changes; deleting it per batch cost about 2 minutes each under load. Layout
  and motion checks can run at `--scale=0.5`; judge finish at full size.
- A React component defined inside another component's body is a new type on every render, so it
  remounts each frame: geometry rebuilds and state it set resets. It shows as one-frame pops and
  brightness differences between a sequence and a single still. Define components at module level.
- `rsync --exclude src` also strips `node_modules/*/src`. Copy projects without node_modules and
  reinstall.
- To extract an exact frame from a render, use `-vf "select=eq(n\,N)"`; `-ss` before `-i` on a
  concatenated file was off by one frame. The last renderable frame is `TOTAL - 1`.
- To re-cut a finished composition from source-frame segments, offset with nested sequences
  (`<Sequence from={outStart} durationInFrames={len}><Sequence from={-sourceIn}>…`).
  `<Freeze frame={n}>` clamps n to the host composition's last frame, so it silently shows the
  wrong frame for any source frame past the output length.
- Browser console output may not reach the CLI log during renders; print debug values into the
  frame instead.
- Whisper merges and splits words and hyphenations. Fix `words.json` with a kept script.
- TTS job JSON can hold a voice-preview URL as well as the output. Take the job's result URL.

## Checking without watching

- Stills: `./snap.sh out/check 0 1.5 3 …`, then read the sheet.
- From a render: `ffmpeg -vf fps=2,scale=360:-1` for the whole piece, or fps=10 around cuts.
  Frame N at fps=2 is t=(N-1)/2.

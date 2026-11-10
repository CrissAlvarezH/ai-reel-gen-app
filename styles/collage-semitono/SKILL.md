# Collage de papel con semitono — how to build it

The style's own part of the process (`.claude/skills/reel-studio/SKILL.md` has the steps). Palette, fonts and
what to avoid are in `style.json` next to this file; references in `refs/style-collage/` and approved frames in
`refs/approved/`, when this workspace has them (local, they don't come with the app). Lessons for this style: `LESSONS.md`, its collage section. Template: `template/`.

## Look

- Off-white paper board with grain. Animated **at 12 fps** on top of the format's frame rate: `Film.tsx`
  quantises the frame to steps of `FPS / 12`.
- Real photos → black/white 45° halftone cutouts with a torn white border and soft shadow. Old engravings and ink
  plates → `--lineart` (clean ink, no halftone).
- Drawn in code: torn paper strips and slips, black torn title strips (Anton), typewriter labels (Special Elite),
  bold captions on a torn white strip (Inter 800), rubber stamps, marker circles, arrows, dashed paths, halftone
  dot fields, solid circles behind subjects, simple app UI on phone screens.
- **Colour has meaning and keeps it:** yellow = yours / allowed / what travels; red = danger / someone else's /
  attention. Everything else black, white, paper.
- Motion = placement by hand: pieces drop in with spring overshoot and settle, text types on, marker strokes
  draw on, stamps slam (scale 1.8 → 1), slips travel along paths.

## Images → cutouts

`../../../../.venv/bin/python ../../../../tools/cutout.py assets/src/x.jpg public/cut/x.png [--crop x0,y0,x1,y1] [--width 1200] [--cell 7-8] [--gamma 0.4-0.9] [--contrast 1.1-1.35] [--bluekey 30] [--lineart [--inkmask]] [--rect] [--pick N] [--seed n]`

Uses rembg (its model downloads the first time). Check every cutout on a grey board before using it. Credits
for modified images say so ("Imágenes modificadas (semitono y recorte)").

## Build

One scene per act in `src/film/scenes.tsx`, with `src/film/stage.tsx` (`Drop`, `Stamp`, `Folder`, `Caption`,
`TitleStrip`, `at('phrase')`, `springAt`, `p01`, `typed`) and `src/collage/kit.tsx` (`Paper`, `Cutout`, `Torn`,
`MarkerCircle`, `Highlight`, `Arrow`, `Dots`). Examples: `styles/collage-semitono/examples/` and
`projects/principal/videos/authz-reel/src/cfilm/`.

## Sound

Paper foley, all synthetic: in the cue sheet of `audio/mix.py` use `paper_drop`, `paper_slide`, `stamp`, `tear`,
`marker` and the sounds in `audio/designed.py`, over a soft synthetic score bed (three chords: tension, the turn,
resolution — set `C1`/`C2` to the script's turning points).

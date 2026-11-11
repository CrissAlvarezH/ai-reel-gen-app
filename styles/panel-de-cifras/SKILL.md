# Panel de cifras — how to build it

The style's own part of the process (`.claude/skills/reel-studio/SKILL.md` has the steps). Palette and its
meaning, fonts, look, motion and what to avoid are in `style.json` next to this file; references in `refs/`.
Lessons: `LESSONS.md`. Template: the default one (`template/`), keeping its structure (acts, captions, times
from the voice).

## Captions: `top: 260`

The word-by-word captions block starts at **`top: 260`** (1080×1920 canvas), not 130: Instagram's top bar covers
0–220 px, and on an iPhone 15 Pro Max captions at 130 sat under it, next to the back arrow. Keep the rest of the
block as in the example (`left: 70`, `width: W - 140`, Inter 700 at 66 px, line-height 1.15): one line is centred
around y≈300, two lines end around y≈420. So the protagonist card and the world's labels start below ~440, and
nothing else goes in the 220–440 band while captions are on screen. Older videos in this style may still have 130: when
copying their `Captions` component, change `top` to 260.

## Half cards, half world

Every video mixes two ways of showing, about **50 / 50** of its running time. Neither alone: only cards feels
like a slideshow, only world loses the exact numbers.

- **Cards and numbers** (the classic look, `style.json`): one protagonist card at a time, counters that roll,
  the cream receipt that fills row by row, figures struck out in red with the real one below, comparisons,
  timelines. Use them where the exact figure, a list of steps or a side-by-side is the point.
- **A world filmed by a camera**: one wide line-art scene drawn in code on a ground line (people, the bank, the
  company, buildings, objects that stand for the idea), and a camera that travels through it. Use it for the
  story: who does what, where the money goes, cause and effect.

Plan which acts go to which before building, and say it in the comment at the top of `Film.tsx`. A common shape:
the hook and the story in the world, the exact numbers, papers and steps in cards, the close in either.

## The world

- Copy `styles/panel-de-cifras/camera.tsx` to `src/film/camera.tsx`: `camAt` (camera keys), `Stage` (the world
  as SVG under the camera), `sp` (spring pop), `arc` (a flight along an arc), `fadeIO`.
- Everything in one SVG at world coordinates, props standing on `GROUND`. Draw it wider than the screen: what's
  off frame is where the camera goes next.
- Camera keys `[frame, x, y, zoom]`, each tied to a word of the voice (`f(cue('Cada año'))`). The moves:
  wide establishing shot (≈0.5) → push in on what's being said (0.85–1.4) → pull out to show the relation →
  pan to the next place → a final push into an object (≈1.9) that hands over to the next scene. One move every
  1–3 s, with holds between them (two keys at the same pose).
- **Objects are the metaphors**, not text: a jar is a fund, an envelope flies (`arc`) into it, bundles pop in one
  per year (`sp`), the jar pours into the floors it pays for, the lid pops and the bills fly off to what they get
  spent on. People are simple line figures (head, body, arms; they can walk, look, change mouth).
- Keep a mystery before naming: the jar shows «?» until the voice says the word, then the label pops in.
- Labels and counters in the world use the same pills and colours as the cards; their meaning doesn't change.
- Check every camera pose on the board: at wide zooms text gets small for a phone (the first wide shot of
  cesantías read small for 3 s) and labels at the edges get cut; fade out labels that leave the frame.

## Between the two

- World → card: the camera pushes into an object and the card lands from that zoom; card → world, or card →
  card: the card pans out sideways or zooms out. A soft fade only when nothing better fits.
- Never a world and a protagonist card at full strength at once: one of them is dimmed or leaving.

## Sound

In the cue sheet of `audio/mix.py`, a sound for every camera move and every object event: `whoosh` on a push-in or
pan, `send_whoop` when something flies, `pop` when it lands, `blip` for a «?», `tick`/`counter` for counters,
from `audio/designed.py`. Same phrases as the picture (`at('…')`), so sound and camera hit together.

## Thumbnail

What `style.json` → `thumbnail` says: the near-black background, the topic in a few big Inter 800 words with the
keyword in black on the yellow block (like the captions), and below it one simple line drawing, from the video's
world or new, with a colour only where it means something. Nothing else. Reuse the film's `kit.tsx` props so it
looks like the video. Example: `styles/panel-de-cifras/examples/miniatura-cesantias.png` (the jar of bundles and the
building whose base floors light up green).

## Code layout

A video in this style usually splits its film in `src/film/World.tsx` (the world and its camera), `src/film/Scenes.tsx`
or `Cards.tsx` (the cards), `src/film/kit.tsx` (its props: `Person`, `Jar`, `Building`, `Envelope`, `Icon`…) and
`audio/mix.py` (sound on the camera moves). If the open project already has videos in this style, read the latest
one first and copy the props that fit; draw new ones for a new story.

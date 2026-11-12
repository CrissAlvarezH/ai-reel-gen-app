---
name: carousel
description: How an Instagram carousel (several still slides, 4:5, 1080×1350) is made in a Reel Studio workspace — idea, cover and slide copy, drawing each slide in Remotion in the carousel's style, previews, numbered versions, caption, credits and the comment automation. Use for any new or revised carousel in a project's videos/ (a folder with kind.txt = carousel). Videos are the reel-studio skill's.
---

# Reel Studio — how a carousel gets made

A carousel is a post of still slides the viewer swipes through. It lives with the videos in
`projects/<id>/videos/<slug>/` and is marked by `kind.txt` = `carousel`. There is no voice, narration, timeline,
music or video render. Ideas come from the `content-ideas` skill and hooks from `video-script` (its hook rules apply to
the cover). The profile in the prompt (language, audience, caption rules) wins over this skill; the carousel's style
wins on how it looks.

## The folder

- `carousel.json` — the draft: `{"width": 1080, "height": 1350, "slides": [{"id", "title", "text", "notes"?}]}`, in
  order. Each `id` (a-z, 0-9 and dashes, e.g. `portada`, `cifra-real`, `cta`) is **stable**. Never rename or reuse an
  id when a slide moves or is rewritten; a new slide gets a new id. Reel Studio's comments, versions and audit point at
  ids. `text` is exactly what the slide says: the audit checks it and the studio shows it, so keep it equal to the
  drawing. `title` is a short name for the creator. `notes` are optional and only for you.
- `src/slides/<id>.tsx` — each slide's picture: a default-exported React component taking `SlideProps` (`id`,
  `index`, `total`, `title`, `text`) from `src/lib.ts`. `src/lib.ts` finds them by id, so there is no list to keep
  in sync. Use `W`, `H` and `SAFE` from `src/lib.ts`, never literal sizes. Load the style's fonts in `src/Root.tsx`
  with `@remotion/google-fonts`. Shared pieces (frame, page number, header) go in `src/kit.tsx`.
- `./preview.sh [id…]` → `out/preview/<id>.png`: renders slides to look at while working. Not a version.
- `./render.sh "what changed"` → `out/vN/`, the next version. It holds `01.png … NN.png` in the order of
  `carousel.json`, `version.json` (each slide's id, title, text and a hash of its source) and `source/` (the
  `carousel.json`, `src/`, caption and credits it was made from). **A version is never edited or deleted**: comments
  and exports point at it. To change something, make the next one.
- `caption.md`, `CREDITS.md`, `automatizacion.json` — the same as a video's. `title.txt` is its name in the studio.
  `style.txt` holds its style. `from.txt`, if present, names the video whose script it started from.

## What the creator does in the studio

He sees the selected slide large, the thumbnails in order with their numbers, and a version selector (the draft or an
`out/vN`). He can drag to reorder, add, duplicate or remove slides in the draft, and render the draft as a new version.
Each change reaches you as a note: keep his order. A slide added from the studio has a placeholder drawing; redraw it
in the style. His comments arrive per slide, with its id, the number it had, the version he was looking at and its
image. Find the slide by its **id**, because it may have moved since. Look at the image before answering. He exports a
version as numbered images plus caption and credits, and publishes it (now or scheduled, from the carousel's Publicar
button) himself. Metrics for carousels are not in the app yet. Never publish another way.

## Steps

1. **Angle** — the first turn only analyses the idea and asks to start. Once he says yes, decide the promise of the
   cover, who it's for (his audience profile) and the arc: cover → 1–2 slides that pay off the cover at once →
   development, one idea per slide → summary or payoff → CTA. Usually 6–10 slides; 10 at most, the most Instagram publishes through its API (the studio refuses more). When
   it starts from a video (`from.txt`), adapt that script's idea to slides that work without the video, with their own
   cover. Don't paste the narration.
2. **Copy** — write every slide's `title` and `text` into `carousel.json` before drawing anything. The cover says the
   promise in 5–9 words and makes people swipe. Each slide holds a headline of 10 words or fewer and at most ~30 words
   of support. Spell figures as digits. Show him the list (number, id, text) and get approval. Check the facts before
   drawing: give a fresh agent only the slides' text and your sources. It opens each source, checks every claim as
   worded, recomputes the figures and says correct, nuanced or false. Fix the false ones; nuances go to the slide or
   the caption. The Auditoría page can also check them later and names the slide of each finding.
3. **Design** — read the style: `styles/<id>/style.json`, including its `carousel` block (look, avoid, examples) and
   the meaning of each colour. If the style has a skill, use it only for identity: components, drawings and tone. Its
   video rules (captions, camera, timing) don't apply. Keep text inside the `SAFE` margin and out of the side strips the
   profile grid crops to 3:4. Body text must be readable on a phone: 34 px or more, notes 28 px or more. Number slides
   with `index`/`total` when the style shows a counter.
4. **Draw** — one `src/slides/<id>.tsx` per slide. `./preview.sh <id>` as you go, and open each PNG to look at it.
   Images: search the web freely, download into `assets/src/` and credit every one in `CREDITS.md`.
5. **Version** — `./render.sh "first version"` → `out/v1/`. Open the sheet of slides (or each PNG) and check: order,
   nothing cut off, text inside margins, the same look across slides, numbers right. Then tell him which version it
   is and what to look at.
6. **Caption and automation** — `caption.md` follows the profile's caption rules. Its opening raises the cover's
   question rather than answering it, and it asks people to save or share. Add a credits line only for third-party
   images that need attribution. If the carousel asks people to comment a word, write `automatizacion.json` with
   `keyword`, `reply`, `dm` and `link`, as strings, copied as is. Leave empty what's missing and never invent a link.
7. **Revisions** — comments → change the slides by id → `./preview.sh` → `./render.sh "what changed"` → say which
   version and what changed. Keep what was approved and change the least you can.

## After a carousel

Customer content stays local and out of the app's repository. Add what cost a revision to `LESSONS.md`, one line each
with the reason, under a "Carruseles" heading.

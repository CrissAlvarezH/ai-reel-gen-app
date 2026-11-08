---
name: reel-studio
description: How a narrated explainer video is made in a Reel Studio workspace, in any visual style — script, pictures, voice, images, build, board, sound, mute test, render — following the creator's settings from the studio (profile, format, voice, image sources). Use for any new or revised video in a project's videos/ (projects/<id>/videos/). The video's style adds its own skill (styles/<id>/SKILL.md) for the look and the Remotion kit; LESSONS.md has what past videos taught.
---

# Reel Studio — how a video gets made

The process is the same for every style. What a video looks and sounds like comes from its style; who it is
for, its format, the voice and where pictures may come from come from the studio's settings. The generic
`animated-video` skill holds the wider method (brainstorm, board, mute test, review); where it differs, this
skill and the style's win. Ask with a recommendation so "yes" is a full answer. Coming up with ideas and saving them on the
project's board is the `content-ideas` skill's, before this process starts.

## The workspace

- `projects/<id>/` — a project: one channel the creator makes videos for (the studio's project selector; the
  prompt says which one is open). Its `config/` holds its settings (Ajustes): `profile.json`, `voice.json` and
  `account.json` (its Instagram, Mi cuenta); `account/` what was downloaded of that account. Don't touch another
  project's folder unless asked.
- `projects/<id>/videos/<slug>/` — one video: a Remotion project copied from its style's template. `title.txt` (its name in
  the studio), `style.txt` (a style id), `audio/vo.txt` (the narration, exactly as it goes to the voice),
  `audio/beats.json` (the script's structure), `src/format.json` (size, fps, loudness), `CREDITS.md`,
  `caption.md`, `out/` (renders, boards, `miniatura.png` the cover; not versioned).
- `formats/<id>/format.json` — a format: the kind of video (all animation over a generated voice or over the
  creator's recorded voice; the creator talking to camera with animations…), what's on screen and how it's cut. A video names its format in `format.txt`
  (none: the default, animated). `skill` points to its own instructions, `overlay` to files it adds over the
  style's template; `"footage": true` means the video starts from his recording in `footage/`
  (`"voiceOnly": true`: only its sound — audios — is used).
- `styles/<id>/style.json` — a style: palette and what each colour means, fonts, look, motion, images, what to
  avoid. `skill` points to its own instructions, `template` to the Remotion project new videos copy.
- `config/` (at the root) — settings shared by every project: `images.json` (image sources), `social.json` (scraper).
- `tools/` — shared scripts. `LESSONS.md` — lessons from past videos.
- `projects/<id>/inspiration/<account>/` — other accounts' reels studied in the project's Inspiración page: `account.json`
  (`analysis.text`: what works for that account) and per reel `reel.json` (metrics, caption), `transcript.json`,
  `analysis.json` (hook, structure, visuals, CTA, what to take), `hook.jpg` (first 3 s) and `sheet_NN.jpg` (1 frame/s).
  Use them for angles and hooks when asked; adapt to the creator's profile, never copy a script.

## Settings come from the studio

Reel Studio puts the profile (language, platform, audience, length, caption rules), the video's format, the
voice and the image sources in your prompt on every turn. They win over this skill and the style's. Never
hardcode a voice id or settings, a size, a frame rate or a loudness target.

API keys live in the workspace's `.env` (set in Ajustes, next to what each is for: Voz, Extracción de datos). The tools read them; never print a
key or ask for one in the chat — if one is missing, ask the creator to add it in Ajustes.

Python: tools that only use the standard library run with `python3` (`python` on Windows): `tts.py`,
`el_words.py`, `standin_words.py`, `commons.py`, `openverse.py`, `pexels.py`, `pixabay.py`, `unsplash.py`, `generate_image.py`. Tools that
need packages run with the workspace's venv, `../../../../.venv/bin/python` (Windows: `../../../../.venv/Scripts/python.exe`):
`cutout.py`, `audio/mix.py` and `sheet.py` (`snap.sh` uses it, or ffmpeg when there is no venv). Styles that
make cutouts need the venv (Ajustes → Requisitos installs it). Paths below are from the video's folder.

## Before you start

Read the video's format: `formats/<id from format.txt>/format.json` and, if it has one, its skill — it says how this
kind of video is made and wins over the steps below where they differ (e.g. with his recording there is no script to
write or voice to generate: the cut gives both). Read the video's style: `styles/<id from style.txt>/style.json` and,
if it has one, its skill. The format never decides colours, type or borders: that's the style's. Read
`LESSONS.md` (the general part and the style's). A style without a skill or template is built on the default
style's template (`template/`), with the look changed to its `style.json`; say so when you start.

## Steps

1. **New video** — the studio creates it from the first message (folder, title, style, format, size). From a
   terminal or the general conversation: `scripts/new-video.sh <slug> [style] [format]`. From the general
   conversation, to go on working it yourself, move this conversation to the video you just created:
   `curl -s -X POST "$REEL_STUDIO_URL/api/chat/_general/$REEL_STUDIO_CHAT/move" -H "Content-Type: application/json" -d '{"slug":"<slug>"}'`.
   It moves when your turn ends (same session; the studio opens the video). Only once, and only to a video you
   created in it: a video's conversation never moves.
2. **Script** — with the `video-script` skill (hook, holding the answer, timing, checklist), starting from the idea's
   notes if it comes from the board. Platform, language, audience and length
   from the profile; words ≈ the voice's measured pace × the target seconds. Goal: reach, unless told otherwise.
   Spell numbers out in `audio/vo.txt` ("mil cuarenta y dos") and map them back to digits in `src/captions.ts`
   `DISPLAY`. Get approval. Write `audio/vo.txt` and `audio/beats.json`.
   **Claim check** — always, also when working alone (an automation, "de forma autónoma"), before the voice: give a
   fresh agent only `audio/vo.txt`, the planned on-screen figures and notes, and the sources. It opens each source,
   checks every claim as worded in the script, recomputes the figures and returns each claim as correct, nuanced or
   false. Fix the false ones before generating the voice; nuances go to `caption.md`. If it can't finish, run it again
   (or say plainly that it didn't run): never replace it with your own check.
3. **Pictures** — brainstorm a picture per beat with a fresh agent (animated-video → find the pictures). Prefer
   **one recurring physical motif that plays the system** across the film (a card-catalog cabinet = the server,
   drawers = records). The pictures keep the script's question open: the first frame raises it, and no picture or
   on-screen title shows the answer before the narration gets there. Get the concept approved.
4. **Voice** — `python3 ../../../../tools/tts.py audio/vo.txt audio/vo.mp3`, then
   `ffmpeg -y -i audio/vo.mp3 -ar 48000 public/vo.wav` and
   `python3 ../../../../tools/el_words.py audio/vo.alignment.json public/vo.wav` (→ `src/words.json`, `src/vo_env.json`).
   Before the voice exists: `python3 ../../../../tools/standin_words.py audio/vo.txt src/words.json` (timed at the
   voice's pace; call it a stand-in). Make a short sample first when anything about the voice changes. Use the
   audio as returned (don't trim pauses unless asked). Every generation costs characters: don't regenerate
   without a reason.
5. **Images** — search freely on the web using available search and browsing tools; any site can be a source.
   The prompt lists optional API integrations, not an allowlist or mandatory order. Use those APIs only when
   enabled and configured; free web search needs no source settings. Downloads go in `assets/src/` (not
   versioned); record every image in `CREDITS.md` (title, author, licence when known, original link; never invent a licence). When stock won't do, ask for
   a phone photo of the exact gesture (plain backdrop, good light). How images are treated is the style's.
6. **Build** — acts in `src/lib.ts` `ACTS` (cut ~0.08 s before each act's first word), captions as sense units in
   `src/captions.ts` (checked word for word against the transcript), one scene per act in `src/film/scenes.tsx`.
   Every time comes from a cue (`cue('phrase')`, `at('phrase')`), so a new voice re-times the film. Sizes and
   frames from `src/lib.ts` (`W`, `H`, `FPS`, `f()`), never literal numbers. The components are the style's.
7. **Board** — `./snap.sh out/board <sec> …` renders stills and `sheet.png`. The sheet shades in red where
   Instagram's interface covers the frame (`SHEET_UI=tiktok|youtube|none` for others): no caption, number or
   footnote may sit in red; fix it before showing. Show a key frame per beat; get approval. Pass the times literally (in zsh a space-separated list in one variable doesn't split).
8. **Sound** — the cue sheet in `audio/mix.py`, with times from the same cues the scenes use;
   `../../../../.venv/bin/python audio/mix.py` → `public/mix.wav`; set `audio: true` in `src/Root.tsx`. Which sounds:
   the style's. Say at delivery which sounds are synthetic.
9. **Mute test** — before the first full cut:
   `ffmpeg -i out/<name>.mp4 -vf "fps=2,scale=270:-1,tile=8x5" out/mute/sheet_%02d.png` and give only those
   sheets to a fresh agent (ignore captions; retell; list confusions and breakage). Fix, re-check stills.
10. **Render** — on macOS and Linux reap orphaned renderers first:
    `ps -A -o pid=,ppid=,command= | awk '$2==1 && /chrome-headless-shell/ {print $1}' | xargs kill`. Then
    `CONCURRENCY=3 ./render.sh <name>` → `out/<name>.mp4`, normalised to the format's loudness. Check duration,
    loudness, first and last frame. Write `caption.md` with the profile's caption rules and the credits; its opening raises the hook's question rather than answering it. If the video or caption asks people to comment a word to receive something, write `automatizacion.json` (Reel Studio → Instrucciones automatización) with what gets pasted into ManyChat or InstantDM, as strings: `keyword` (the exact word), `reply` (the public reply to the comment), `dm` (the direct message) and `link`. Each is copied as is, so no notes inside them; leave empty what's missing and never invent a link.
    **Thumbnail** — the cover posted with the reel, as its style's `thumbnail` in `style.json` says (look, avoid,
    example; a style without one: its palette and fonts, a few big words of what the video is about and one simple
    picture). Write it in `src/thumbnail/Thumbnail.tsx` (its own entry, `src/thumbnail/index.tsx`, loads its fonts;
    leave `src/Root.tsx` alone) and `./thumb.sh` → `out/miniatura.png`, next to the renders (Reel Studio → Miniatura).
    A video without them: copy `thumb.sh` and `src/thumbnail/` from `template/`. That folder doesn't count as a
    change to the film, so the render stays current; never change file dates. Its picture can be the film's own (render a scene's
    component at a chosen frame, or reuse its props) or a new one. It says what the video is about without giving
    the answer, and all its text fits the centred 3:4 the profile grid shows. Look at it before reporting. Report
    the path, open issues, skipped checks, what is synthetic or invented, and the credits. Say whether the claim check
    and the mute test ran, and what each one changed.

## After a video

Customer projects, videos, preferences, custom styles and personal lessons stay local and are ignored by
the application's repository. Do not commit or push them there, including after a render; never force-add
ignored data. A separate repository for customer content requires the creator's explicit request.

Add what cost a revision to `LESSONS.md`, one line each with the reason, under the general part or the style's.

When the posted video's numbers come back, read them with `video-script` → Review. Getting from idea to posted quickly
matters, because many videos will flop and each one teaches something, so a new version changes the least it can: keep
what was approved, change only what's being tested (a new hook, a cut where people left), and regenerate the voice only
for narration that changed. Don't add polish nobody asked for.

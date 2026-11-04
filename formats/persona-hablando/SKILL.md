---
name: persona-hablando
description: The "Persona hablando + animaciones" format of a Reel Studio video — the creator talks to camera in his own recording; you transcribe it, agree the cuts with him (pauses, flubs, retakes), cut it, and lay the video's style animations over or between his shots. Use for any video whose format.txt says persona-hablando.
---

# Persona hablando + animaciones

The creator recorded himself talking. His recording is the narration: there is no generated voice (don't run
`tools/tts.py` or `standin_words.py`). Everything else follows the `reel-studio` skill and the video's style skill:
the style says how the animations look; this format says how his footage is cut and where the animations go.
`formats/persona-hablando/format.json` lists the rules he sees on the Formatos page — follow them.

## Files

- `footage/` — his clips, in the order they play (names start `01-`, `02-`…). He uploads them in the studio (Nuevo
  reel, or the video's page → Grabación). Not versioned; never edit or delete them.
- `audio/takes.json` — each clip's words with times (from `footage.py transcribe`).
- `audio/edit.json` — the cut: the pieces that stay, in order. Yours to edit, with his approval.
- `public/footage.mp4`, `public/vo.wav` — the cut and its sound (from `footage.py cut`). `vo.wav` is the narration:
  `audio/mix.py` mixes it like a generated voice.
- `src/words.json`, `src/vo_env.json`, `src/footage.json`, `audio/vo.txt` — written by the cut: the words on the
  cut's clock (so `cue()`, `ACTS` and captions work as always), and where each piece starts (`JUMPS`).
- `src/talk/Footage.tsx` — `<Footage />`, the cut as a muted video layer; `cutZoom(t)` alternates zoom per piece.

The tool runs with the venv (it uses faster-whisper: Ajustes → Requisitos → Transcripción; if it's missing, ask him
to install it there): `../../../../.venv/bin/python ../../../../tools/footage.py …` from the video's folder.

## Steps

1. **Transcribe** — `footage.py transcribe --lang <the profile's language code, e.g. es>`. It prints the pieces of a
   first cut (speech split at pauses > 0.4 s), numbered, with their text. New clips added later are transcribed
   and appended at the end, without touching the pieces already there.
2. **Propose the cuts** — read the pieces as an editor: false starts, flubs, "eh"/"este" fillers that drag, a
   sentence said twice (keep the last good take, unless the first one is clearly better), tangents that don't
   serve the video's idea, a weak opening when a stronger hook is said later. Show him a short numbered list —
   piece, what's said, what you'd do and why — and the resulting length against the profile's target. One
   message, with your recommendation, so "sí" is a full answer. Never cut without his approval.
   `footage.py show N` prints piece N's words with times when a cut falls inside a piece: split it in two in
   `edit.json` around the flub (cut ~0.05 s before a word starts and ~0.15 s after one ends, never mid-word).
3. **Cut** — edit `audio/edit.json` (delete, trim, split or reorder pieces), then `footage.py cut`. Check the
   printed length, look at a few frames (`./snap.sh out/cut <sec> …` once `<Footage />` is in the film) and ask
   him to watch the cut in the studio's player before animating: "Guion" and "Cortes" both count from here.
   If he asks for changes, edit `edit.json` and cut again: the words, the captions' text and the timings follow.
   `audio/vo.txt` is rewritten by every cut: it says what he said, so don't edit it to change the script — change
   the cut. Tag `audio/beats.json` against its lines as usual.
4. **Script check** — the `video-script` checklist still applies to what he said: hook in the first seconds,
   one idea, an answer that isn't given away early, payoff, CTA. If the hook is weak, propose a reorder (a piece from later) or a line he could
   re-record, rather than animating around it.
5. **Animations** — brainstorm with the style's visual language a picture per idea (reel-studio → Pictures).
   Three ways to place them, chosen per beat:
   - **Beside him** (most of the time): he stays full frame; the animation lives in the free part of the frame
     (usually the top third or the bottom third, away from his face) or as a card. Numbers, lists, terms,
     comparisons.
   - **Full screen** (a few seconds): the animation covers the frame and his voice keeps going. For what is better
     seen than said (a process, a map, a chart). Come back to his face before he makes the next point.
   - **None**: when he is making an emotional or personal point, his face is the picture.
   Find his face's position in the frame first (a still of the cut) and keep it clear: never cover his eyes or mouth.
6. **Build** — `src/film/Film.tsx`: `<Footage zoom={cutZoom(t)} />` as the bottom layer (instead of the style's
   background), the scenes on top, captions over both, `<Audio src={staticFile('mix.wav')} />` as always. The
   style's backgrounds and paper textures belong to full-screen beats only. Acts in `src/lib.ts` from `cue()` as
   usual; the template's `TOTAL` holds the last frame for the closing second.
   Each jump between pieces (`JUMPS`) needs a cover: `cutZoom` alternates the framing, or an animation entering
   on that cut.
7. **Board, sound, mute test, render** — as in `reel-studio`. In the mute test, the frames must make sense
   without sound: if long stretches are only his face, say so and propose where an animation would carry the idea.

## Delivery

Report the cut's length, how many pieces were removed and why (in a line), what is animated where, and anything
synthetic. Record in `LESSONS.md` (general part) what cost a revision of the cut.

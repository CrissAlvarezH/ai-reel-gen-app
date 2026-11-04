---
name: animado-con-tu-voz
description: The "Video animado sobre tu voz" format of a Reel Studio video — the creator recorded his voice (one or more audios); you transcribe it, agree the cuts with him (pauses, flubs, retakes), cut it, and the whole video is the style's animation over his voice. Use for any video whose format.txt says animado-con-tu-voz.
---

# Video animado sobre tu voz

The creator recorded his own voice. It is the narration: there is no generated voice (don't run `tools/tts.py` or
`standin_words.py`) and he is never on screen. The cutting of his recording works like the `persona-hablando`
format (`formats/persona-hablando/SKILL.md`, steps 1–4: transcribe, propose the cuts, cut, script check) — read
those steps and follow them, with these differences. Everything after the cut is the `reel-studio` skill and the
video's style skill as for any animated video. `formats/animado-con-tu-voz/format.json` lists the rules he sees on
the Formatos page — follow them.

## Files

- `footage/` — his audios, in the order they play (names start `01-`, `02-`…): M4A, MP3, WAV… or a video, of which
  only the sound is used. He uploads them in the studio (Nuevo reel, or the video's page → Tu voz). Not versioned;
  never edit or delete them.
- `audio/takes.json`, `audio/edit.json` — as in `persona-hablando`.
- `public/vo.wav` — the cut of his voice (from `footage.py cut`): the narration, mixed by `audio/mix.py` like a
  generated voice. There is no `public/footage.mp4` and no `<Footage />`.
- `src/words.json`, `src/vo_env.json`, `audio/vo.txt` — written by the cut: the words on the cut's clock, so
  `cue()`, `ACTS` and captions work as always. `audio/vo.txt` says what he said: change the cut, not the file.

The tool runs with the venv (faster-whisper: Ajustes → Requisitos → Transcripción; if it's missing, ask him to
install it there): `../../../../.venv/bin/python ../../../../tools/footage.py …` from the video's folder.
`cut` makes only the sound for this format (it reads `format.txt`; `--voice` forces it).

## Steps

1. **Transcribe, propose the cuts, cut, script check** — `persona-hablando` steps 1–4. There is no picture to
   check after the cut: ask him to listen to it instead (the studio's player once there's a render; until then
   say the length and what was removed). Cut points matter more here than with a face on screen: no jump to
   cover, but a breath eaten or a word clipped is heard. Listen for loud clicks or a level change between audios
   recorded apart; if one is clearly louder, say so (`mix.py` normalises the whole, not each piece).
2. **Pictures, build, board, sound, mute test, render** — `reel-studio` from Pictures on, exactly as an animated
   video with a generated voice: the style's backgrounds, scenes full frame, captions, `<Audio src={staticFile('mix.wav')} />`.
   Scene changes land on the cut's pieces or on natural pauses in his voice (`src/footage.json` lists where each
   piece starts, `words.json` the pauses).

## Delivery

Report the cut's length, how many pieces were removed and why (in a line), and anything synthetic. Record in
`LESSONS.md` (general part) what cost a revision of the cut.

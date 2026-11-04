# Review: motion, judges, mute test, restart

## Motion

Stills can't show the difference between a second where one thing drifts and a second where many
things transform, so check motion moving, or as strips of consecutive frames.
- **Look for holds:** stretches where the voice explains and the picture only drifts or pans. In
  two rejected explainers the composition stayed nearly unchanged three to four times as often as
  in the film they were measured against.
- **Each beat has an event.** Secondary action it causes, the place's own life and a camera that
  answers it (with anticipation and settle) make it physical.
- **Effects are punctuation:** tied to an event, brief, the hero kept in view.
- `templates/remotion-film/motion_check.py film CUT.mp4 --bar BAR.mp4` counts separately moving
  things second by second against a film the user accepted and writes frame strips of the
  stillest seconds. Read it as a diagnosis, then fix with better pictures.
- When a film reads flat beside its anchor, put matched beats side by side at the same size and
  measure what differs: near-flat and near-black area, edge density, chroma, repeated frames
  (perceptual hash), camera movement versus objects moving.

## Temporal checks

On each shot's fastest second, and on every 3D shot. When a tool can play the shot, watch it at
full speed first. Then:
1. **Consecutive frames.** Tile one second around the fastest motion: one second is `fps` frames
   from frame `start_s × fps`; at 24 fps, seconds 2–3:
   `ffmpeg -i shot.mp4 -vf "select='between(n\,48\,71)',scale=480:-1,tile=6x4" -frames:v 1 -fps_mode vfr sheet.png`
   (at 30 fps, `between(n\,60\,89)` and `tile=6x5`). Look for popping detail, sliding contacts,
   crawling shadow edges and textures swimming across surfaces.
2. **Flicker.** Mean brightness per frame:
   `ffprobe -v error -f lavfi -i "movie=shot.mp4,signalstats" -show_entries frame_tags=lavfi.signalstats.YAVG -of csv=p=0`.
   A one- or two-frame jump that the camera, objects and light don't explain is worth finding in
   the frames. Common causes: a shadow camera that moves with the view, noise that changes every
   frame, per-frame denoising.
3. **Determinism.** Render a few frames twice and compare `ffmpeg -i a/%04d.png -f framemd5 -`
   with the same for `b/`. A difference points at an unseeded random value, a clock or a late
   texture (GPU path tracing and denoisers can also differ slightly); look before calling it a bug.

These are screening, not pass marks.

## Judges

Independent fresh agents judge a render against the current brief and platform, extracting frames
themselves and relating them to `words.json`. Useful output: issues with time ranges and fixes,
plus what to keep, so fixes don't break what works. Between them, cover:
- **Motion:** on-model consistency, acting, continuity across cuts, broken frames, a presenter's
  eyeline at every cut.
- **Story and ideas:** does frame 0 stop the scroll; can a newcomer retell what physically
  happens in each line with the sound off; which pictures would a viewer share, and which are the
  literal default a better idea would beat; dead stretches.
- **Design and sound:** the bar against each shot's anchor frame, whether the accent is where the
  eye should go, safe zones, caption legibility, and the audio measured with ffmpeg (VO-to-bed
  ratio, masking, loudness, true peak, effects on their events).

Scores plateau fast and recalibrate between rounds (one film's judges stuck at 6–7 out of 10
across rework): track open issues, not the number. The top issue after a couple of rounds is
usually one only the user can decide.

**Real footage:** each real clip must show what the words over it claim. A fresh agent checking
frames it extracts itself, through the crop actually used, catches what descriptions hide: on one
film a crop centred on the wrong rocket stage, misspelled creator handles, and a borrowed clip's
trailing frames.

Breakages to look for on every contact sheet: limbs lost when a shot is cropped, ghosting from
opacity fades, recurring entities changing scale, an empty first frame after a canvas mounts, and
a blurred or unstable final frame.

## Mute test

Does the picture tell the story without the voice? Run it on each act as it lands (a miss found
only at the full cut costs a late act re-render), on the first full cut, and on an
animatic when there is one.
1. Render the cut with no captions and no sound (`--props='{"captions":false}' --muted`);
   captions would hand the judge the narration.
2. Give a fresh judge (it has never seen the script, the plans or your notes) frames in order,
   with timestamps, dense enough to follow each action, and ask: "Describe what happens and what
   it explains, second by second. Say where you can't tell."
3. List the script's claims, one per sentence. A claim is recovered when the judge's account
   states it or shows its mechanism. Each missed claim goes back to its shot with the judge's
   words.

## Restart after a rejected cut

When the user rejects a whole cut ("low quality", "not immersive", "start over"), the problem is
the pictures or the concept, not the shots. Stop all builds and renders. A fresh agent judges the
finished film (and any reference film) before reading the plans; give it the films and the
script, not your own diagnosis, and ask for ranked problems, what to keep and different
directions. Take the user's notes on it, record what they lock (often the script, the voice and
any camera footage), and restart at step 1 of the skill. A new agent carrying the lessons avoids
inheriting the old plan's assumptions.

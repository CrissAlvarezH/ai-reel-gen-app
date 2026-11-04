# Motion kit (three.js in Remotion)

Tested primitives for dense, layered, physical motion: many parts flying between layouts with their
own timing, machine-like secondary motion, ballistic sparks and debris, impacts that light their
surroundings, a camera that ramps, whips, orbits and shakes, and a shutter with real motion blur.
Writing this per shot is what gets cut under time pressure; calling it is cheap.

Everything is a pure function of a (float) frame number and seeds: no clocks, no `Math.random`, no
state carried between frames. A still is the render, and the shutter can pose the scene at any
sub-frame time.

## Setup

Copy `motion/` and `realism/noise.ts` (the camera shake uses its noise) into the film's
`src/kit/`, plus the template's `three-canvas.tsx` and `finish.tsx`. It needs `three` (with its
add-ons), `@react-three/fiber` and `@remotion/three`; imports use `.ts` extensions, so set
`allowImportingTsExtensions`. Check the CPU side with `node src/kit/motion/selftest.ts` (Node 22.6+).

## How a shot is built

Build the set once (`useMemo`), then write one `update(t)` that poses everything for a float output
frame `t`: parts, lights, uniforms, effects, camera. Hand it to the shutter, which calls it once per
sub-frame sample and takes over drawing:

```tsx
const shot = useMemo(() => buildShot(gl, scene, camera), [gl, scene, camera]);
<Shutter fr={frame} pose={shot.update} samples={n} shutter={0.3}
         soft={{layer: BG, px: 11}} bloom={{threshold: 1.1}} ripple={shot.ripple(frame)} />
```

Keep timing constants in a pure events module (no React or three) that also exports
`EVENTS: {id, fr, what}` for the cue sheet. With hit-stops, choreograph in story frames and export
`timeline(stops).output(storyFrame)`.

## Effects and the hero

Sparks, streaks, flashes, rings and debris compete with the hero of the beat, so the kit's defaults
keep them as punctuation: tied to a real event (metal cut, hit or scraped; an impact; a
discharge), a handful rather than a fountain, gone within about 8–12 frames, and faded where they
cross the hero. `burst()` lives 4–11 frames unless given a `life`. `budget()` (`budget.ts`) caps
live particles per burst (`maxLive`, default 40) and bursts at once (`maxBursts`, default 2; an
older one fades over 3 frames), and fades every particle in front of the hero's screen box to
`cover` (6%). Pass the beat's hero as a world `Box3` each frame (`fx.frame(fr, camera, box)`) and
use `fx.alpha(p)` for anything else that might cross it (rain, dust). Density reads best from parts
and mechanisms (slides, hinges, latches, spin-ups, staggered waves, a camera answering events).
Raise the limits when the effect is the subject.

## API in brief

**`time.ts`** — timing.
- `ramp({peak, inP, outP})` speed-ramp ease: slow, a fast middle, slow; `outP: 1` arrives at speed.
  Presets `easeInOut`, `whip` (nearly all motion in the middle third), `easeOut`.
- `move(fr, {start, dur, antic, anticDur, peak, inP, outP, lock})` progress with a wind-up before
  `start` (negative values) and either a soft stop or, with `lock`, a slam that overshoots and rings
  (a damped oscillator launched at the arrival speed). `arrive(m)` is the contact frame.
- `spring(frames, {freq, damp})`, `kick(fr, at, {freq, decay})` (a recoil that starts at 0 with speed).
- `stagger(keys, {spread, curve, waves, gap, jitter, seed})` per-item delays ordered by any key
  (index, distance from a point for a radial wave, height, `rand`).
- `timeline(stops)` hit-stop and slow motion: `story(fr)` for the action, `output(sfr)` for events.
- `energy(fr, hits)` how hard the shot is hitting (rises before each hit, decays after). Drive
  layers from it with lags: primary `energy(fr)`, secondary `energy(fr - 3)`, ambient `energy(fr - 8)`.
- `flash(fr, at, {attack, decay})` envelope for impact lights; `rand(seed, i, k)`, `range()`.

**`parts.ts`** — assemble, disassemble, transform.
- `plan(parts[{from, to}], opts)` → legs. Each part gets its own delay (stagger by `order`, default
  distance from the centre), duration (`durVar`), tumble (`turns` whole turns about a seeded axis),
  wind-up and arrival. Paths are Bezier curves that bow away from `center` (`arc`), with a sideways
  lane by stagger rank (`layer`) so neighbours pass rather than collide; `arcEnd` < 0 lands moving
  outward (explosions), > 0 comes in from outside (assembly); `lift` swings everything up and over.
- `fly(fr, leg, object3D)` poses a part, returns progress; `departs(leg)` the frame it starts
  moving (the previous stage must hand it over exactly there); `speed(fr, leg)` for streaks.
- `explode(poses, {center, scale, push, jitter, tilt})` an exploded-view layout.

**`mech.ts`** — secondary mechanics, each a scalar for one local transform.
`slide` (wind-up, soft stop or slam), `hinge` (gravity swing that bounces at its stop), `unfold`
(a run of hinges), `spin` (smooth spin-up/down; the angle is the exact integral of speed),
`latch` (travel plus the jolt it gives its host), `screw` (sinks while turning, seats with a jolt;
negative depth backs it out), `piston` (crank-slider), `gear` (meshed ratio).

**`physics.ts`** — `burst({n, seed, at, spread, origin, dir, cone, speed, inherit, gravity, drag,
floor, bounce, friction, life, spin, sizes})` simulates once at four sub-steps per frame (gravity,
drag, bounces with friction on a floor plane), then `at(fr, i, out)` → age or -1, `tail(fr, i, back,
out)`, `turn(fr, i)`, `size[i]` (power law: many small, few large). `heat(age)` is a cooling spark's
HDR colour. Units are the scene's: a centimetre scene uses gravity 980.

**`budget.ts`** — `budget({maxBursts, maxLive, cover, pad})` → `frame(fr, camera, heroBox)`,
`each(bursts, fn(b, i, p, age, alpha))`, `alpha(p)`.

**`fx.ts`** — one draw call each, filled per frame.
`streaks(max)` camera-facing segments (sparks, rain, trails; brightest at the head, energy-conserving
by length, never under ~1 px), `puffs(max)` soft or bokeh sprites (dust, smoke, mist, defocused
lights), `ring()` shockwave annulus, `shell()` expanding wavefront, `chunks(geo, mat, max)` lit
instanced debris posed from bursts (`keep(p, i, age)` drops or nudges pieces).

**`camera.ts`** — `rig(keys[{at, pos, look, mm, roll, ease}])` keyframed in frames (Catmull-Rom
through positions and look points, focal length interpolated in log space; an `ease` that
overshoots carries the camera past its key and back). `orbit(center, r, h, deg)` writes orbit keys.
`shake(fr, hits[{at, amp, len, freq}])` trauma² noise, mostly rotation, starting a frame after the
hit; `aim(camera, pose, shake)`; `pixelSpeed(rig, fr)` for choosing blur samples.

**`shutter.tsx`** — `<Shutter fr pose samples shutter soft bloom ripple msaa>`: renders `samples`
sub-frame times across a centred shutter with sub-pixel jitter (motion blur plus supersampling),
averages in linear light (non-finite pixels zeroed so bloom can't black out a frame), optional soft
background layer (`soft`: objects on that layer drawn at half size and blurred, a cheap depth of
field for a macro subject in a big place), linear-light bloom, a screen-space shockwave ripple,
then tone maps once. Shadows update once per frame (first sample). `blurSamples(px)` helper.

## Motion rules (from feature-film transformation and action work)

From published VFX breakdowns and interviews (ILM, Weta FX, MPC; Transformers, Pacific Rim,
Bumblebee) and game-feel talks. Starting points, not limits.

Transformation
- Make the base action read before any part moves; add parts on top. Anchor parts move first and the
  rest grows out of them: structure, then panels, then small parts (screws, clips) running into the
  settle.
- Parts lever, slide, rotate and click; nothing floats into place. Prefer clean 90° and 180° turns.
- Offset settles by a few frames, every link delayed a little, so parts don't all stop on one frame.
- Cheat freely: volume, scale (small parts scaled up to read), parts that hide or pass while the eye
  is elsewhere. Keep the camera within ~10° of the angle a transformation was designed for while its
  parts move; re-choreograph rather than orbit through it.
- Length is a choice per shot (one rig offered 25 or 40 frames at 24 fps); hold the finished
  silhouette long enough to read.

Weight and timing
- Big masses move smoothly; hard stops and recoil belong to small parts.
- Lock-in: a short wind-up, a full-speed approach into the hit, a frame of overshoot and a brief
  settle with a small recoil; `move({lock})` defaults give this.
- Anything landing on a surface stops dead at contact (`outP: 1`, no `lock`); the bounce comes from
  the recoil of what it hit. A lock overshoot along the path sends it through the surface.
- Hit-stop: 1–3 frames at 24–30 fps on the biggest hits only, shorter when hits repeat.
- Speed ramps: fast to very slow and back.
- Keep gravity real in scene units; fall time tells the viewer the scale.

Particles, light, camera
- Sparks: a spritz lasts 3–4 frames; showers arc, bounce and split. Debris sizes follow a power law
  (one large, a few medium, many small). Every contact makes dust, grit or splash, and settled debris
  stays.
- Interactive light is real light (a point light on the burst, intensity following the particles,
  3–6 frame decay), not an overlay.
- Shoot low; let the subject pass over the lens; keep foreground parallax. Smooth arcs when the hero
  is in control, whips when it isn't (a whip is ~7–10 frames). Shake is trauma², mostly rotation,
  ~0.15–0.5 s; longer turns into motion sickness.
- Motion blur: film-standard 180° smears dense small parts; action work used 90° or less, 45° for
  explosions. The kit defaults to ~108° (`shutter: 0.3`).

## Lessons from the test shot

A 7.5 s vertical shot: a phone above a wet rooftop ledge at night comes apart into its real parts,
the parts rebuild into a transmitter that fires a signal across the city, then fly back and slam
together. Measured there, not general truths:
- **Cost:** 1080×1920, 6–16 samples per frame chosen from camera speed and `energy`, MSAA 4, soft
  background, bloom: about 0.3 s per frame per render worker on an Apple-silicon laptop (225 frames
  in 34 s at concurrency 2, 1 GB peak). Re-rendered frames were bit-identical.
- **A first cut with hundreds of sparks per hit, steam, smoke, motes and lens drops** hid the
  important thing; six tiny bursts plus mechanisms read better. One large surface sweeping across
  frame read as one thing moving; several mid-size parts deploying in a stagger read as many.
- **Thin hot things step:** a bright 1–2 px line moving fast shows as separate copies under ~10
  samples. Raise samples with `energy` around hits rather than everywhere.
- **Secondary motion must know its host's state:** flex cables that fluttered with the shot's
  energy kept swinging after their part docked and cut through the glass; scale flutter by the
  part's own flight.
- **Assembly order is physical:** screws driven after the cover closed poked through it.
- **Parts flying straight at a close lens fill the frame for several frames;** send them sideways.
- **A far set taller than the subject's horizon walls off the sky:** put near neighbours below eye
  level and the skyline far away, or the background reads as a black void.

## What it does not do

True depth of field (the soft layer is one blur level; sharp and soft layers can't occlude each
other), reflections of the scene in wet or glossy surfaces beyond the environment map, per-sample
shadows, cloth or rigid-body simulation between parts (paths are choreographed and can intersect if
planned carelessly), and automatic collision checks. City lights in the test shot are sprites sized
to the lens's blur, not lit geometry.

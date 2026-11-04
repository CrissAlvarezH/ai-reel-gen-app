# Parts

Recurring objects, kits and sounds built for earlier films and kept because other films need them.
Unlike `remotion-film/`, these have a look: copy what the story needs into the same paths in your
film and restyle it to the film's look.

| Part | Files | What it is |
| --- | --- | --- |
| Globe | `src/kit/globe.tsx`, `globe-web-data.ts`, `globe-web-gen.mts`, `public/earth_day.jpg`, `public/earth_night.jpg` | A three.js planet on its night side (moonlit navy, city lights, limb glow, optional real day side), a star field, and an illustrative web of 608 undersea cables that draws on as a wave. `ll()`, `arc()` and `over()` place points and cameras; API in the file's header. |
| Phone | `src/kit/phone.tsx` | A modelled iPhone whose screen is a dark-mode iMessage thread or lock screen, redrawn each frame from a plain state object: messages appearing, a photo flying up from the compose bar, the send arrow pressed, a keyboard, "Delivered", a notification. `phoneLayout()` and `screenPoint()` let a thumb hit the real send arrow. |
| Realism kit | `src/kit/realism/*.ts` | three.js building blocks for detailed outdoor 3D: sky with PMREM environment, ground bounce and matching sun; a shadow setup that holds still under a moving camera; seeded grass, flowers, trees, rocks and flagstones; shader patches for wind, weathering, height haze and translucent foliage; a lens-and-path camera. Usage and measured settings: [realistic 3D](../../styles/realistic-3d/README.md). |
| Motion kit | `src/kit/motion/*` (needs `realism/noise.ts`) | Pure-function primitives for dense three.js motion: staggered multi-part flights, hinges, spin-ups, latches and screws, baked sparks and debris, streaks and shockwaves, a keyframed camera with ramps, whips and shake, and a `Shutter` for motion blur. [README](src/kit/motion/README.md). |
| Designed sounds | `audio/designed.py` (needs the template's `audio/dsp.py`) | About 30 synthesised effects in numpy: whoosh, thud, sub drop, riser, blips and chimes, data chatter, counter, scramble, radio pulse, telegraph (any text in Morse), sonar, bubbles, swarm, wind, crackle, send and receive tones. Pitched ones default to F minor. `python3 audio/designed.py` renders one of each with its level. |

## Setup
- Globe and phone need `npm i @remotion/three three @react-three/fiber @types/three` and the
  template's `src/kit/three-canvas.tsx`. Load textures and the photo with `useEarth()` or
  `usePhone('your-photo.jpg')` in the scene component, outside the canvas.
- The realism and motion kits need `three` (with its add-ons), the template's `three-canvas.tsx`
  and `finish.tsx`; they use explicit `.ts` imports, so set `allowImportingTsExtensions` in
  `tsconfig.json`.
- Designed sounds need `numpy` and `scipy`; `dsp.read()` and `dsp.loudness()` also need FFmpeg.
- `node src/kit/globe-web-gen.mts` rebuilds `globe-web-data.ts` (needs FFmpeg). Edit its hub list
  to change the web; `ORIGIN` sets where the draw-on wave starts.

## Rights and limits
- The Earth textures are NASA Blue Marble (2004) and Black Marble (2016), public domain, resized
  to 4096×2048; NASA asks for credit. The globe shader assumes that size.
- The cable web is illustrative: real coastal cities joined by invented links. Don't present it as
  a map of real cables.
- The phone draws Apple's interface from scratch with the system font. The send and receive
  sounds are original, not Apple's.
- The designed sounds have only been heard in one film's mix. Some peak above full scale before
  you set their gain (`crackle` is +1 dB), so set levels in context.

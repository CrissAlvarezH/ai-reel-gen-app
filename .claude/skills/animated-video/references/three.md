# three.js in Remotion

Mechanics for any film with a three.js scene, whatever its style. Each item comes from a bug seen
in a render.

- Stack: `npm i @remotion/three three @react-three/fiber @types/three`. Use the template's
  `src/kit/three-canvas.tsx` instead of the stock `ThreeCanvas`: it holds each frame until the
  scene inside has drawn, so the first frame after a mount is never captured empty. Its `settle()`
  releases a `delayRender` after a state change.
- Keep one canvas mounted at a time. Build geometry and textures once in `useMemo`; per frame,
  update instance matrices and uniforms only.
- Hold the frame with `delayRender` until textures and images have loaded and been drawn, not just
  requested; a late texture otherwise shows as a missing object in random frames.
- `src/kit/finish.tsx` wraps a scene with optional bloom on bright pixels (an sRGB filter on the
  finished picture), a vignette and fine grain; tune or drop each layer per style. Grain also
  stops dark gradients banding after the platform recompresses the video.
- Budget: measure the heaviest frame with `npx remotion still` and keep it to a few seconds at
  full size; keep instance counts in the low hundreds of thousands.
- Framing: with a vertical field of view F, a camera at distance d frames a height of
  2·d·tan(F/2). Set distances from the size the subject must fill, before modelling detail.
- The template has no depth-of-field pass: draw background props as soft sprites or blurred
  planes (or use the motion kit's `Shutter` soft layer); sharp background geometry reads as a set.
- Nested transparent parts (an x-ray reveal, glass over a chip) need explicit `renderOrder`, or
  the outer surface paints over what it should reveal.
- A wrapper that clones materials (for a per-subtree effect) keeps the clones from seeing
  per-frame updates the original's owner makes, and a compile hook that closes over the original
  makes every clone read the original's uniforms. Bind hooks to the material being compiled, and
  avoid wrapping subtrees that animate their own materials.
- three.js r186: a standard or physical material lit by `scene.environment` ignores
  `envMapIntensity` unless it has its own `envMap`; assign the environment texture explicitly to
  scale one material's reflections. Lower a floor's metalness along with its specular, or metallic
  Fresnel keeps it mirror-bright at grazing angles.
- A screen-space pass that gathers neighbours (depth of field, bloom) spreads one NaN or infinite
  pixel into a black disc or bar. Sanitise its input (non-finite to 0, clamp to the half-float
  range).
- Tone map exactly once: in the renderer (`gl.toneMapping`) or in one later pass, never both.
- Dense multi-part motion, particles, impacts, camera rigs and motion blur:
  [motion kit](../templates/parts/src/kit/motion/README.md). Detailed outdoor sets:
  [realistic 3D](../styles/realistic-3d/README.md).

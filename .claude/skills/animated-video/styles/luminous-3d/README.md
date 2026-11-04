# Luminous 3D

A dark world where information and energy are the light sources: real 3D space with fog and
depth, a few emissive accents, modelled real objects, a camera that travels from macro to micro.
It suits systems, infrastructure, science and scale. Colours, subjects and density are chosen per
brief; a luminous film can be warm or cold, sparse or dense, stylised or near-photoreal.

## Built in code
three.js in Remotion: [three.js mechanics](../../references/three.md). Useful parts
([parts](../../templates/parts/README.md)): the globe, the modelled phone, the motion kit, and
the template's `finish.tsx` for bloom, vignette and grain.

## Its bar
- **Colour structure:** a dark, low-saturation ground; emissive light in one hot accent is what
  the eye follows; any other colour means one thing.
- **Light is physical.** Emissive things light their surroundings with real lights; materials
  respond (`MeshStandardMaterial` / `MeshPhysicalMaterial`, rim light on hero objects,
  reflections from an environment map built with `PMREMGenerator` over a small procedural
  scene). Additive sprites are for the bright core only.
- **Value discipline.** Large surfaces stay dark enough that only true light sources bloom; one
  brightest thing per shot.
- **A full frame.** The place continues to the edges and behind captions; in the first rejected
  cut of a luminous explainer the bottom third was empty.
- **Depth.** Fog fading toward the ground colour, out-of-focus particles near the lens, far things
  smaller, dimmer and cooler.
- **Modelled objects.** Look up the real object and model its parts (bevels, panel lines, ports,
  cables, housings), plus procedural roughness or normal detail from canvas textures.

## Typical failure
A first pass tends to come out as glowing shapes on a flat dark field: subjects in one part of
the frame and the rest empty, one plane, glows that light nothing, and primitives standing in for
objects. Check the first stills for exactly this. The tempting fix, better light (a black product
stage with a soft key and a reflective floor around floating devices), is the same failure in a
nicer finish. The fix is content: a place, the objects in it, and something happening there.

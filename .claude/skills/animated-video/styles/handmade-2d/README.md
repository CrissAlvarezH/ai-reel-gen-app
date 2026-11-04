# Handmade 2D

Drawn, cut or painted material with visible process: paper grain, ink, uneven tone, held drawings.
It suits personal stories, warmth and charm. Medium, palette and roughness are chosen per brief.

## Built in code
- A `<canvas>` inside a Remotion component, redrawn from the frame number with seeded randomness.
- Paper grain and uneven tone made procedurally, rendered once and reused; recomputing a
  full-frame texture (or an SVG turbulence filter) every frame is slow.
- Cut-paper layers with soft shadows, torn or deckled edges, and shapes and outlines that are a
  little irregular.
- Line boil for a stop-motion feel: re-jitter outlines with seeded noise and hold each drawing for
  2–3 frames.

## Its bar
- The irregularity is in the shapes and edges themselves.
- Depth from layers that overlap and cast soft shadows, with parallax between them.
- One light direction across layers, with shadows and highlights painted in.

## Typical failure
Texture added as a filter over clean vector art reads as a preset.

Drawn characters: [characters](../../references/characters.md).

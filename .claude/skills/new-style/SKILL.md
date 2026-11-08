---
name: new-style
description: >-
  Create a new visual style for the creator's videos in a Reel Studio workspace (styles/<id>/style.json):
  interview him for its name, feel, colours and what each one means, fonts, motion, where pictures come from,
  reference links and images, then write the style so it shows in Estilos and new videos can use it. Use when
  he asks for a new style or presses "Nuevo estilo" on the Estilos page.
---

# New style

A style is how a video looks and moves. It lives in `styles/<id>/` of the workspace (shared by every project)
and is described by its `style.json`; Reel Studio's Estilos page shows it (palette, fonts, look, motion, what to
avoid, examples, references) and new videos can be made in it. Read the existing ones first
(`styles/*/style.json`, and `styles/collage-semitono/` for a complete one) so the new one is written the same
way and doesn't repeat one he already has.

Talk in his language, the way he talks. He can't answer interactive dialogs: ask in text.

**Be brief.** One step per message, a few short lines: the question and your suggestion in a line, so "sí" or
a word is enough. No intro, no recap of the styles he has, no explaining the process or what comes next, no
long lists of options (two or three, a few words each). Don't repeat back what he said; just go on.

## 1. Interview

One step at a time, in this order; skip what he already said. What you need:

1. **Name** and the idea in one sentence: what it should feel like, what kind of video it's for.
2. **References**: links (videos, accounts, boards, sites) and images. He can paste or drop images in the
   chat: they come with his message as paths in `.reel-studio/images/` of the project; copy the ones you use
   to `styles/<id>/refs/` (that folder is only the chat's). Links to images: download them there (`curl -L`).
   Many files at once: create `styles/<id>/refs/` and open it for him to drop them in (macOS `open <dir>`,
   Windows `explorer <dir>`), then wait until he says they're there. A reel from
   Inspiración he names: its frames are in `inspiration/<account>/<code>/` (`hook.jpg`, `sheet_NN.jpg`). Look at
   every image he gives you (read it) and say in a line what you take from each. Images you find or propose:
   download them to `styles/<id>/refs/` and show them in the chat (`![…](/workspace-files/styles/<id>/refs/x.jpg)`),
   never only describe them.
3. **Colours**: 3 to 6, each with what it means in the video (the background, the ink, the accent that marks
   what's important…). If he gives none, propose a palette from the references, with the hex codes.
4. **Fonts**: one for titles, one for body or labels, at most three, from Google Fonts. Propose them if he has
   none in mind.
5. **Motion**: how things appear and move (drawn stroke by stroke, dropped by hand, slid in, cut…), the pace,
   and how acts change.
6. **Pictures**: real photos (how they're treated: cutouts, halftone, duotone…), illustrations drawn in code,
   icons, or none.
7. **What to avoid**: what would break the look.
8. **Thumbnail**: how a video's cover looks in this style (the title, the picture, what's left out). Propose one
   from the rest if he has none in mind.

Then show him the whole style in one compact summary (a line each: name, palette with meanings, fonts, look,
motion, pictures, avoid) and ask for his OK before writing it.

## 2. Write it

- `id`: the name in lowercase with hyphens, no accents (`cuaderno-apuntes`); not one that exists.
- `styles/<id>/style.json`, in his language (every text in it shows in the studio):

```json
{
  "name": "Cuaderno de apuntes",
  "summary": "One or two sentences: what it looks like and what it's for.",
  "skill": null,
  "template": null,
  "cutouts": false,
  "palette": [{"name": "Hoja", "hex": "#FAF8F2", "meaning": "el fondo"}],
  "fonts": [{"family": "Caveat 700", "css": "Caveat, cursive", "weight": 700, "google": "Caveat:wght@700", "use": "títulos", "sample": "¿Y si se cae?"}],
  "look": ["How a frame is made, one point each."],
  "motion": ["How things move."],
  "sources": ["Where the pictures come from and how they're treated."],
  "avoid": ["What breaks the look, and why."],
  "thumbnail": {"look": ["How the cover is made, one point each."], "avoid": ["What breaks it."], "example": null},
  "examples": [],
  "references": ["styles/<id>/refs/ref-1.jpg"]
}
```

  - `palette` order matters: background first, then the text colour, then the lines (grids, borders), then the
    accents. The studio draws the poster and the font samples from it, so a text colour that isn't second can
    leave them unreadable.
  - `fonts[].google` is the family as in a Google Fonts URL (`Patrick+Hand`, `Inter:wght@800`): the studio loads
    it to show the sample. `sample` is a short text in that font, from the kind of video it's for.
  - `cutouts`: true only if it makes photo cutouts with `tools/cutout.py`.
  - `references` and `examples` are paths relative to the workspace. `examples` are approved frames of videos
    made in this style: empty until there is one. Without examples the studio draws a poster from the palette
    and fonts.
  - `thumbnail.example`: a sample cover (workspace-relative image), null until a video in this style has one.
  - Never set `"default": true` (only he changes the default style).
- Validate the JSON (`python3 -m json.tool styles/<id>/style.json`). The Estilos page shows it on its own.

`skill` and `template` stay null: a video in this style is built on the default style's template with the look
changed to its `style.json` (the studio says "Sin plantilla"). When he's happy with a first video in it, offer
to write `styles/<id>/SKILL.md` (how to build it: components, how pictures are treated, sound) and its own
template from that video, and to add its best frames to `examples`.

## 3. Close

In two lines: it's in Estilos (`#/estilos/<id>`), and offer to try it in a new video.

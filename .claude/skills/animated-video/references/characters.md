# Characters drawn in code

For any rigged or recurring character, whatever the style (a cartoon cast, stick figures, a
mascot). Learned on a flat 2D puppet with IK, a turn parameter for three-quarter views, automatic
blinks and a VO-driven mouth; its proportions and shapes were one film's choices.

## Build
- **One rig per character, used in every shot.** The same code draws the character everywhere, so
  a shot can't drift off-model. Characters differ only by parameters (a Look).
- **Document the conventions in the rig file's header:** angle signs, local units and origin, how
  props attach, which arm is which. Parallel animators read only that header.
- **Provide IK** (solve a limb for a hand target). Guessed joint angles were the most common
  source of broken poses.
- **Likeness in order:** silhouette first (hair, head shape, glasses or other signature
  features), then clothes, then limbs. Compare side by side with frames of the real person.
- **A model sheet before any shot:** poses and expressions on one image. Most rig bugs show
  there in one look.
- **Plan for every scale the story needs.** Detail that reads in a wide shot looks crude at 3–4×;
  decide early whether close-ups need extra detail or a separate head.
- **Scale constants for recurring entities** (for example "the giant is 50× the hero"), defined
  once in the kit and used by every act.
- **Automatic life:** blinks with a per-character seed, a breathing bob, and a mouth driven by VO
  loudness (`voLevel()`) only when the character speaks to camera; keep it closed during
  narration.

## Check every rig for
- **Joint signs:** limbs flipping outward instead of bending in front of the body.
- **Layering gaps:** skin showing between layered shapes (hair and fringe), and features hidden
  under other layers (brows under hair). Draw expression features last.
- **Same-colour occlusion:** a limb crossing the torso disappears; add an edge or shade stroke.
- **Grounding:** seated or crouched poses floating above the contact shadow.
- **Cropping:** a wide rig cropped into a close-up loses its legs or grows floating feet. Frame
  deliberately or draw the full body.
- **Fades:** opacity crossfades on characters read as ghosts. Cut, or move the character.
- **Reach:** limb length limits hero poses; special-case a limb when a key pose needs it.
- **Likeness drift:** a stylised feature can turn into a different hairstyle or face; check
  against the reference again at thumbnail size.

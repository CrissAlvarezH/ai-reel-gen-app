# Reel Studio workspace

Narrated explainer videos made with Reel Studio. Talk to the creator in the language of the open project's
profile (`projects/<id>/config/profile.json`).

- For any new or revised video, use the `reel-studio` skill (`.claude/skills/reel-studio/SKILL.md`, the process),
  the video's style skill (`styles/<id>/SKILL.md`, named in its `style.json`), its format's skill if it has one
  (`formats/<id>/SKILL.md`, named in its `format.json`) and `LESSONS.md`. `animated-video`, `video-script` etc. are
  the general method.
- Instagram carousels (still slides, 4:5) live with the videos in `projects/<id>/videos/<slug>/`, marked by
  `kind.txt` = `carousel`: use the `carousel` skill (`.claude/skills/carousel/SKILL.md`) and the style's `carousel`
  block in its `style.json`. New carousel: Reel Studio → Biblioteca → Nuevo carrusel, or
  `node scripts/new-carousel.mjs <slug> [style] [--from <video>]`.
- For creating or sharpening content ideas (the project's Ideas de contenido board), use the `content-ideas` skill.
- Format vs style: a video's format (`format.txt` → `formats/<id>/format.json`: animated over a generated voice,
  animated over the creator's recorded voice, the creator talking to camera with animations…) is how it's made; its style (`style.txt` → `styles/<id>/`) is how it looks. Formats with
  `"footage": true` start from the creator's recording in the video's `footage/`: `tools/footage.py` transcribes it
  and cuts it with their approval; no generated voice (`"voiceOnly": true`: audios, only the voice is used).
- Projects: each channel is a project in `projects/<id>/` (Reel Studio's project selector; its prompt says which
  one is open), with its `videos/`, `config/` (profile, voice, its Instagram account) and `account/`. Everything
  else is shared at the root. Don't touch another project's folder unless asked.
- New video: `scripts/new-video.sh <slug> [style] [format]` → `projects/<id>/videos/<slug>/` (the open project). Shared
  tools in `tools/`, Python venv at `.venv/`: from a video's folder, `../../../../tools/` and `../../../../.venv/`.
- Settings: the project's in `projects/<id>/config/` (profile, voice), the shared ones (image sources, scraper) in
  `config/`; set in Reel Studio → Ajustes, they win over the skills.
- API keys are in `.env`, set in Ajustes (Voz, Extracción de datos). Never print them or ask for them in the chat.
- `projects/<id>/ideas.json` is that channel's board in Reel Studio → Ideas de contenido (content verticals, with name, description and icon; lists; cards). Change it with
  `tools/ideas.py` (`show`, `add`, `move`, `list …`, `vertical …`; needs the studio running), never by hand: the page wouldn't follow.
- `projects/<id>/inspiration/` holds the other accounts' reels that channel studies in Reel Studio → Inspiración (metrics,
  transcript, analysis, frame sheets): use it for ideas when asked; adapt, never copy a script.
- `projects/<id>/research/` holds that channel's Investigaciones (Reel Studio → Investigación): a topic, the searches
  its audience would type, the TikTok, YouTube Shorts and Instagram videos they found (metrics, whether they serve the
  audience, a 0–100 score; the best ones analysed) and the report. Change it with `tools/research.py` (`list`, `show`,
  `new`, `cost`, `search`, `analyse`, `report`…; needs the studio running), never by hand. Once searched, a research
  doesn't change nor search again: `new --from <id>` makes a copy with what he wants different. `search` spends from the
  creator's ScrapeCreators and Apify balance (say what `cost` says and wait for their yes); `analyse` uses their
  subscription: ask before more than 5.
- `projects/<id>/account/<user>/` holds that channel's own reels and their numbers (Reel Studio → Mi cuenta).
  `tools/social.py` uses the social-media scraper through the running studio; each call spends from his balance.
  `social.py analyse` analyses his reels like Mi cuenta's Analizar (his Claude subscription): ask before more than 5.
- `.reel-studio/index.sqlite` is Reel Studio's index of all of it, every project (projects, videos, Mi cuenta's
  reels linked to their videos, Inspiración): query it read-only with `tools/studio_sql.py --schema` / `"SELECT …"`;
  the studio keeps it in sync with the files, never write it.
- Keep each video's `CREDITS.md` current.
- Customer data (projects, videos, settings, ideas, accounts, conversations, custom styles and personal lessons)
  stays local. Do not stage, commit or push it to the application's source repository, and never force-add
  ignored files. Version customer content only in a separate repository explicitly requested by its owner.

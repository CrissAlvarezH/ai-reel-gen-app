#!/bin/bash
# Start a new video from its style's template.  usage: scripts/new-video.sh <slug> [style] [format]
# style: an id from styles/ (default: the project's, from Ajustes → Perfil, else the workspace's default).
# A style without a template uses the default one's. format: an id from formats/ (the kind of video, e.g.
# persona-hablando; default: the workspace's default format); it may add files over the template.
# It goes to the open project (REEL_STUDIO_PROJECT, set by Reel Studio for its agent): projects/<id>/videos/<slug>.
set -e; cd "$(dirname "$0")/.."; n=$1; style=$2; format=$3
[ -z "$n" ] && { echo "usage: scripts/new-video.sh <slug> [style] [format]"; exit 1; }
if [ ! -d .venv ]; then  # python3 on macOS and Linux, python on Windows; pip lives in Scripts/ there
  py=$(command -v python3 || command -v python)
  "$py" -m venv .venv && { [ -x .venv/bin/pip ] && pip=.venv/bin/pip || pip=.venv/Scripts/pip; } && "$pip" install -q -r tools/requirements.txt
fi
# Copy the folder from the style's template, with its name, style and format (scripts/new-video.mjs, the
# same routine Reel Studio uses). It prints the style, the format, the template and the new folder.
read -r style format tpl dir < <(node scripts/new-video.mjs "$n" "$style" "$format") || exit 1
[ -z "$dir" ] && exit 1
(cd "$dir" && npm install --silent)
echo "$dir ready ($style, format $format, from $tpl/). Next: see .claude/skills/reel-studio/SKILL.md and the format's skill"

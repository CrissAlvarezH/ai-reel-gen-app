"""API keys and image settings for the tools. Keys come from the environment or from the .env at the repo
root, where Reel Studio saves them (in Ajustes, next to what each one is for); never print them."""
import json, os, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
# Where each key is entered in Reel Studio.
WHERE = {
    "ELEVENLABS_API_KEY": "Ajustes → Voz",
    "PEXELS_API_KEY": "Ajustes → Extracción de datos → Imágenes",
    "PIXABAY_API_KEY": "Ajustes → Extracción de datos → Imágenes",
    "UNSPLASH_ACCESS_KEY": "Ajustes → Extracción de datos → Imágenes",
    "OPENAI_API_KEY": "Ajustes → Extracción de datos → Imágenes",
    "APIFY_TOKEN": "Ajustes → Extracción de datos → Redes sociales",
}


def key(name):
    v = os.environ.get(name)
    if not v:
        try:
            m = re.search(rf"^\s*(?:export\s+)?{name}\s*=\s*[\"']?([^\"'\n]*)", (ROOT / ".env").read_text(), re.M)
            v = m.group(1).strip() if m else None
        except FileNotFoundError:
            pass
    if not v:
        sys.exit(f"Falta {name}: ponla en Reel Studio → {WHERE.get(name, 'Ajustes')}.")
    return v


def project_dir():
    """The project whose settings apply (its config/voice.json, profile.json): REEL_STUDIO_PROJECT (Reel
    Studio sets it for its agent), else the one whose video folder this runs from (projects/<id>/videos/<slug>),
    else the only one in projects/; a workspace from before projects keeps them at the root."""
    env = os.environ.get("REEL_STUDIO_PROJECT")
    if env:
        return (ROOT / env).resolve()
    cwd = Path.cwd().resolve()
    for d in (cwd, *cwd.parents):
        if d.parent.name == "projects" and (d / "project.json").exists() and d.parent.parent == ROOT:
            return d
    ids = [p for p in (ROOT / "projects").glob("*/project.json")] if (ROOT / "projects").is_dir() else []
    return ids[0].parent if len(ids) == 1 else ROOT


def source_on(name):
    """Free web sources are always available; settings only control API integrations."""
    if name in ("commons", "openverse"):
        return True
    own = project_dir() / "config/images.json"
    try:
        cfg = json.loads((own if own.exists() else ROOT / "config/images.json").read_text())
    except (FileNotFoundError, ValueError):
        cfg = {}
    return cfg.get(name, name != "generated")  # all on by default except generated images

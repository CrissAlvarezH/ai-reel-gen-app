"""ElevenLabs TTS with the voice set in Reel Studio (Ajustes → Voz). Usage: tts.py <text_file> <out.mp3>
Reads the project's config/voice.json (projects/<id>/, tools/keys.py project_dir) and, run from a video's
folder, its own voice.json over it.
Writes <out>.alignment.json next to the mp3. Reads ELEVENLABS_API_KEY from env or the root .env (tools/keys.py)."""
import base64, json, sys
from pathlib import Path
from urllib.request import Request, urlopen
from keys import key, project_dir

ROOT = Path(__file__).resolve().parents[1]


def load(p):
    try:
        return json.loads(Path(p).read_text())
    except (FileNotFoundError, ValueError):
        return {}


CONFIG = project_dir() / "config/voice.json"
voice = {**load(CONFIG), **load("voice.json")}
if load(CONFIG).get("enabled") is False:  # only set for the whole project
    sys.exit("La generación de voz está desactivada en Reel Studio → Ajustes → Voz.")
if not voice.get("voiceId"):
    sys.exit("No hay voz elegida: elígela en Reel Studio → Ajustes → Voz (config/voice.json del proyecto).")

URL = f"https://api.elevenlabs.io/v1/text-to-speech/{voice['voiceId']}/with-timestamps?output_format=mp3_44100_192"
SETTINGS = {
    "speed": voice.get("speed", 1.16),
    "stability": voice.get("stability", 0.5),
    "similarity_boost": voice.get("similarity", 0.75),
    "style": voice.get("style", 0.0),
    "use_speaker_boost": voice.get("speakerBoost", True),
}

text = Path(sys.argv[1]).read_text().strip()
out = Path(sys.argv[2])
req = Request(URL, data=json.dumps({"text": text, "model_id": voice.get("model", "eleven_v4"), "voice_settings": SETTINGS}).encode(),
              headers={"xi-api-key": key("ELEVENLABS_API_KEY"), "Content-Type": "application/json"})
with urlopen(req, timeout=180) as r:
    res = json.load(r)
out.write_bytes(base64.b64decode(res["audio_base64"]))
out.with_suffix(".alignment.json").write_text(json.dumps(res["alignment"]))
print("ok", out, f"({voice.get('voiceName') or voice['voiceId']})")

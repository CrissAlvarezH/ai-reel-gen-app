# Stand-in word timings before the real narration exists, so the film can be built and timed.
# Each word lasts by its length, with pauses after punctuation; the whole is scaled to the pace of the voice
# set in Reel Studio (Ajustes → Voz: the project's config/voice.json wordsPerSec, or the video's own voice.json).
# usage: python tools/standin_words.py audio/vo.txt src/words.json   -> replace later with tools/el_words.py
import json, re, sys
from pathlib import Path
from keys import project_dir

ROOT = Path(__file__).resolve().parents[1]
START = 0.3  # silence before the first word


def load(p):
    try:
        return json.loads(Path(p).read_text())
    except (FileNotFoundError, ValueError):
        return {}


pace = {**load(project_dir() / "config/voice.json"), **load("voice.json")}.get("wordsPerSec")

words, t = [], START
for w in open(sys.argv[1]).read().split():
    if not re.search(r"\w", w): continue
    d = 0.18 + 0.045 * len(w); words.append({"w": w, "s": t, "e": t + d}); t += d + (0.35 if w[-1] in '.,:;?!' else 0.06)

k = (len(words) / pace) / (t - START) if pace and words else 1  # stretch so n words take n / pace seconds
for x in words:
    x["s"], x["e"] = round(START + (x["s"] - START) * k, 3), round(START + (x["e"] - START) * k, 3)
end = START + (t - START) * k
json.dump(words, open(sys.argv[2], "w"), indent=0, ensure_ascii=False)
print(len(words), "stand-in words, ends", round(end, 2), f"(at {pace} words/s)" if pace else "(no voice pace set)")

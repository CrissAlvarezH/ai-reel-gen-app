# Word timings from ElevenLabs character alignment (better than Whisper for Spanish TTS).
# usage: python3 el_words.py audio/vo.alignment.json public/vo.mp3 -> src/words.json, src/vo_env.json
import json, math, os, re, struct, subprocess, sys
# one envelope value per video frame: the frame rate is in src/format.json (30 when it has none)
fps = json.load(open("src/format.json")).get("fps", 30) if os.path.exists("src/format.json") else 30
a = json.load(open(sys.argv[1]))
cs, ss, es = a["characters"], a["character_start_times_seconds"], a["character_end_times_seconds"]
words, cur = [], None
for c, s, e in zip(cs, ss, es):
    if c.isspace():
        if cur: words.append(cur); cur = None
        continue
    if cur is None: cur = {"w": "", "s": s, "e": e}
    cur["w"] += c; cur["e"] = e
if cur: words.append(cur)
words = [{"w": w["w"], "s": round(w["s"], 3), "e": round(w["e"], 3)} for w in words if re.search(r"\w", w["w"])]
json.dump(words, open("src/words.json", "w"), indent=0, ensure_ascii=False)
print(len(words), "words, last ends", words[-1]["e"])
raw = subprocess.run(["ffmpeg", "-v", "error", "-i", sys.argv[2], "-ac", "1", "-ar", "16000", "-f", "s16le", "-"], capture_output=True).stdout
n = len(raw) // 2; s = struct.unpack(f"<{n}h", raw); hop = 16000 // fps
env = [math.sqrt(sum(x * x for x in s[i:i + hop]) / max(1, len(s[i:i + hop]))) for i in range(0, n, hop)]
peak = sorted(env)[int(len(env) * 0.98)] or 1
json.dump([round(min(1, e / peak), 3) for e in env], open("src/vo_env.json", "w"))

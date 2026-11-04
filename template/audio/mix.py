# Collage-film mix: narration, a synthetic score bed, and paper foley timed from the words.
# usage: <workspace>/.venv/bin/python audio/mix.py -> public/mix.wav   (from the video's folder: ../../../../.venv)   (all music and effects here are SYNTHETIC)
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from designed import *

vo = read(os.path.join(ROOT, 'public', 'vo.wav'))
vo = hp(vo, 70) * db(-1.0)
END = len(vo) / SR + 1.4
n = int(END * SR)
fx = np.zeros((n, 2)); bed = np.zeros((n, 2))
F = 1 / json.load(open(os.path.join(ROOT, 'src', 'format.json')))['fps']  # one frame, in seconds
t = secs(END)

def pad(notes, a, b, gain):
    seg = (t >= a) & (t < b); y = np.zeros(n)
    for k, nt in enumerate(notes):
        f0 = hz(nt); y += sum(np.sin(TAU * f0 * (1 + d) * t + k) for d in (-0.003, 0, 0.004)) / 3
    env = np.clip(np.minimum((t - a) / 1.2, (b - t) / 1.2), 0, 1) * seg
    return stereo(lp(y * env, 1800) * gain)
# score: three chords — tension, the turn (the fix), resolution. Set C1/C2 to the script's turning points.
C1 = END * 0.35; C2 = END * 0.85
bed += pad(['F2', 'C3', 'Ab3'], 0, C1 + 0.6, 0.05)
bed += pad(['Db2', 'Ab2', 'F3', 'C4'], C1, C2 + 0.6, 0.045)
bed += pad(['Ab2', 'Eb3', 'C4', 'F4'], C2, END, 0.05)
beat = 60 / 96
for k in range(int(END / beat)):
    at = k * beat
    if at < 1.0: continue
    put(bed, thud(f=55, dur=0.35) * (0.10 if k % 4 == 0 else 0.05), at)
env = np.abs(vo).mean(1); k = int(0.4 * SR); sm = np.convolve(env, np.ones(k) / k, 'same')
sm = np.concatenate([sm, np.zeros(n - len(sm))]); bed *= (1 - 0.45 * np.clip(sm / (np.percentile(sm, 90) + 1e-9), 0, 1))[:, None]

# ---- paper foley ----
_s = [0]
def nz(d):
    _s[0] += 1; return noise(int(d * SR), 500 + _s[0])
def add(a, b):
    m = max(len(a), len(b)); o = np.zeros((m, 2)); o[:len(a)] += a; o[:len(b)] += b; return o
def paper_drop(p=0.0):   # a cutout set down on the board
    x = bp(nz(0.09), 700, 5000) * np.exp(-secs(0.09) / 0.018)
    return add(stereo(x * 0.9, p), thud(f=95, dur=0.12) * 0.25)
def paper_slide(d=0.28, p=0.0):
    e = np.sin(np.pi * np.clip(secs(d) / d, 0, 1)) ** 1.5
    return stereo(bp(nz(d), 1500, 7000) * e * 0.5, p)
def stamp():
    return add(thud(f=70, dur=0.25) * 0.9, stereo(bp(nz(0.04), 300, 2500) * np.exp(-secs(0.04) / 0.008), 0))
def tear(d=0.4, p=0.0):
    m = int(d * SR); y = np.zeros(m); r = np.random.default_rng(300 + _s[0]); _s[0] += 1
    idx = r.integers(0, m, int(d * 900)); y[idx] = r.standard_normal(len(idx)) * r.random(len(idx)) ** 2
    e = np.clip(secs(d) / 0.02, 0, 1) * np.clip((d - secs(d)) / 0.08, 0, 1)
    return stereo(bp(y, 1800, 9000) * e * 3 + bp(nz(d), 2000, 6000) * e * 0.15, p)
def marker(d=0.35):
    e = np.clip(secs(d) / 0.03, 0, 1) * np.clip((d - secs(d)) / 0.05, 0, 1)
    return stereo(bp(nz(d), 2500, 8000) * e * 0.35, 0.1)

c = cue
# Cue sheet: (time, sound, gain). Derive every time from the words or from the same frame offsets the scenes use.
S = [
    (0.10, paper_drop(), 0.6),                      # first pieces land
    (4 * F + 0.0, paper_drop(-0.3), 0.5),          # title strip
    (c('empieza'), paper_slide(0.3), 0.6),
    (c('aquí'), marker(0.3), 0.7),
    (c('collage'), stamp(), 0.8),
]
for a, s, g in S:
    put(fx, s, a, g)
mix = np.zeros((n, 2)); mix[:len(vo)] += vo
mix += bed * db(-15) + fx * db(-9)
write(os.path.join(ROOT, 'public', 'mix.wav'), mix * 0.9)
print('mix', loudness(os.path.join(ROOT, 'public', 'mix.wav')))

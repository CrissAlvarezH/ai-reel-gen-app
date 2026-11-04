"""Motion diagnosis (references/review.md#motion): measure a render against a film the user accepted.

  python3 motion_check.py film RENDER.mp4 --bar BAR.mp4 [--shots shots.json] [--strips DIR]
      second by second: how many separate things move, how often almost nothing moves, how fast the
      picture changes. Flags shots below the bar and writes a strip of consecutive frames for each
      flagged second, so a reviewer who only sees stills can see that it is still. A diagnosis, not
      a gate: fix what it finds with better pictures.

shots.json: [{"id", "from", "to"}] in output frames of the delivered film. Exit status 1 when a check
fails. Needs numpy and scipy.
"""
import json, subprocess, sys
from pathlib import Path


def arg(k, d=None):
    return sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d


def readout(path, fps=10, w=108, h=192):
    """Per second of film: [second, separate movers per frame (median), frame change, picture change over 2 s]."""
    import numpy as np
    from scipy import ndimage as nd
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(path), '-vf', f'fps={fps},scale={w}:{h},format=gray', '-f', 'rawvideo', '-'],
                         capture_output=True, check=True).stdout
    fr = np.frombuffer(raw, np.uint8).reshape(-1, h, w).astype(np.float32)
    fr = np.stack([nd.gaussian_filter(f, 1.0) for f in fr])
    rows = []
    for s in range(1, len(fr) // fps):
        d = np.abs(np.diff(fr[s * fps - 1:(s + 1) * fps], axis=0))
        movers = []
        for k in d:  # separate moving things: blobs of change above the frame's own 90th percentile
            m = nd.binary_opening(k > max(6.0, np.percentile(k, 90)))
            lab, n = nd.label(m)
            movers.append(int((np.asarray(nd.sum(m, lab, range(1, n + 1))) >= 8).sum()) if n else 0)
        a, b = fr[(s - 1) * fps], fr[min(len(fr) - 1, (s + 1) * fps)]
        a, b = a - a.mean(), b - b.mean()
        rows.append((s, float(np.median(movers)), float(d.mean()), float(1 - (a * b).sum() / np.sqrt((a * a).sum() * (b * b).sum() + 1e-9))))
    return rows


def check_film(render, bar, shots=None, strips=None):
    import numpy as np
    R, B = np.array(readout(render)), np.array(readout(bar))
    lo_movers = np.percentile(B[:, 1], 25)          # the bar's busy-ness: a quarter of its seconds are below this
    few = lambda X: (X[:, 1] <= 2).mean()           # share of seconds where at most two things move
    still = lambda X: (X[:, 2] < 2.0).mean()        # share of nearly still seconds
    print(f"bar {Path(bar).name}: movers median {np.median(B[:, 1]):.0f} (p25 {lo_movers:.0f}), <=2 movers {few(B) * 100:.0f}%, "
          f"still {still(B) * 100:.0f}%, change over 2 s median {np.median(B[:, 3]):.2f}")
    print(f"film {Path(render).name}: movers median {np.median(R[:, 1]):.0f}, <=2 movers {few(R) * 100:.0f}%, "
          f"still {still(R) * 100:.0f}%, change over 2 s median {np.median(R[:, 3]):.2f}")
    fails = []
    if np.median(R[:, 1]) < np.median(B[:, 1]):
        fails.append(f"film: fewer separate things move than in the bar film (median {np.median(R[:, 1]):.0f} vs {np.median(B[:, 1]):.0f})")
    if few(R) > few(B) + 0.02:
        fails.append(f"film: {few(R) * 100:.0f}% of seconds have at most two moving things (bar {few(B) * 100:.0f}%)")
    flagged = [int(s) for s, mv, en, ch in R if mv < lo_movers and ch < np.median(B[:, 3])]
    fps = 30
    for sh in shots or []:
        secs = R[(R[:, 0] * fps >= sh['from']) & (R[:, 0] * fps < sh['to'])]
        if len(secs) and np.median(secs[:, 1]) < lo_movers:
            fails.append(f"{sh['id']}: median {np.median(secs[:, 1]):.0f} separate movers, below the bar's quarter mark {lo_movers:.0f}")
    if flagged:
        fails.append(f"seconds below the bar on both movers and change: {flagged}")
    if strips and flagged:
        Path(strips).mkdir(parents=True, exist_ok=True)
        for s in flagged:  # six frames across the second: what the reviewer can't see in a single still
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', str(s), '-t', '1', '-i', str(render), '-vf',
                            'fps=6,scale=180:-1,tile=6x1', '-frames:v', '1', str(Path(strips) / f'still-{s:04d}s.jpg')], check=True)
    return fails


if __name__ == '__main__':
    if len(sys.argv) < 3 or sys.argv[1] != 'film' or not arg('--bar'):
        sys.exit(__doc__)
    sh = json.loads(Path(arg('--shots')).read_text()) if arg('--shots') else None
    fails = check_film(sys.argv[2], arg('--bar'), sh, arg('--strips'))
    print('\n'.join(['FAIL ' + f for f in fails]) or 'PASS')
    sys.exit(1 if fails else 0)

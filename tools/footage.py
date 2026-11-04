#!/usr/bin/env python3
# The creator's own recording, for formats that use it (formats/<id>/format.json "footage": true): him talking to
# camera, or only his voice ("voiceOnly": true; audio files, or videos whose picture is dropped).
# Run from the video's folder with the workspace's venv (faster-whisper, numpy: Ajustes → Requisitos → Transcripción):
#
#   footage.py transcribe [--lang es]  every clip in footage/ (in name order) → audio/takes.json (its words with
#                                      times) and, for clips new to audio/edit.json, a first cut there: the speech
#                                      in pieces split at pauses longer than --pause (0.4 s). Prints the pieces.
#   footage.py show [N …]              audio/edit.json's pieces, numbered, with what is said; with N, piece N's
#                                      words with their times (to split a piece or trim a flub inside it)
#   footage.py cut [--voice]           audio/edit.json → public/footage.mp4 (the video's size and fps, from
#                                      src/format.json), public/vo.wav (its sound: the narration), src/words.json,
#                                      src/vo_env.json, src/footage.json (where each piece starts) and audio/vo.txt.
#                                      With --voice (implied by a voiceOnly format, or by clips with no picture)
#                                      only the sound: public/vo.wav, no footage.mp4.
#
# audio/edit.json: {"pieces": [{"clip": "01-toma.mov", "from": 1.42, "to": 6.10, "text": "…"}, …]} — the pieces that
# stay, in the order they play. Delete a piece to cut it; change from/to (seconds in its clip) to trim it; split
# one in two to cut a flub inside it. "text" is only a reading aid: cut recomputes it.
import json, math, os, re, struct, subprocess, sys

VIDEO = re.compile(r'\.(mp4|mov|m4v|webm|mkv|avi)$', re.I)
AUDIO = re.compile(r'\.(m4a|mp3|wav|aac|ogg|opus|flac)$', re.I)
PAD_IN, PAD_OUT = 0.12, 0.2  # breath kept before a piece's first word and after its last


def die(msg):
    print(msg, file=sys.stderr)
    sys.exit(1)


def load(p, default=None):
    try:
        with open(p) as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return default


def save(p, data, indent=None):
    os.makedirs(os.path.dirname(p) or '.', exist_ok=True)
    with open(p, 'w') as fh:
        json.dump(data, fh, indent=indent, ensure_ascii=False)
        fh.write('\n')


def clips():
    try:
        return sorted(n for n in os.listdir('footage') if (VIDEO.search(n) or AUDIO.search(n)) and not n.startswith('.'))
    except OSError:
        return []


def probe(path):
    out = subprocess.run(['ffprobe', '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path], capture_output=True, text=True)
    if out.returncode:
        die(f'ffprobe no puede leer {path}: {out.stderr.strip()}')
    j = json.loads(out.stdout)
    v = next((s for s in j['streams'] if s['codec_type'] == 'video'), None)
    a = next((s for s in j['streams'] if s['codec_type'] == 'audio'), None)
    return {'duration': round(float(j['format'].get('duration', 0)), 3), 'width': v and v.get('width'), 'height': v and v.get('height'), 'audio': bool(a)}


def fmt(t):
    return f'{int(t // 60)}:{t % 60:05.2f}'


def transcribe(path, lang):
    import numpy as np
    from faster_whisper import WhisperModel  # the venv's (tools/requirements-whisper.txt)

    # Decoded by ffmpeg to 16 kHz mono first: faster-whisper's own decoder breaks with newer PyAV versions.
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-vn', '-ac', '1', '-ar', '16000', '-f', 's16le', '-'], capture_output=True).stdout
    if not raw:
        die(f'{path} no tiene sonido')
    audio = np.frombuffer(raw, np.int16).astype(np.float32) / 32768
    model = WhisperModel(os.environ.get('WHISPER_MODEL', 'small'), device='cpu', compute_type='int8')
    # No VAD filter: the pauses are what we cut, so every timestamp stays on the clip's own clock.
    segments, info = model.transcribe(audio, language=lang, word_timestamps=True, condition_on_previous_text=False)
    words = []
    for s in segments:
        for w in s.words or []:
            t = w.word.strip()
            if re.search(r'\w', t):
                words.append({'w': t, 's': round(w.start, 3), 'e': round(w.end, 3)})
    return words, info.language


def pieces_of(clip, words, duration, pause):
    out, cur = [], []
    for w in words:
        if cur and w['s'] - cur[-1]['e'] > pause:
            out.append(cur)
            cur = []
        cur.append(w)
    if cur:
        out.append(cur)
    res = []
    for i, ws in enumerate(out):
        lo = out[i - 1][-1]['e'] if i else 0
        hi = out[i + 1][0]['s'] if i + 1 < len(out) else duration
        a = max(lo + (ws[0]['s'] - lo) / 2 if i else 0, ws[0]['s'] - PAD_IN)
        b = min(hi - (hi - ws[-1]['e']) / 2 if i + 1 < len(out) else duration, ws[-1]['e'] + PAD_OUT)
        res.append({'clip': clip, 'from': round(a, 2), 'to': round(b, 2), 'text': ' '.join(w['w'] for w in ws)})
    return res


def words_in(takes, p):
    ws = takes.get('clips', {}).get(p['clip'], {}).get('words', [])
    return [w for w in ws if p['from'] <= (w['s'] + w['e']) / 2 < p['to']]


def show(edit, takes, which=()):
    pieces = edit.get('pieces', [])
    if which:
        for n in which:
            if not 1 <= n <= len(pieces):
                die(f'no hay pieza {n} (hay {len(pieces)})')
            p = pieces[n - 1]
            print(f'#{n} {p["clip"]} {p["from"]:.2f}–{p["to"]:.2f}')
            for w in words_in(takes, p):
                print(f'  {w["s"]:7.2f} {w["e"]:7.2f}  {w["w"]}')
        return
    total = 0
    for i, p in enumerate(pieces, 1):
        d = p['to'] - p['from']
        text = ' '.join(w['w'] for w in words_in(takes, p)) or '(sin palabras)'
        print(f'#{i:<3} {fmt(total)}  {p["clip"]} {p["from"]:.2f}–{p["to"]:.2f} ({d:.1f} s)  {text}')
        total += d
    print(f'{len(pieces)} piezas, {total:.1f} s en total')


def cmd_transcribe(args):
    lang, pause = None, 0.4
    if '--lang' in args:
        lang = args[args.index('--lang') + 1]
    if '--pause' in args:
        pause = float(args[args.index('--pause') + 1])
    names = clips()
    if not names:
        die('No hay clips en footage/: pídele que suba su grabación desde la página del video → Grabación.')
    takes = load('audio/takes.json', {'clips': {}})
    takes.setdefault('clips', {})
    for n in names:
        if n in takes['clips']:
            continue
        info = probe(os.path.join('footage', n))
        if not info['audio']:
            die(f'footage/{n} no tiene sonido')
        print(f'Transcribiendo footage/{n} ({fmt(info["duration"])})…', file=sys.stderr, flush=True)
        words, language = transcribe(os.path.join('footage', n), lang)
        takes['clips'][n] = {**info, 'language': language, 'words': words}
        save('audio/takes.json', takes)
    for gone in [n for n in takes['clips'] if n not in names]:
        del takes['clips'][gone]
    save('audio/takes.json', takes)
    edit = load('audio/edit.json', {'pieces': []})
    have = {p['clip'] for p in edit.get('pieces', [])}
    new = [n for n in names if n not in have]
    for n in new:
        c = takes['clips'][n]
        edit['pieces'] += pieces_of(n, c['words'], c['duration'], pause)
    if new:
        save('audio/edit.json', edit, indent=1)
        print(f'Primer corte en audio/edit.json (sin pausas de más de {pause} s) para: {", ".join(new)}', file=sys.stderr)
    show(edit, takes)


def frame(t, fps):
    return round(round(t * fps) / fps, 3)


def voice_only_format():
    # The video's format (format.txt) from the workspace's formats/: the video is in projects/<id>/videos/<slug>/.
    try:
        kind = open('format.txt').read().strip()
    except OSError:
        return False
    return bool(kind and (load(os.path.join('..', '..', '..', '..', 'formats', kind, 'format.json'), {}) or {}).get('voiceOnly'))


def cmd_cut(args):
    fmt_ = load('src/format.json', {}) or {}
    W, H, FPS = fmt_.get('width', 1080), fmt_.get('height', 1920), fmt_.get('fps', 30)
    takes = load('audio/takes.json')
    edit = load('audio/edit.json')
    if not takes or not edit or not edit.get('pieces'):
        die('Falta audio/takes.json o audio/edit.json: corre primero footage.py transcribe.')
    names = clips()
    pieces = []
    for p in edit['pieces']:
        if p['clip'] not in names:
            die(f'audio/edit.json usa {p["clip"]}, que no está en footage/')
        if p['clip'] not in takes.get('clips', {}):
            die(f'{p["clip"]} no está transcrito: corre footage.py transcribe')
        a, b = frame(max(0, p['from']), FPS), frame(min(takes['clips'][p['clip']]['duration'], p['to']), FPS)
        if b - a < 1 / FPS:
            die(f'la pieza {p["clip"]} {p["from"]}–{p["to"]} es demasiado corta')
        pieces.append({**p, 'from': a, 'to': b})
    used = sorted({p['clip'] for p in pieces}, key=names.index)
    idx = {n: i for i, n in enumerate(used)}
    voice = '--voice' in args or voice_only_format() or any(not takes['clips'][n].get('width') for n in used)
    g, labels = [], []
    for k, p in enumerate(pieces):
        i, a, b = idx[p['clip']], p['from'], p['to']
        if not voice:
            g.append(f'[{i}:v]fps={FPS},trim=start={a}:end={b},setpts=PTS-STARTPTS,scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},setsar=1[v{k}]')
        # 10 ms fades so no piece starts or ends on a click
        g.append(f'[{i}:a]atrim=start={a}:end={b},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=mono,afade=t=in:d=0.01,afade=t=out:st={max(0, b - a - 0.01):.3f}:d=0.01[a{k}]')
        labels.append(f'[a{k}]' if voice else f'[v{k}][a{k}]')
    os.makedirs('public', exist_ok=True)
    os.makedirs('src', exist_ok=True)
    cmd = ['ffmpeg', '-y', '-v', 'error']
    for n in used:
        cmd += ['-i', os.path.join('footage', n)]
    if voice:
        g.append(f'{"".join(labels)}concat=n={len(pieces)}:v=0:a=1[a]')
        cmd += ['-filter_complex', ';'.join(g), '-map', '[a]', '-c:a', 'pcm_s16le', 'public/vo.wav']
        if os.path.exists('public/footage.mp4'):
            os.remove('public/footage.mp4')
        print(f'Cortando {len(pieces)} piezas (solo la voz)…', file=sys.stderr, flush=True)
    else:
        g.append(f'{"".join(labels)}concat=n={len(pieces)}:v=1:a=1[v][a]')
        g.append('[a]asplit=2[a1][a2]')
        cmd += ['-filter_complex', ';'.join(g),
                '-map', '[v]', '-map', '[a1]', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', str(FPS),
                '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', 'public/footage.mp4',
                '-map', '[a2]', '-c:a', 'pcm_s16le', 'public/vo.wav']
        print(f'Cortando {len(pieces)} piezas a {W}×{H}, {FPS} fps…', file=sys.stderr, flush=True)
    r = subprocess.run(cmd)
    if r.returncode:
        die('ffmpeg falló')

    # The words on the cut's clock, and where each piece starts in it.
    words, segs, at = [], [], 0.0
    for p in pieces:
        d = p['to'] - p['from']
        for w in words_in(takes, p):
            words.append({'w': w['w'], 's': round(at + max(0, w['s'] - p['from']), 3), 'e': round(at + min(d, w['e'] - p['from']), 3)})
        segs.append({'at': round(at, 3), 'clip': p['clip'], 'from': p['from'], 'to': p['to']})
        at += d
    if not words:
        die('el corte no tiene palabras')
    save('src/words.json', words, indent=0)
    save('src/footage.json', {'duration': round(at, 3), 'width': W, 'height': H, 'fps': FPS, 'segments': segs}, indent=1)
    # vo.txt says exactly what words.json says (the studio checks it), one sentence per line for audio/beats.json.
    text = ' '.join(w['w'] for w in words)
    with open('audio/vo.txt', 'w') as fh:
        fh.write(re.sub(r'(?<=[.?!…])\s+', '\n', text).strip() + '\n')
    edit['pieces'] = [{**p, 'text': ' '.join(w['w'] for w in words_in(takes, p))} for p in pieces]
    save('audio/edit.json', edit, indent=1)
    # Loudness per video frame, like tools/el_words.py does for a generated voice.
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', 'public/vo.wav', '-ac', '1', '-ar', '16000', '-f', 's16le', '-'], capture_output=True).stdout
    n = len(raw) // 2
    s = struct.unpack(f'<{n}h', raw)
    hop = 16000 // FPS
    env = [math.sqrt(sum(x * x for x in s[i:i + hop]) / max(1, len(s[i:i + hop]))) for i in range(0, n, hop)]
    peak = sorted(env)[int(len(env) * 0.98)] or 1
    save('src/vo_env.json', [round(min(1, e / peak), 3) for e in env])
    print(f'{"" if voice else "public/footage.mp4 y "}public/vo.wav: {fmt(at)} ({len(pieces)} piezas, {len(words)} palabras). Escritos src/words.json, src/footage.json, src/vo_env.json y audio/vo.txt.')


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in ('transcribe', 'show', 'cut'):
        die('uso: footage.py transcribe [--lang es] [--pause 0.4] | show [N …] | cut [--voice]')
    cmd, args = sys.argv[1], sys.argv[2:]
    if cmd == 'transcribe':
        cmd_transcribe(args)
    elif cmd == 'show':
        edit = load('audio/edit.json')
        if not edit:
            die('No hay audio/edit.json: corre primero footage.py transcribe.')
        show(edit, load('audio/takes.json', {'clips': {}}), [int(x) for x in args])
    else:
        cmd_cut(args)


if __name__ == '__main__':
    main()

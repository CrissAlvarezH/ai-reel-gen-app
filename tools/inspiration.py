#!/usr/bin/env python3
"""Prepare a downloaded reel for analysis (Reel Studio → Inspiración).

    python tools/inspiration.py projects/<id>/inspiration/<account>/<code>

The folder has reel.json (from the scraper, Apify or ScrapeCreators: videoUrl, displayUrl…). Investigación's videos use it
too (projects/<id>/research/<id>/videos/<key>/): a YouTube Short ("platform": "youtube") has no videoUrl and is downloaded
from its url with yt-dlp (in the venv). This writes next to it:
  thumb.jpg        the cover
  hook.jpg         the first 3 s at 4 frames/s (12 frames, 6×2, left→right, top→bottom; frame i = i×0.25 s)
  sheet_NN.jpg     the whole reel at 1 frame/s, 30 frames per sheet (6×5; frame i of sheet n = second (n−1)×30+i)
  transcript.json  {language, duration, text, segments [{start, end, text}], words, wps} with faster-whisper
and then deletes the MP4 and the audio. The transcription needs faster-whisper in the workspace's venv
(Ajustes → Requisitos → Transcripción); the model is WHISPER_MODEL or "small".

Steps already done are skipped, so running it again only does what's missing.
"""
import json
import os
import shutil
import subprocess
import sys
import urllib.request

UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36'


def download(url, dest):
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    try:
        with urllib.request.urlopen(req, timeout=60) as r, open(dest + '.part', 'wb') as f:
            shutil.copyfileobj(r, f)
    except urllib.error.HTTPError as e:
        if e.code in (403, 404, 410):
            sys.exit(f'el enlace del video caducó ({e.code}): vuelve a descargarlo (en Investigación, vuelve a buscar)')
        raise
    os.replace(dest + '.part', dest)


def youtube(url, dest):
    # The best MP4 up to 720p with its audio (a Short is small); yt-dlp's error, its last line.
    try:
        import yt_dlp  # noqa: F401
    except ImportError:
        sys.exit('falta yt-dlp para bajar videos de YouTube: instálalo en Ajustes → Requisitos → Descarga de YouTube')
    r = subprocess.run([sys.executable, '-m', 'yt_dlp', '--no-playlist', '--quiet', '--no-warnings', '-f', 'b[height<=720][ext=mp4]/bv*[height<=720][ext=mp4]+ba[ext=m4a]/b', '--merge-output-format', 'mp4', '-o', dest, url], capture_output=True, text=True)
    if r.returncode or not os.path.exists(dest):
        sys.exit(f"yt-dlp no pudo bajar el video: {(r.stderr.strip().splitlines() or ['sin detalle'])[-1][-300:]}")


def ffmpeg(*args):
    r = subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', *args], capture_output=True, text=True)
    if r.returncode:
        sys.exit(f'ffmpeg falló: {r.stderr.strip()[-400:]}')


def has_audio(video):
    r = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', video], capture_output=True, text=True)
    return bool(r.stdout.strip())


def transcribe(wav):
    import wave

    import numpy as np
    from faster_whisper import WhisperModel  # imported here so the frames work without it

    # The samples go in already decoded (16 kHz mono from ffmpeg): faster-whisper's own decoder breaks with
    # newer PyAV versions.
    with wave.open(wav) as w:
        audio = np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float32) / 32768
    model = WhisperModel(os.environ.get('WHISPER_MODEL', 'small'), device='cpu', compute_type='int8')
    segments, info = model.transcribe(audio, vad_filter=True, word_timestamps=True)
    segs, words = [], []
    for s in segments:
        segs.append({'start': round(s.start, 2), 'end': round(s.end, 2), 'text': s.text.strip()})
        words += [{'start': round(w.start, 2), 'end': round(w.end, 2), 'word': w.word.strip()} for w in (s.words or [])]
    spoken = (words[-1]['end'] - words[0]['start']) if words else 0
    return {
        'language': info.language,
        'duration': round(info.duration, 2),
        'text': ' '.join(s['text'] for s in segs).strip(),
        'segments': segs,
        'words': len(words),
        # Speaking pace over the stretch that has speech (pauses inside count, silence before/after doesn't).
        'wps': round(len(words) / spoken, 2) if spoken > 1 else None,
    }


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    d = sys.argv[1]
    reel = json.load(open(os.path.join(d, 'reel.json')))
    p = lambda name: os.path.join(d, name)
    video, wav = p('video.mp4'), p('audio.wav')

    if not os.path.exists(p('thumb.jpg')) and reel.get('displayUrl'):
        print('portada', flush=True)
        download(reel['displayUrl'], p('thumb.jpg'))

    need_frames = not os.path.exists(p('hook.jpg'))
    need_text = not os.path.exists(p('transcript.json'))
    if need_frames or need_text:
        if not os.path.exists(video):
            print('video', flush=True)
            if reel.get('platform') == 'youtube' and reel.get('url'):
                youtube(reel['url'], video)
            elif not reel.get('videoUrl'):
                sys.exit('el scraper no dio el enlace del video')
            else:
                download(reel['videoUrl'], video)
        if need_frames:
            print('fotogramas', flush=True)
            ffmpeg('-t', '3', '-i', video, '-vf', 'fps=4,scale=240:-2,tile=6x2', '-frames:v', '1', '-q:v', '4', p('hook.jpg'))
            ffmpeg('-i', video, '-vf', 'fps=1,scale=180:-2,tile=6x5', '-q:v', '4', p('sheet_%02d.jpg'))
        if need_text:
            if not has_audio(video):
                t = {'language': None, 'duration': None, 'text': '', 'segments': [], 'words': 0, 'wps': None, 'noAudio': True}
            else:
                print('transcripción', flush=True)
                ffmpeg('-i', video, '-vn', '-ac', '1', '-ar', '16000', wav)
                t = transcribe(wav)
            json.dump(t, open(p('transcript.json'), 'w'), ensure_ascii=False, indent=1)

    for f in (video, wav):
        if os.path.exists(f):
            os.remove(f)
    print('ok', flush=True)


if __name__ == '__main__':
    main()

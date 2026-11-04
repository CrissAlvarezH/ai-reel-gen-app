#!/usr/bin/env python3
"""Read-only SQL over Reel Studio's index (.reel-studio/index.sqlite in the workspace): everything the app
keeps in files, of every project, in one SQLite database.

    python tools/studio_sql.py --schema            the tables and what each column means
    python tools/studio_sql.py "SELECT …"          the rows, as a table (--json for JSON, --full: no cutting)

Tables: projects; videos and video_beats (the videos made in the studio, per project: script, caption,
renders, structure, the reel it was posted as); own_accounts, own_reels and own_beats (Mi cuenta: each
project's own Instagram reels, with ratio = views over the account's median, engagement, video = the video it
came from, and, for those analysed, transcript and the agent's analysis); insp_accounts, insp_reels and insp_beats (Inspiración: the other accounts' reels each project studies, with transcript and the
agent's analysis). JSON arrays (visuals, takeaways, hashtags, mentions) work with json_each. Text search: the
search columns hold every text of the row, lowercase and without accents (LIKE '%palabra%').

Reel Studio keeps the index up to date from the files; before a query this asks it to catch up (when it's
running), and opens the index read-only. At most --max rows (200) are printed.
"""
import json
import os
import sqlite3
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # the workspace: this file is in its tools/
COUNTS = [('projects', 'proyectos'), ('videos', 'videos'), ('own_reels', 'reels propios'), ('insp_accounts', 'cuentas de Inspiración'), ('insp_reels', 'reels de Inspiración')]


# Ask the running studio to bring the index up to date with the files. Without it, the index is as it was.
def catch_up():
    url = os.environ.get('REEL_STUDIO_URL', 'http://127.0.0.1:4000').rstrip('/') + '/api/index/sync'
    try:
        urllib.request.urlopen(urllib.request.Request(url, data=b'{}', headers={'Content-Type': 'application/json'}, method='POST'), timeout=15).read()
        return True
    except Exception:
        return False


def main():
    args = sys.argv[1:]
    flags = {a for a in args if a.startswith('--') and '=' not in a}
    opts = dict(a[2:].split('=', 1) for a in args if a.startswith('--') and '=' in a)
    sql = ' '.join(a for a in args if not a.startswith('--')).strip()
    path = os.path.join(ROOT, '.reel-studio', 'index.sqlite')
    fresh = catch_up()
    if not os.path.exists(path):
        sys.exit('No hay índice todavía: abre Reel Studio en este workspace para crearlo.')
    if not fresh:
        print('(Reel Studio no responde: el índice puede no estar al día con los archivos)', file=sys.stderr)
    db = sqlite3.connect(f'file:{path}?mode=ro', uri=True, timeout=10)

    if '--schema' in flags or not sql:
        for (s,) in db.execute("SELECT sql FROM sqlite_master WHERE type = 'table' ORDER BY name"):
            print(s.strip() + ';\n')
        print('-- ' + ', '.join(f"{db.execute(f'SELECT count(*) FROM {t}').fetchone()[0]} {label}" for t, label in COUNTS))
        return

    try:
        cur = db.execute(sql)
    except sqlite3.Error as e:
        sys.exit(f'Error de SQL: {e}')
    cols = [c[0] for c in cur.description or []]
    limit = int(opts.get('max', 200))
    rows = cur.fetchmany(limit + 1)
    more = len(rows) > limit
    rows = rows[:limit]

    if '--json' in flags:
        print(json.dumps([dict(zip(cols, r)) for r in rows], ensure_ascii=False, indent=1))
    else:
        cut = (lambda v: v) if '--full' in flags else (lambda v: v if len(v) <= 160 else v[:157] + '…')
        cell = lambda v: '' if v is None else cut(str(v).replace('\n', ' ⏎ '))
        print('\t'.join(cols))
        for r in rows:
            print('\t'.join(cell(v) for v in r))
    print(f'-- {len(rows)} filas' + (f' (hay más: usa LIMIT o --max=N)' if more else ''), file=sys.stderr)


if __name__ == '__main__':
    main()

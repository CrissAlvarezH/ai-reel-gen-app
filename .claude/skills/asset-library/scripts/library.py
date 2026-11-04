#!/usr/bin/env python3
"""Asset library: one SQLite database plus the files it points at, under one root folder.

    python3 library.py init ROOT
    python3 library.py search "keyboard typing" --kind sfx --max-duration 0.5
    python3 library.py --help            # every command; `library.py CMD --help` for one

Every command prints JSON on stdout and exits 1 when it fails or finds a failure; errors carry
a `hint`. Python 3.9+ standard library; FFmpeg (ffprobe, ffmpeg) to probe media and make
previews. The record contract is ../references/records.md.

Use from another script, such as a local adapter that adds its own commands:

    import library as core
    lib = core.Library(root)                 # opens; migrates an older schema after a backup
    lib.search("whoosh", kind="sfx")         # list of asset dicts, as `search` prints them
    lib.asset_row("sfx-07")                  # one asset dict, or None
    lib.import_catalog(path, update=())      # additive import
    lib.check_library(); lib.check_project(project, cut, declared_path)
    lib.export()
    core.main(argv, root=ROOT, extend=fn)    # the CLI; fn(subparsers, parsers) -> {name: handler}
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import html
import json
import math
import os
import re
import secrets
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
import traceback
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

SCHEMA_VERSION = 2
SHORT_LEN = 12  # printed and folder length of a bundle version; lengthened on collision
MIN_PREFIX = 4  # shortest version prefix a command accepts
MEDIA_KINDS = ("image", "video", "sfx", "music")
BUNDLE_KINDS = ("character", "code", "model")
ROLES = ("visual", "music", "sfx", "voice", "character", "code", "model")
NOTE_KINDS = ("opinion", "test", "rights", "caveat")
VALIDATE_BASE_ENV = ("PATH", "HOME", "LANG", "TMPDIR", "SYSTEMROOT")
SKIP_DIRS = {".git", "node_modules", "__pycache__", ".venv", ".DS_Store"}
TEXT_SUFFIXES = {
    ".json", ".md", ".txt", ".csv", ".tsv", ".srt", ".vtt", ".ass", ".ts", ".tsx", ".js", ".jsx",
    ".mjs", ".py", ".xml", ".fcpxml", ".edl", ".otio", ".yaml", ".yml", ".toml", ".html",
}
SCAN_MAX_FILES = 20000
SCAN_MAX_TEXT_BYTES = 2 << 20
ID_RE = re.compile(r"[a-z0-9][a-z0-9._-]*")
FUNCTION_TAGS = {
    "whoosh", "click", "boom", "transition", "ui", "impact", "sting", "riser", "mechanical",
    "texture", "notification", "pop", "punch", "shutter", "typing", "tick", "glitch", "drum",
    "explosion", "accent", "comic",
}
MOOD_TAGS = {"emotional", "suspense", "playful", "warm", "instrumental"}

# Schema v1 is kept exactly as older libraries have it; v2 only adds (see migrate()).
DDL = [
    "CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
    """CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, category TEXT NOT NULL, title TEXT NOT NULL,
  path TEXT NOT NULL, sha256 TEXT, bytes INTEGER, duration_seconds REAL, width INTEGER,
  height INTEGER, sample_rate INTEGER, peak_dbfs REAL, thumbnail TEXT,
  archived INTEGER NOT NULL DEFAULT 0, canonical_id TEXT, extra_json TEXT, updated_at TEXT NOT NULL)""",
    """CREATE TABLE IF NOT EXISTS provenance (
  asset_id TEXT PRIMARY KEY, source_url TEXT, download_url TEXT, original_filename TEXT,
  creator TEXT, rights_status TEXT, license TEXT, license_url TEXT, review_status TEXT,
  selection_status TEXT, downloaded_at TEXT, review_notes TEXT, spoken_cue TEXT,
  planned_use TEXT, source_in REAL, source_out REAL, audio_use TEXT)""",
    """CREATE TABLE IF NOT EXISTS tags (
  asset_id TEXT NOT NULL, tag TEXT NOT NULL, facet TEXT NOT NULL DEFAULT 'content',
  PRIMARY KEY (asset_id, tag, facet))""",
    "CREATE TABLE IF NOT EXISTS variants (asset_id TEXT PRIMARY KEY, work_id TEXT NOT NULL, role TEXT)",
    """CREATE TABLE IF NOT EXISTS uses (
  id INTEGER PRIMARY KEY AUTOINCREMENT, asset_id TEXT NOT NULL, project TEXT NOT NULL,
  version TEXT, cue TEXT, output_time REAL, role TEXT, used_at TEXT NOT NULL)""",
    "CREATE INDEX IF NOT EXISTS uses_asset ON uses(asset_id)",
    "CREATE INDEX IF NOT EXISTS uses_project ON uses(project)",
    """CREATE VIRTUAL TABLE IF NOT EXISTS assets_fts USING fts5(
  id UNINDEXED, title, tags, notes, creator, cue, tokenize='unicode61 remove_diacritics 2')""",
    # v2
    """CREATE TABLE IF NOT EXISTS asset_versions (
  asset_id TEXT NOT NULL, version TEXT NOT NULL, dir TEXT NOT NULL, manifest_json TEXT NOT NULL,
  project TEXT, origin TEXT, created_at TEXT NOT NULL,
  validation TEXT NOT NULL DEFAULT 'not-run', validated_at TEXT,
  PRIMARY KEY (asset_id, version))""",
    """CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, asset_id TEXT NOT NULL, artifact_version TEXT,
  kind TEXT NOT NULL, text TEXT NOT NULL, source TEXT, created_at TEXT NOT NULL)""",
    "CREATE INDEX IF NOT EXISTS notes_asset ON notes(asset_id)",
    """CREATE TABLE IF NOT EXISTS deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT, project TEXT NOT NULL, cut TEXT NOT NULL,
  delivered_at TEXT NOT NULL, declared_json TEXT NOT NULL, registered_json TEXT NOT NULL,
  declined_reason TEXT)""",
]
USES_V2_COLUMNS = (("artifact_version", "TEXT"), ("modified", "INTEGER"))
ASSET_COLS = (
    "kind", "category", "title", "path", "sha256", "bytes", "duration_seconds", "width", "height",
    "sample_rate", "peak_dbfs", "thumbnail", "archived", "canonical_id", "extra_json", "updated_at",
)
PROV_COLS = (
    "source_url", "download_url", "original_filename", "creator", "rights_status", "license",
    "license_url", "review_status", "selection_status", "downloaded_at", "review_notes",
    "spoken_cue", "planned_use", "source_in", "source_out", "audio_use",
)
# Catalog entry keys with their own column; any other key is kept in extra_json.
CATALOG_KEYS = {c for c in ASSET_COLS if c not in ("category", "extra_json", "updated_at")} | set(PROV_COLS) | {
    "id", "tags", "duration", "thumbnail_path", "work_id", "variant_role",
}


class LibError(Exception):
    """A failure the agent can act on: printed as {"ok": false, "error", "hint", ...}."""

    def __init__(self, error: str, hint: str | None = None, **details):
        super().__init__(error)
        self.payload = {"ok": False, "error": error, **({"hint": hint} if hint else {}), **details}


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="microseconds")


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with Path(path).open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def canonical_json(obj) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def content_digest(content: dict) -> str:
    """A bundle version: the full SHA-256 of its content fields' canonical JSON."""
    return hashlib.sha256(canonical_json(content).encode()).hexdigest()


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-") or "asset"


def facet_for(tag: str) -> str:
    t = tag.lower()
    return "function" if t in FUNCTION_TAGS else "mood" if t in MOOD_TAGS else "content"


def category_for(kind: str) -> str:
    return "visual" if kind in ("image", "video") else kind


def fts_query(q: str) -> str | None:
    terms = re.findall(r"[A-Za-z0-9]+", q.lower())
    return " AND ".join(f"{t}*" for t in terms) if terms else None


def split_tags(text) -> list[str]:
    if isinstance(text, (list, tuple)):
        return [str(t).strip() for t in text if str(t).strip()]
    return [t.strip() for t in (text or "").split(",") if t.strip()]


def seconds(value, what: str) -> float | None:
    """A time in seconds: finite and not negative."""
    if value is None:
        return None
    try:
        t = float(value)
    except (TypeError, ValueError):
        raise LibError(f"{what} {value!r} is not a number of seconds")
    if not math.isfinite(t) or t < 0:
        raise LibError(f"{what} {value!r} must be a finite number of seconds, 0 or more")
    return t


def check_id(asset_id: str) -> str:
    if not isinstance(asset_id, str) or not ID_RE.fullmatch(asset_id):
        raise LibError(f"bad id {asset_id!r}", hint="IDs are lowercase letters, digits and - . _, starting with a letter or digit")
    return asset_id


def safe_rel(text: str, what: str) -> str:
    """A relative POSIX path that cannot leave its folder."""
    p = Path(text)
    if p.is_absolute() or ".." in p.parts:
        raise LibError(f"{what} {text!r} must be a relative path inside the bundle")
    return p.as_posix()


def resolve_root(explicit: str | None = None) -> Path:
    """--root, else ASSET_LIBRARY_ROOT, else a `Root:` line in ~/.asset-library/profile.md."""
    if explicit:
        return Path(explicit).expanduser()
    if os.environ.get("ASSET_LIBRARY_ROOT"):
        return Path(os.environ["ASSET_LIBRARY_ROOT"]).expanduser()
    profile = Path(os.environ.get("ASSET_LIBRARY_PROFILE", "~/.asset-library/profile.md")).expanduser()
    if profile.is_file():
        text = profile.read_text(errors="replace")
        m = re.search(r"^\W*Root:\s*`([^`]+)`", text, re.M) or re.search(r"^\W*Root:\s*(\S+)", text, re.M)
        if m:
            return Path(m.group(1).rstrip(".,;")).expanduser()
    raise LibError(
        "no library root configured",
        hint="pass --root ROOT, set ASSET_LIBRARY_ROOT, write 'Root: `PATH`' in ~/.asset-library/profile.md, or create a library with `library.py init ROOT`",
    )


def _pending_ddl(conn: sqlite3.Connection) -> list[str]:
    have = {r[0] for r in conn.execute("SELECT name FROM sqlite_master")}
    stmts = [s for s in DDL if re.search(r"EXISTS (\w+)", s).group(1) not in have]
    cols = {r[1] for r in conn.execute("PRAGMA table_info(uses)")}
    stmts += [f"ALTER TABLE uses ADD COLUMN {c} {t}" for c, t in USES_V2_COLUMNS if c not in cols]
    return stmts


def migrate(conn: sqlite3.Connection, db_path: Path) -> str | None:
    """Bring a library to SCHEMA_VERSION by adding tables and nullable columns only.

    An existing database is first copied with SQLite's backup API to
    library.db.bak-<old>-<timestamp>. Returns the backup path, or None when nothing changed.
    """
    has_meta = conn.execute("SELECT 1 FROM sqlite_master WHERE name='meta'").fetchone()
    old = None
    if has_meta:
        row = conn.execute("SELECT value FROM meta WHERE key='schema_version'").fetchone()
        old = row[0] if row else None
    if old is not None and not (re.fullmatch(r"[0-9]+", str(old)) and int(old) <= SCHEMA_VERSION):
        raise LibError(f"library schema {old!r} is newer than or unknown to this tool ({SCHEMA_VERSION})",
                       hint="update the asset-library skill; nothing was changed")
    pending = _pending_ddl(conn)
    if not pending and old == str(SCHEMA_VERSION):
        return None
    backup = None
    if pending and conn.execute("SELECT 1 FROM sqlite_master WHERE name='assets'").fetchone():
        stamp = datetime.now().strftime("%Y%m%dT%H%M%S%f")
        backup = db_path.with_name(f"{db_path.name}.bak-{old or 'unknown'}-{stamp}")
        dest = sqlite3.connect(str(backup))
        conn.backup(dest)
        dest.execute("PRAGMA journal_mode=DELETE")  # a standalone file
        dest.close()
        for side in ("-wal", "-shm"):  # some SQLite builds leave an empty sidecar after the switch
            Path(f"{backup}{side}").unlink(missing_ok=True)
    conn.execute("BEGIN IMMEDIATE")
    try:
        for stmt in _pending_ddl(conn):  # again under the write lock: another process may have migrated
            conn.execute(stmt)
        conn.execute("INSERT OR REPLACE INTO meta(key,value) VALUES('schema_version',?)", (str(SCHEMA_VERSION),))
        conn.execute("COMMIT")
    except BaseException:
        conn.execute("ROLLBACK")
        raise
    return str(backup) if backup else None


def probe_media(path: Path, kind: str) -> dict:
    if kind == "image" and path.suffix.lower() == ".svg":
        return {}
    exe = shutil.which("ffprobe")
    if not exe:
        raise LibError("ffprobe not found", hint="install FFmpeg (it provides ffprobe), then run ingest again")
    try:
        r = subprocess.run(
            [exe, "-v", "error", "-show_streams", "-show_format", "-of", "json", str(path)],
            capture_output=True, text=True, timeout=60,
        )
    except subprocess.TimeoutExpired:
        raise LibError(f"ffprobe timed out on {path}", hint="check the file is complete and on a readable disk")
    if r.returncode:
        raise LibError(f"ffprobe cannot read {path}", hint="check the file is a complete image, video or audio file", detail=r.stderr.strip()[-500:])
    data = json.loads(r.stdout or "{}")
    want = "audio" if kind in ("sfx", "music") else "video"
    stream = next((s for s in data.get("streams") or [] if s.get("codec_type") == want), None)
    if not stream:
        raise LibError(f"{path} has no {want} stream", hint=f"--kind {kind} needs a file with {want}; pick the right kind")
    out: dict = {}
    duration = (data.get("format") or {}).get("duration")
    if kind != "image" and duration not in (None, "N/A"):
        out["duration_seconds"] = float(duration)
    if want == "video":
        out["width"], out["height"] = stream.get("width"), stream.get("height")
    else:
        out["sample_rate"] = int(stream["sample_rate"]) if stream.get("sample_rate") else None
        out["peak_dbfs"] = peak_dbfs(path)
    return out


def peak_dbfs(path: Path) -> float | None:
    exe = shutil.which("ffmpeg")
    if not exe:
        return None
    r = subprocess.run(
        [exe, "-hide_banner", "-nostats", "-i", str(path), "-af", "volumedetect", "-f", "null", "-"],
        capture_output=True, text=True, timeout=300,
    )
    m = re.search(r"max_volume:\s*(-?[\d.]+) dB", r.stderr)
    return float(m.group(1)) if m else None  # None for digital silence (-inf) too


class Library:
    def __init__(self, root, create: bool = False):
        self.root = Path(root).expanduser().resolve()
        self.db_path = self.root / "library.db"
        if not self.db_path.is_file() and not create:
            raise LibError(
                f"no library at {self.root}",
                hint="create one with `library.py init ROOT`, or point --root / ASSET_LIBRARY_ROOT at an existing library",
            )
        if create:
            for d in ("media", "bundles", "previews", "exports"):
                (self.root / d).mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(str(self.db_path), timeout=30, isolation_level=None)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA busy_timeout=30000")
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.backup = migrate(self.conn, self.db_path)

    def close(self) -> None:
        self.conn.close()

    @contextmanager
    def tx(self):
        """One write transaction; BEGIN IMMEDIATE so concurrent writers queue on busy_timeout."""
        self.conn.execute("BEGIN IMMEDIATE")
        try:
            yield self.conn
        except BaseException:
            self.conn.execute("ROLLBACK")
            raise
        self.conn.execute("COMMIT")

    # -- paths ---------------------------------------------------------------------------------

    def rel(self, path) -> str:
        """Root-relative POSIX path when inside the root; absolute otherwise (legacy pointers)."""
        p = Path(path).expanduser()
        p = (p if p.is_absolute() else self.root / p).resolve()
        try:
            return p.relative_to(self.root).as_posix()
        except ValueError:
            return str(p)

    def media_dir(self, kind: str) -> Path:
        """Where ingest copies a file from outside the root; an adapter may override it."""
        return self.root / "media" / kind

    def abspath(self, stored: str) -> Path:
        p = Path(stored)
        return p if p.is_absolute() else self.root / p

    # -- reading -------------------------------------------------------------------------------

    def _asset(self, asset_id: str) -> sqlite3.Row:
        row = self.conn.execute("SELECT * FROM assets WHERE id=?", (asset_id,)).fetchone()
        if not row:
            raise LibError(f"unknown id {asset_id}", hint="find it with `search`; ingest or register it first if it is new")
        return row

    def versions_of(self, asset_id: str) -> list[str]:
        """Known full versions: a media file's content hash, or its registered bundle versions."""
        a = self.conn.execute("SELECT kind, sha256 FROM assets WHERE id=?", (asset_id,)).fetchone()
        if not a:
            return []
        if a["kind"] in MEDIA_KINDS:
            return [a["sha256"]] if a["sha256"] else []
        return [r[0] for r in self.conn.execute(
            "SELECT version FROM asset_versions WHERE asset_id=? ORDER BY created_at", (asset_id,))]

    def resolve_version(self, asset_id: str, ref: str | None = None, file=None) -> str:
        """The full version a use or note names. Never assumes the latest one."""
        asset = self._asset(asset_id)
        known = self.versions_of(asset_id)
        if file is not None:
            if asset["kind"] not in MEDIA_KINDS:
                raise LibError(f"{asset_id} is a {asset['kind']} bundle; give its artifact_version, not a file",
                               hint="the version is in the copied snapshot's bundle.json, or in `show ID`")
            f = Path(file)
            if not f.is_file():
                raise LibError(f"missing file {f}", hint="give the exact file the cut places")
            digest = sha256_file(f)
            if digest in known:
                return digest
            other = self.conn.execute("SELECT id FROM assets WHERE sha256=? ORDER BY canonical_id IS NOT NULL LIMIT 1", (digest,)).fetchone()
            raise LibError(
                f"{f} is not the library's copy of {asset_id}",
                hint=f"it is the library's {other['id']}; declare that ID" if other
                else "ingest the placed file (as a variant of the same work if it was cropped or re-encoded) and declare that asset",
                file_sha256=digest,
            )
        if not ref:
            raise LibError(f"no version given for {asset_id}",
                           hint="pass --artifact-version V (or --file F for media); 'latest' is never assumed")
        ref = str(ref).lower()
        if not re.fullmatch(r"[0-9a-f]{%d,64}" % MIN_PREFIX, ref):
            raise LibError(f"bad version {ref!r}", hint=f"a version is hex, at least {MIN_PREFIX} characters; see `show {asset_id}`")
        hits = [v for v in known if v.startswith(ref)]
        if not hits:
            raise LibError(f"unknown version {ref} of {asset_id}", hint=f"see `show {asset_id}` for its versions", known=[v[:SHORT_LEN] for v in known])
        if len(hits) > 1:
            raise LibError(f"version prefix {ref} is ambiguous for {asset_id}", hint="give more characters", candidates=hits)
        return hits[0]

    def _short(self, asset_id: str, version: str | None) -> str | None:
        if not version:
            return None
        row = self.conn.execute("SELECT dir FROM asset_versions WHERE asset_id=? AND version=?", (asset_id, version)).fetchone()
        return Path(row["dir"]).name if row else version[:SHORT_LEN]

    def asset_row(self, asset_id: str, include_uses: bool = True) -> dict | None:
        row = self.conn.execute(
            """SELECT a.*, p.source_url, p.download_url, p.original_filename, p.creator,
                      p.rights_status, p.license, p.license_url, p.review_status,
                      p.selection_status, p.downloaded_at, p.review_notes, p.spoken_cue,
                      p.planned_use, p.source_in, p.source_out, p.audio_use,
                      v.work_id, v.role AS variant_role
               FROM assets a LEFT JOIN provenance p ON p.asset_id=a.id
               LEFT JOIN variants v ON v.asset_id=a.id WHERE a.id=?""",
            (asset_id,),
        ).fetchone()
        if not row:
            return None
        out = dict(row)
        out["tags"] = [{"tag": r["tag"], "facet": r["facet"]} for r in self.conn.execute(
            "SELECT tag, facet FROM tags WHERE asset_id=? ORDER BY facet, tag", (asset_id,))]
        out["abs_path"] = str(self.abspath(out["path"]))
        if out.get("thumbnail"):
            out["abs_thumbnail"] = str(self.abspath(out["thumbnail"]))
        if out["kind"] in MEDIA_KINDS:
            out["versions"] = [{"version": out["sha256"], "short": out["sha256"][:SHORT_LEN], "basis": "content hash"}] if out["sha256"] else []
        else:
            out["versions"] = [{
                "version": r["version"], "short": Path(r["dir"]).name, "dir": r["dir"], "project": r["project"],
                "origin": json.loads(r["origin"]) if r["origin"] else None, "created_at": r["created_at"],
                "validation": r["validation"], "validated_at": r["validated_at"],
            } for r in self.conn.execute("SELECT * FROM asset_versions WHERE asset_id=? ORDER BY created_at", (asset_id,))]
        out["notes"] = [dict(r) for r in self.conn.execute(
            "SELECT kind, text, source, artifact_version, created_at FROM notes WHERE asset_id=? ORDER BY id", (asset_id,))]
        if include_uses:
            out["uses"] = [{**dict(r), "cut": r["version"], "modified": bool(r["modified"])} for r in self.conn.execute(
                """SELECT project, version, artifact_version, modified, cue, output_time, role, used_at
                   FROM uses WHERE asset_id=? ORDER BY used_at, id""", (asset_id,))]
        extra = out.pop("extra_json", None)
        if extra:
            try:
                out["extra"] = json.loads(extra)
            except json.JSONDecodeError:
                out["extra"] = extra
        return out

    def search(self, query: str = "", kind: str | None = None, tag: str | None = None,
               max_duration: float | None = None, min_duration: float | None = None, rights: str = "any",
               unused_in: str | None = None, archived: bool = False, limit: int = 20) -> list[dict]:
        def filters(where: list, params: list) -> None:
            if not archived:
                where += ["a.archived=0", "a.canonical_id IS NULL"]
            if kind == "visual":
                where.append("a.category='visual'")
            elif kind:
                where.append("(a.kind=? OR a.category=?)")
                params += [kind, kind]
            if max_duration is not None:
                where.append("(a.duration_seconds IS NULL OR a.duration_seconds<=?)")
                params.append(max_duration)
            if min_duration is not None:
                where.append("a.duration_seconds>=?")
                params.append(min_duration)
            if rights == "verified":
                where.append("p.rights_status='verified'")
            elif rights == "unknown":
                where.append("(p.rights_status LIKE '%unknown%' OR p.rights_status LIKE '%unverified%')")
            if tag:
                where.append("EXISTS (SELECT 1 FROM tags t WHERE t.asset_id=a.id AND lower(t.tag)=lower(?))")
                params.append(tag)
            if unused_in:
                where.append("NOT EXISTS (SELECT 1 FROM uses u WHERE u.asset_id=a.id AND u.project=?)")
                params.append(unused_in)

        def run(text_clause: str | None, text_params: list) -> list[str]:
            where, params = [], []
            filters(where, params)
            if text_clause:
                where.append(text_clause)
                params += text_params
            sql = f"""SELECT a.id FROM assets a LEFT JOIN provenance p ON p.asset_id=a.id
                      {"WHERE " + " AND ".join(where) if where else ""} ORDER BY a.kind, a.title LIMIT ?"""
            return [r["id"] for r in self.conn.execute(sql, [*params, limit])]

        query = (query or "").strip()
        match = fts_query(query) if query else None
        ids = run("a.id IN (SELECT id FROM assets_fts WHERE assets_fts MATCH ?)", [match]) if match else run(None, [])
        if query and not ids:
            like = f"%{query.lower()}%"
            ids = run("(lower(a.title) LIKE ? OR lower(a.id) LIKE ? OR EXISTS (SELECT 1 FROM tags t WHERE t.asset_id=a.id AND lower(t.tag) LIKE ?))", [like] * 3)
        return [self.asset_row(i) for i in ids]

    # -- writing assets ------------------------------------------------------------------------

    def index_fts(self, asset_id: str) -> None:
        row = self.conn.execute(
            """SELECT a.title, p.creator, p.review_notes, p.spoken_cue, p.planned_use, p.rights_status
               FROM assets a LEFT JOIN provenance p ON p.asset_id=a.id WHERE a.id=?""", (asset_id,)).fetchone()
        if not row:
            return
        tags = " ".join(r["tag"] for r in self.conn.execute("SELECT tag FROM tags WHERE asset_id=?", (asset_id,)))
        notes = [row["review_notes"], row["planned_use"], row["rights_status"]]
        notes += [r["text"] for r in self.conn.execute("SELECT text FROM notes WHERE asset_id=?", (asset_id,))]
        self.conn.execute("DELETE FROM assets_fts WHERE id=?", (asset_id,))
        self.conn.execute(
            "INSERT INTO assets_fts(id,title,tags,notes,creator,cue) VALUES(?,?,?,?,?,?)",
            (asset_id, row["title"] or "", tags, " ".join(filter(None, notes)), row["creator"] or "", row["spoken_cue"] or ""),
        )

    def _set_tags(self, asset_id: str, tags) -> None:
        self.conn.execute("DELETE FROM tags WHERE asset_id=?", (asset_id,))
        for t in split_tags(tags):
            self.conn.execute("INSERT OR IGNORE INTO tags(asset_id,tag,facet) VALUES(?,?,?)", (asset_id, t, facet_for(t)))

    def _insert_asset(self, rec: dict) -> None:
        """Insert a new asset with its provenance, tags and variant link. Never overwrites."""
        rec = {**rec, "category": category_for(rec["kind"]), "updated_at": now()}
        rec.setdefault("archived", 0)
        self.conn.execute(
            f"INSERT INTO assets(id,{','.join(ASSET_COLS)}) VALUES(?{',?' * len(ASSET_COLS)})",
            (rec["id"], *(rec.get(c) for c in ASSET_COLS)),
        )
        self.conn.execute(
            f"INSERT INTO provenance(asset_id,{','.join(PROV_COLS)}) VALUES(?{',?' * len(PROV_COLS)})",
            (rec["id"], *(rec.get(c) for c in PROV_COLS)),
        )
        self._set_tags(rec["id"], rec.get("tags"))
        if rec.get("work_id"):
            self.conn.execute("INSERT INTO variants(asset_id,work_id,role) VALUES(?,?,?)",
                              (rec["id"], rec["work_id"], rec.get("variant_role")))
        self.index_fts(rec["id"])

    def _free_id(self, base: str, digest: str) -> str:
        base = slug(base)
        if not self.conn.execute("SELECT 1 FROM assets WHERE id=?", (base,)).fetchone():
            return base
        return f"{base}-{digest[:6]}"

    def make_preview(self, asset_id: str, kind: str, src: Path, duration: float | None) -> tuple[str | None, str | None]:
        if kind not in ("image", "video") or src.suffix.lower() == ".svg":
            return None, None
        exe = shutil.which("ffmpeg")
        if not exe:
            return None, "ffmpeg not found; no preview made"
        dest = self.root / "previews" / f"{asset_id}.jpg"
        dest.parent.mkdir(parents=True, exist_ok=True)
        seek = ["-ss", "1"] if kind == "video" and (duration or 0) > 2 else []
        cmd = [exe, "-v", "error", "-y", *seek, "-i", str(src), "-frames:v", "1",
               "-vf", "scale=560:360:force_original_aspect_ratio=decrease:force_divisible_by=2", str(dest)]
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        if r.returncode or not dest.exists():
            return None, f"preview failed: {r.stderr.strip()[-300:]}"
        return self.rel(dest), None

    def ingest(self, file, kind: str, title: str | None = None, asset_id: str | None = None, tags=(),
               work_id: str | None = None, variant_role: str | None = None, **prov) -> dict:
        src = Path(file).expanduser().resolve()
        if kind not in MEDIA_KINDS:
            raise LibError(f"ingest takes media kinds {', '.join(MEDIA_KINDS)}", hint="use `register` for characters, code and models")
        if not src.is_file():
            raise LibError(f"missing file {src}", hint="check the path; ingest takes one media file")
        if asset_id:
            check_id(asset_id)
        for k in ("source_in", "source_out"):
            prov[k] = seconds(prov.get(k), f"--{k.replace('_', '-')}")
        if prov["source_in"] is not None and prov["source_out"] is not None and prov["source_out"] <= prov["source_in"]:
            raise LibError(f"--source-out {prov['source_out']} must be after --source-in {prov['source_in']}")
        digest = sha256_file(src)

        def duplicate():
            return self.conn.execute(
                "SELECT id FROM assets WHERE sha256=? ORDER BY canonical_id IS NOT NULL, archived, id LIMIT 1", (digest,)).fetchone()

        def taken(i):
            return self.conn.execute("SELECT 1 FROM assets WHERE id=?", (i,)).fetchone()

        dup = duplicate()
        if dup:
            return self._duplicate(dup["id"], src, digest)
        if asset_id and taken(asset_id):
            raise LibError(f"id {asset_id} is taken by another asset", hint="choose another --id, or omit it")
        meta = probe_media(src, kind)
        warnings = []
        if kind == "image" and src.suffix.lower() == ".svg":
            warnings.append("SVG: no width, height or preview recorded")
        try:
            src.relative_to(self.root)
            stored, created = src, False
        except ValueError:
            dest_dir = self.media_dir(kind)
            stored, created = self._copy_in(src, digest, [dest_dir / src.name, dest_dir / f"{src.stem}-{digest[:8]}{src.suffix}"])
        title = title or src.stem.replace("-", " ").replace("_", " ")
        explicit = bool(asset_id)
        asset_id = asset_id or self._free_id(f"{kind}-{title}", digest)
        rec = {
            "id": asset_id, "kind": kind, "title": title, "path": self.rel(stored), "sha256": digest,
            "bytes": stored.stat().st_size, "tags": tags, "work_id": work_id,
            "variant_role": variant_role, "original_filename": src.name, "downloaded_at": prov.pop("downloaded_at", None) or now(),
            **meta, **{k: v for k, v in prov.items() if k in PROV_COLS},
        }
        rec.setdefault("rights_status", "unknown")
        inserted = False
        with self.tx():
            try:
                dup = duplicate()  # another agent may have ingested the same file meanwhile
                if not dup:
                    if not stored.exists():
                        raise LibError(f"{self.rel(stored)} was removed meanwhile", hint="run ingest again")
                    if taken(asset_id):
                        if explicit:
                            raise LibError(f"id {asset_id} was taken meanwhile", hint="choose another --id, or omit it")
                        asset_id = rec["id"] = f"{slug(f'{kind}-{title}')}-{digest[:6]}"
                        if taken(asset_id):
                            raise LibError(f"id {asset_id} was taken meanwhile", hint="run ingest again")
                    self._insert_asset(rec)
                    inserted = True
            finally:  # under the write lock, so no other ingest can start pointing at the copy first
                if created and not inserted and not self.conn.execute("SELECT 1 FROM assets WHERE path=?", (rec["path"],)).fetchone():
                    stored.unlink(missing_ok=True)
        if dup:
            return {"ok": True, "duplicate_of": dup["id"], "asset": self.asset_row(dup["id"])}
        preview, warn = self.make_preview(asset_id, kind, stored, meta.get("duration_seconds"))  # the ID is ours now
        if warn:
            warnings.append(warn)
        if preview:
            with self.tx():
                self.conn.execute("UPDATE assets SET thumbnail=? WHERE id=? AND thumbnail IS NULL", (preview, asset_id))
        return {"ok": True, "asset": self.asset_row(asset_id), "warnings": warnings}

    def _copy_in(self, src: Path, digest: str, names: list[Path]) -> tuple[Path, bool]:
        """Put src's bytes at the first of names that is free or already holds them; never
        overwrites a file. Returns (path, created)."""
        names[0].parent.mkdir(parents=True, exist_ok=True)
        part = names[0].with_name(f".{names[0].name}.{secrets.token_hex(4)}.part")
        try:
            shutil.copyfile(src, part)
            if sha256_file(part) != digest:
                raise LibError(f"{src} changed while it was copied", hint="wait until it is finished writing, then ingest again")
            for name in names:
                try:
                    os.close(os.open(name, os.O_CREAT | os.O_EXCL | os.O_WRONLY))  # claim the name
                except FileExistsError:
                    if sha256_file(name) == digest:
                        return name, False
                    continue
                try:
                    os.replace(part, name)  # over our own empty claim: atomic, and nobody else's file
                except BaseException:
                    name.unlink(missing_ok=True)
                    raise
                return name, True
        finally:
            part.unlink(missing_ok=True)
        raise LibError(f"{', '.join(self.rel(n) for n in names)} already hold other files",
                       hint="move the stray file aside (run `check`), then ingest again")

    def _duplicate(self, asset_id: str, src: Path, digest: str) -> dict:
        """An exact duplicate's answer; puts the bytes back when the library's copy went missing."""
        out = {"ok": True, "duplicate_of": asset_id}
        stored = self._asset(asset_id)["path"]
        if not self.abspath(stored).exists():
            if Path(stored).is_absolute():
                out["warnings"] = [f"its file {stored} is missing and outside the root; not restored"]
            else:
                try:
                    self._copy_in(src, digest, [self.abspath(stored)])
                    out["restored"] = stored
                except LibError as e:
                    out["warnings"] = [f"its file {stored} is missing and was not restored: {e.payload['error']}"]
        return {**out, "asset": self.asset_row(asset_id)}

    # -- bundles -------------------------------------------------------------------------------

    def _collect(self, source: Path, specs: list[str]) -> dict[str, Path]:
        """Expand files, folders and globs under source into {relative path: file}."""
        src_root = source.resolve()
        found: dict[str, Path] = {}

        def add(path: Path) -> None:
            real = path.resolve()
            if real != src_root and src_root not in real.parents:
                raise LibError(f"{path} is outside the bundle source {src_root}",
                               hint="a bundle holds only files under --source; copy what it needs into the project first")
            found[Path(os.path.relpath(path, source)).as_posix()] = path

        for spec in specs:
            if not spec:
                continue
            given = Path(spec).expanduser()
            if given.is_absolute():
                try:
                    given.resolve().relative_to(src_root)
                except ValueError:
                    raise LibError(f"{spec} is outside the bundle source {src_root}",
                                   hint="a bundle holds only files under --source; copy what it needs into the project first")
                given = Path(os.path.relpath(given, source))
            if ".." in given.parts:
                raise LibError(f"{spec} leaves the bundle source", hint="name files inside --source")
            matches = sorted(source.glob(given.as_posix())) if re.search(r"[*?\[]", spec) else [source / given]
            matches = [m for m in matches if m.exists()]
            if not matches:
                raise LibError(f"{spec} matched nothing under {source}", hint="check the path, relative to --source")
            for m in matches:
                if m.is_dir():
                    for dirpath, dirnames, filenames in os.walk(m):
                        dirnames[:] = sorted(d for d in dirnames if d not in SKIP_DIRS)
                        for name in sorted(filenames):
                            if name not in SKIP_DIRS:
                                add(Path(dirpath) / name)
                else:
                    add(m)
        return found

    def build_content(self, source, entry: str, files: list[str], example: str | None = None,
                      preview: str | None = None, dependencies=(), validate: dict | None = None,
                      dimensions: dict | None = None) -> tuple[dict, dict[str, Path]]:
        """A bundle's content fields (what its version digests) and the files they name."""
        source = Path(source).expanduser()
        if not source.is_dir():
            raise LibError(f"missing bundle source folder {source}", hint="--source is the project folder the paths are relative to")
        found = self._collect(source, [*files, entry, example or "", preview or ""])
        named = {}
        for label, value in (("entry", entry), ("example", example), ("preview", preview)):
            if value:
                rel = Path(os.path.relpath(source / Path(value).expanduser(), source)).as_posix()
                if rel not in found:
                    raise LibError(f"{label} {value} is not a file in the bundle", hint=f"name the {label} file itself, relative to --source")
                named[label] = rel
        listed = []
        for rel, path in sorted(found.items()):
            listed.append({"path": rel, "sha256": sha256_file(path), "size": path.stat().st_size})
        content = {
            "entry": named["entry"], "files": listed,
            "dependencies": sorted(set(dependencies or ())),
            "example": named.get("example"), "preview": named.get("preview"),
            "validate": validate, "dimensions": dimensions,
        }
        return {k: v for k, v in content.items() if v is not None}, found

    def _dir_version(self, vdir: Path) -> str | None:
        """The version a published folder holds, when its bundle.json is intact."""
        try:
            manifest = json.loads((vdir / "bundle.json").read_text())
            version = manifest["version"]
            return version if content_digest(manifest["content"]) == version else None
        except (OSError, ValueError, KeyError, TypeError):
            return None

    def _verify_dir(self, vdir: Path) -> list[str]:
        """Files of a published folder that are missing or differ from its manifest."""
        try:
            manifest = json.loads((vdir / "bundle.json").read_text())
        except (OSError, ValueError):
            return ["bundle.json unreadable"]
        if content_digest(manifest.get("content") or {}) != manifest.get("version"):
            return ["bundle.json content does not match its version"]
        bad = []
        for f in manifest["content"]["files"]:
            p = vdir / "files" / f["path"]
            if not p.is_file() or sha256_file(p) != f["sha256"]:
                bad.append(f["path"])
        return bad

    def register(self, kind: str, asset_id: str, entry: str, files: list[str], source=".", title: str | None = None,
                 example: str | None = None, preview: str | None = None, planned_use: str | None = None, tags=(),
                 dependencies=(), dimensions: dict | None = None, validate: dict | None = None,
                 no_validate: str | None = None, project: str | None = None, origin: str | None = None,
                 creator: str | None = None, rights_status: str | None = None) -> dict:
        """Stage, verify, publish and record one immutable bundle version, then validate it."""
        if kind not in BUNDLE_KINDS:
            raise LibError(f"register takes {', '.join(BUNDLE_KINDS)}", hint="use `ingest` for media files")
        check_id(asset_id)
        existing = self.conn.execute(
            "SELECT a.kind, p.planned_use FROM assets a LEFT JOIN provenance p ON p.asset_id=a.id WHERE a.id=?", (asset_id,)).fetchone()
        if existing and existing["kind"] != kind:
            raise LibError(f"{asset_id} is a {existing['kind']}, not a {kind}", hint="use a new --id for a different kind")
        missing = []
        if not existing and not title:
            missing.append("--title")
        if not planned_use and not (existing and existing["planned_use"]):
            missing.append("--planned-use")
        if not preview:
            missing.append("--preview")
        if kind in ("code", "character") and not example:
            missing.append("--example")
        if kind in ("code", "character") and not validate and not no_validate:
            missing.append("--validate-command (or --no-validate REASON)")
        if missing:
            raise LibError(f"a {kind} bundle needs {', '.join(missing)}",
                           hint="see the asset-library records reference, 'Versions and bundles'")
        if validate:
            validate = {
                "command": validate["command"], "cwd": safe_rel(validate.get("cwd") or ".", "--validate-cwd"),
                "setup": validate.get("setup") or None, "env": sorted(set(validate.get("env") or ())),
                "timeout_s": int(validate.get("timeout_s") or 600),
            }
        if dimensions is not None and not (isinstance(dimensions, dict) and all(
                isinstance(dimensions.get(k), (int, float)) for k in ("x", "y", "z") if k in dimensions)):
            raise LibError("--dimensions must be a JSON object such as {\"x\": 2.1, \"y\": 1.4, \"z\": 4.5, \"up\": \"y\"} (metres)")
        source = Path(source).expanduser()
        content, found = self.build_content(source, entry, files, example, preview, dependencies, validate, dimensions)
        version = content_digest(content)
        expected = {f["path"]: f["sha256"] for f in content["files"]}
        if origin:
            origin_rec = {"text": origin}
        else:
            origin_rec = {"source": str(source.resolve())}
            git = shutil.which("git")
            if git:
                head = subprocess.run([git, "-C", str(source), "rev-parse", "HEAD"], capture_output=True, text=True)
                if head.returncode == 0:
                    dirty = subprocess.run([git, "-C", str(source), "status", "--porcelain"], capture_output=True, text=True)
                    origin_rec.update(commit=head.stdout.strip(), dirty=bool(dirty.stdout.strip()))
        created = now()
        manifest = {"id": asset_id, "kind": kind, "version": version, "content": content,
                    "record": {"origin": origin_rec, "created_at": created, "title": title, "planned_use": planned_use}}

        bundles = self.root / "bundles"
        staging = bundles / ".staging" / secrets.token_hex(8)
        published, status = None, "registered"
        try:
            (staging / "files").mkdir(parents=True)
            for rel, path in sorted(found.items()):
                dest = staging / "files" / rel
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(path, dest)
            changed = [rel for rel in expected if sha256_file(staging / "files" / rel) != expected[rel]]
            if changed:
                raise LibError("source files changed while they were copied; nothing was registered",
                               hint="wait until they stop changing (a running build or render?), then register again", files=changed)
            (staging / "bundle.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False, sort_keys=True) + "\n")
            id_dir = bundles / asset_id
            id_dir.mkdir(parents=True, exist_ok=True)
            n = SHORT_LEN
            while n <= 64:
                target = id_dir / version[:n]
                if not target.exists():
                    try:
                        os.rename(staging, target)  # atomic on one filesystem
                        published = target
                        break
                    except OSError as e:
                        if not target.exists():
                            raise LibError(f"cannot publish {self.rel(target)}: {e}",
                                           hint=f"check permissions, free space and that bundles/{asset_id} is on the library's disk; nothing was registered") from e
                        continue  # created meanwhile: look again at the same length
                if self._dir_version(target) == version:
                    published, status = target, "existing"
                    break
                n += 1
            if published is None:
                raise LibError(f"no free folder for {asset_id} {version}", hint="run `check` and look at bundles/{asset_id}")
        finally:
            if staging.exists():
                shutil.rmtree(staging, ignore_errors=True)
        if status == "existing":
            bad = self._verify_dir(published)
            if bad:
                raise LibError(f"published folder {self.rel(published)} does not match its manifest",
                               hint="move that folder aside, then register again", files=bad)
        row = self.conn.execute("SELECT * FROM asset_versions WHERE asset_id=? AND version=?", (asset_id, version)).fetchone()
        if not row:
            status = "adopted" if status == "existing" else "registered"
            entry_path = self.rel(published / "files" / content["entry"])
            preview_path = self.rel(published / "files" / content["preview"])
            with self.tx():
                if not self.conn.execute("SELECT 1 FROM assets WHERE id=?", (asset_id,)).fetchone():
                    self._insert_asset({
                        "id": asset_id, "kind": kind, "title": title, "path": entry_path, "thumbnail": preview_path,
                        "planned_use": planned_use, "tags": tags, "creator": creator,
                        "rights_status": rights_status or "own work",
                    })
                else:
                    old = self.conn.execute("SELECT path, thumbnail FROM assets WHERE id=?", (asset_id,)).fetchone()
                    if not old["path"].startswith(f"bundles/{asset_id}/"):  # first bundle for a legacy or imported asset
                        self.conn.execute(
                            "INSERT INTO notes(asset_id,artifact_version,kind,text,source,created_at) VALUES(?,?,?,?,?,?)",
                            (asset_id, None, "caveat", f"Before its first bundle version this asset pointed at {old['path']}"
                             + (f" (preview {old['thumbnail']})" if old["thumbnail"] else "") + "; that file is not a recorded version",
                             "register", now()))
                    self.conn.execute("UPDATE assets SET path=?, thumbnail=?, updated_at=? WHERE id=?",
                                      (entry_path, preview_path, now(), asset_id))
                    if planned_use:
                        self.conn.execute("INSERT OR IGNORE INTO provenance(asset_id) VALUES(?)", (asset_id,))
                        self.conn.execute(
                            "UPDATE provenance SET planned_use=? WHERE asset_id=? AND (planned_use IS NULL OR planned_use='')",
                            (planned_use, asset_id))
                self.conn.execute(
                    """INSERT OR IGNORE INTO asset_versions(asset_id,version,dir,manifest_json,project,origin,created_at)
                       VALUES(?,?,?,?,?,?,?)""",
                    (asset_id, version, self.rel(published), (published / "bundle.json").read_text(), project,
                     json.dumps(origin_rec, ensure_ascii=False), now()),
                )
                if no_validate:
                    self.conn.execute(
                        "INSERT INTO notes(asset_id,artifact_version,kind,text,source,created_at) VALUES(?,?,?,?,?,?)",
                        (asset_id, version, "caveat", f"Not validated: {no_validate}", "register --no-validate", now()))
                self.index_fts(asset_id)
            row = self.conn.execute("SELECT * FROM asset_versions WHERE asset_id=? AND version=?", (asset_id, version)).fetchone()
        else:
            status = "unchanged"
        result = {"ok": True, "status": status, "id": asset_id, "version": version, "short": Path(row["dir"]).name,
                  "dir": row["dir"], "validation": row["validation"]}
        if validate and row["validation"] != "passed":
            run = self.validate_version(asset_id, version)
            result.update(validation=run["status"], validation_run=run)
            if run["status"] != "passed":
                result.update(ok=False, error="the version is recorded, but its validation failed",
                              hint="a snapshot runs without your project folder: add the files or setup it needs and register again")
        elif not validate:
            result["warnings"] = ["no validation command: recorded as not validated"]
        return result

    def validate_version(self, asset_id: str, version: str) -> dict:
        """Run a version's validate config in a fresh temporary copy of its published snapshot."""
        row = self.conn.execute("SELECT dir, manifest_json FROM asset_versions WHERE asset_id=? AND version=?", (asset_id, version)).fetchone()
        cfg = json.loads(row["manifest_json"])["content"].get("validate")
        if not cfg:
            return {"status": "not-run"}
        started = time.time()
        result = {"status": "passed", "step": None, "exit_code": 0, "output_tail": ""}
        with tempfile.TemporaryDirectory(prefix="asset-library-validate-") as tmp:
            work = Path(tmp) / "files"
            shutil.copytree(self.abspath(row["dir"]) / "files", work)
            cwd = work / cfg.get("cwd", ".")
            env = {k: os.environ[k] for k in (*VALIDATE_BASE_ENV, *cfg.get("env", ())) if k in os.environ}
            if not cwd.is_dir():
                result.update(status="failed", step="cwd", exit_code=None, output_tail=f"{cfg.get('cwd')} is not a folder in the snapshot")
            for step in ("setup", "command"):
                if result["status"] == "failed" or not cfg.get(step):
                    continue
                try:
                    r = subprocess.run(cfg[step], shell=True, cwd=cwd, env=env, capture_output=True, text=True,
                                       timeout=cfg.get("timeout_s", 600))
                    tail = (r.stdout + r.stderr)[-1500:]
                    if r.returncode:
                        result.update(status="failed", step=step, exit_code=r.returncode, output_tail=tail)
                    else:
                        result["output_tail"] = tail
                except subprocess.TimeoutExpired:
                    result.update(status="failed", step=step, exit_code=None, output_tail=f"timed out after {cfg.get('timeout_s')} s")
        result["seconds"] = round(time.time() - started, 2)
        text = (f"Validation {result['status']}" + (f" at {result['step']}" if result["step"] else "")
                + f": `{cfg['command']}` in a fresh copy of the snapshot, {result['seconds']} s"
                + (f", exit {result['exit_code']}" if result["exit_code"] else "")
                + (f". Output tail: {result['output_tail'][-600:]}" if result["status"] == "failed" else ""))
        with self.tx():
            self.conn.execute("UPDATE asset_versions SET validation=?, validated_at=? WHERE asset_id=? AND version=?",
                              (result["status"], now(), asset_id, version))
            self.conn.execute(
                "INSERT INTO notes(asset_id,artifact_version,kind,text,source,created_at) VALUES(?,?,?,?,?,?)",
                (asset_id, version, "test", text, "register validation", now()))
        return result

    # -- uses, declarations, deliveries --------------------------------------------------------

    def resolve_entries(self, entries, base_dir=None) -> tuple[list[dict], list[dict]]:
        """Check use entries ({id, role, artifact_version | file, cue, output_time, modified})."""
        resolved, errors = [], []
        if not isinstance(entries, list):
            return [], [{"error": "selected must be a list"}]
        for i, e in enumerate(entries):
            try:
                if not isinstance(e, dict) or not e.get("id"):
                    raise LibError("entry has no id")
                asset = self._asset(e["id"])
                if e.get("role") not in ROLES:
                    raise LibError(f"role {e.get('role')!r} is not one of {', '.join(ROLES)}",
                                   hint="put detail such as 'whoosh' in the cue")
                file = e.get("file")
                if file is not None:
                    file = Path(file).expanduser()
                    if not file.is_absolute():
                        file = Path(base_dir or ".") / file
                version = self.resolve_version(e["id"], e.get("artifact_version"), file=file)
                modified = bool(e.get("modified"))
                if modified and asset["kind"] not in BUNDLE_KINDS:
                    raise LibError("modified applies only to bundles", hint="a changed media file is a new asset; ingest it")
                resolved.append({
                    "id": e["id"], "role": e["role"], "artifact_version": version, "modified": modified,
                    "cue": e.get("cue"), "output_time": seconds(e.get("output_time"), "output_time"),
                    **({"file": str(e["file"])} if e.get("file") else {}),
                })
            except (LibError, ValueError, TypeError) as err:
                payload = err.payload if isinstance(err, LibError) else {"error": str(err)}
                errors.append({"entry": i, "id": e.get("id") if isinstance(e, dict) else None,
                               **{k: v for k, v in payload.items() if k != "ok"}})
        return resolved, errors

    def record_uses(self, project: str, cut: str, entries, base_dir=None) -> dict:
        """Record uses in one transaction: every entry, or none when any is invalid."""
        if not project or not cut:
            raise LibError("a use needs --project and --cut", hint="the cut is the project's cut (v3, final), not the asset's version")
        resolved, errors = self.resolve_entries(entries, base_dir)
        if errors:
            raise LibError("nothing recorded: fix these entries and record again", errors=errors)
        recorded, already = [], []
        with self.tx():
            for e in resolved:
                key = (e["id"], project, cut, e["artifact_version"], e["role"], e["cue"], e["output_time"], int(e["modified"]))
                if self.conn.execute(
                        """SELECT 1 FROM uses WHERE asset_id=? AND project=? AND version=? AND artifact_version=? AND role=?
                           AND cue IS ? AND output_time IS ? AND modified=?""", key).fetchone():
                    already.append(e["id"])
                    continue
                self.conn.execute(
                    """INSERT INTO uses(asset_id,project,version,artifact_version,modified,cue,output_time,role,used_at)
                       VALUES(?,?,?,?,?,?,?,?,?)""",
                    (e["id"], project, cut, e["artifact_version"], int(e["modified"]), e["cue"], e["output_time"], e["role"], now()),
                )
                recorded.append({"id": e["id"], "artifact_version": e["artifact_version"], "role": e["role"]})
        return {"ok": True, "project": project, "cut": cut, "recorded": recorded, "already_recorded": already}

    @staticmethod
    def read_declaration(path) -> dict:
        p = Path(path).expanduser()
        if not p.is_file():
            raise LibError(f"missing declaration {p}", hint="write the cut declaration first (records reference, 'Cut declaration')")
        try:
            d = json.loads(p.read_text())
        except ValueError as e:
            raise LibError(f"{p} is not valid JSON: {e}")
        if not isinstance(d, dict) or not d.get("project") or not d.get("cut") or not isinstance(d.get("selected"), list):
            raise LibError(f"{p} needs project, cut and a selected list", hint="an empty selected list is valid")
        return d

    def _scan(self, project_dir: Path, exclude: set[str]) -> dict:
        """Library assets a project names (by ID in text files) or contains (same bytes)."""
        ids = [r[0] for r in self.conn.execute("SELECT id FROM assets") if r[0] not in exclude]
        pattern = re.compile(r"(?<![\w-])(" + "|".join(map(re.escape, sorted(ids, key=len, reverse=True))) + r")(?![\w-])") if ids else None
        sizes: dict[int, list] = {}
        for r in self.conn.execute(f"SELECT id, sha256, bytes FROM assets WHERE bytes IS NOT NULL AND sha256 IS NOT NULL AND kind IN ({','.join('?' * len(MEDIA_KINDS))})", MEDIA_KINDS):
            if r["id"] not in exclude:
                sizes.setdefault(r["bytes"], []).append((r["id"], r["sha256"]))
        found, seen, scanned, truncated = [], set(), 0, False
        for dirpath, dirnames, filenames in os.walk(project_dir):
            here = Path(dirpath)
            dirnames[:] = sorted(d for d in dirnames if d not in SKIP_DIRS and not d.startswith(".") and (here / d).resolve() != self.root)
            for name in sorted(filenames):
                if scanned >= SCAN_MAX_FILES:
                    truncated = True
                    break
                p = here / name
                try:
                    size = p.stat().st_size
                except OSError:
                    continue
                scanned += 1
                rel = os.path.relpath(p, project_dir)
                if p.suffix.lower() in TEXT_SUFFIXES and size <= SCAN_MAX_TEXT_BYTES and pattern:
                    for aid in sorted(set(pattern.findall(p.read_text(errors="ignore")))):
                        if (aid, rel) not in seen:
                            seen.add((aid, rel))
                            found.append({"id": aid, "file": rel, "basis": "id named"})
                elif size in sizes:
                    digest = sha256_file(p)
                    for aid, sha in sizes[size]:
                        if sha == digest and (aid, rel) not in seen:
                            seen.add((aid, rel))
                            found.append({"id": aid, "file": rel, "basis": "same content"})
            if truncated:
                break
        return {"references": found, "scan": {"dir": str(project_dir), "files": scanned, "truncated": truncated}}

    def check_project(self, project: str, cut: str, declared_path=None, project_dir=None) -> dict:
        return self._project_report(project, cut, declared_path, project_dir)[0]

    def _project_report(self, project: str, cut: str, declared_path=None, project_dir=None) -> tuple[dict, list | None]:
        """The project check, plus the resolved declaration it checked (what deliver stores)."""
        failures, warnings = [], []
        declared = None
        if declared_path:
            try:
                d = self.read_declaration(declared_path)
            except LibError as e:
                return {"ok": False, "project": project, "cut": cut, "failures": [e.payload["error"]], "warnings": []}, None
            if (d["project"], d["cut"]) != (project, cut):
                failures.append(f"the declaration is for {d['project']} cut {d['cut']}, not {project} cut {cut}")
            declared, errors = self.resolve_entries(d["selected"], Path(declared_path).expanduser().resolve().parent)
            failures += [f"declared entry {e.get('id')}: {e['error']}" + (f" ({e['hint']})" if e.get("hint") else "") for e in errors]
            if project_dir is None:
                project_dir = Path(declared_path).expanduser().resolve().parent
        else:
            row = self.conn.execute("SELECT declared_json FROM deliveries WHERE project=? AND cut=? ORDER BY id DESC LIMIT 1",
                                    (project, cut)).fetchone()
            if row:
                declared = json.loads(row["declared_json"])
            else:
                failures.append(f"no declaration for {project} cut {cut}: pass --declared FILE")
        uses = [dict(r) for r in self.conn.execute("SELECT * FROM uses WHERE project=? AND version=?", (project, cut))]
        for e in declared or []:
            mine = [u for u in uses if u["asset_id"] == e["id"]]
            if not mine:
                other = sorted({r[0] or "(no cut)" for r in self.conn.execute(
                    "SELECT version FROM uses WHERE asset_id=? AND project=?", (e["id"], project))})
                failures.append(f"{e['id']} is declared but has no use for {project} cut {cut}"
                                + (f"; its uses in cut {', '.join(other)} do not count" if other else "")
                                + "; record it with `used --from DECLARATION`")
            elif not any(u["artifact_version"] == e["artifact_version"] for u in mine):
                got = sorted({self._short(e["id"], u["artifact_version"]) or "no version" for u in mine})
                failures.append(f"{e['id']} is declared at version {self._short(e['id'], e['artifact_version'])} "
                                f"but its uses in this cut record {', '.join(got)}")
        known: dict[str, list[str]] = {}
        for u in uses:
            a = self.conn.execute("SELECT kind, path FROM assets WHERE id=?", (u["asset_id"],)).fetchone()
            if not a:
                failures.append(f"use of unknown asset {u['asset_id']} in this cut")
                continue
            if u["artifact_version"]:
                if u["asset_id"] not in known:
                    known[u["asset_id"]] = self.versions_of(u["asset_id"])
                if u["artifact_version"] not in known[u["asset_id"]]:
                    failures.append(f"use of {u['asset_id']} names unknown version {u['artifact_version'][:SHORT_LEN]}")
                elif a["kind"] in BUNDLE_KINDS:
                    vdir = self.conn.execute("SELECT dir FROM asset_versions WHERE asset_id=? AND version=?",
                                             (u["asset_id"], u["artifact_version"])).fetchone()["dir"]
                    if not self.abspath(vdir).is_dir():
                        failures.append(f"{u['asset_id']} version folder {vdir} is missing")
            else:
                warnings.append(f"legacy use of {u['asset_id']} in this cut has no version (unknown)")
            if a["kind"] in MEDIA_KINDS and not self.abspath(a["path"]).exists():
                failures.append(f"{u['asset_id']} file is missing: {a['path']}")
            if u["role"] not in ROLES:
                warnings.append(f"use of {u['asset_id']} has legacy role {u['role']!r}")
        declared_ids = {e["id"] for e in declared or []}
        for aid in sorted({u["asset_id"] for u in uses} - declared_ids):
            warnings.append(f"{aid} has a use in this cut but is not in the declaration")
        for r in self.conn.execute(
                """SELECT asset_id, version, dir, manifest_json, validation FROM asset_versions v WHERE project=?
                   AND created_at=(SELECT MAX(created_at) FROM asset_versions w WHERE w.asset_id=v.asset_id AND w.project=v.project)""",
                (project,)):
            failures += [f"bundle {r['asset_id']} {Path(r['dir']).name}: {p}" for p in self._bundle_problems(r)]
            if r["validation"] == "failed":
                failures.append(f"bundle {r['asset_id']} {Path(r['dir']).name} registered from {project} failed its validation; register a fixed version")
            elif r["validation"] == "not-run":
                warnings.append(f"bundle {r['asset_id']} {Path(r['dir']).name} is not validated")
        out = {"ok": not failures, "project": project, "cut": cut, "declared": len(declared or []),
               "uses": len(uses), "failures": failures, "warnings": warnings}
        if project_dir:
            scan = self._scan(Path(project_dir).expanduser().resolve(), declared_ids)
            out["unrecorded_references"] = scan["references"]
            out["scan"] = scan["scan"]
        return out, declared

    def _bundle_problems(self, row) -> list[str]:
        manifest = json.loads(row["manifest_json"])
        content = manifest.get("content") or {}
        kind = manifest.get("kind")
        need = ["entry", "files", "preview"] + (["example"] if kind in ("code", "character") else [])
        problems = [f"missing {k}" for k in need if not content.get(k)]
        planned = self.conn.execute("SELECT planned_use FROM provenance WHERE asset_id=?", (row["asset_id"],)).fetchone()
        if not planned or not planned["planned_use"]:
            problems.append("missing planned_use")
        vdir = self.abspath(row["dir"])
        if not vdir.is_dir():
            problems.append(f"folder {row['dir']} is missing")
        else:
            bad = self._verify_dir(vdir)
            if bad:
                problems.append(f"files differ from the manifest: {', '.join(bad[:5])}")
        return problems

    def deliver(self, project: str, cut: str, declared_path, registered=(), none_reason: str | None = None,
                project_dir=None) -> dict:
        if bool(registered) == bool(none_reason):
            raise LibError("give --registered ID@VERSION ... or --none REASON",
                           hint="list the versions registered from this project since its last delivery, or say why nothing qualified")
        if not declared_path:
            raise LibError("deliver needs --declared FILE")
        report, declared = self._project_report(project, cut, declared_path, project_dir)
        reg = []
        for ref in registered or ():
            aid, _, ver = ref.partition("@")
            try:
                if not ver:
                    raise LibError(f"{ref} is not ID@VERSION")
                if self._asset(aid)["kind"] not in BUNDLE_KINDS:
                    raise LibError(f"{aid} is not a bundle; only registered bundle versions go in --registered")
                full = self.resolve_version(aid, ver)
            except LibError as e:
                report["failures"].append(f"--registered {ref}: {e.payload['error']}")
                continue
            if self.conn.execute("SELECT validation FROM asset_versions WHERE asset_id=? AND version=?", (aid, full)).fetchone()[0] == "failed":
                report["failures"].append(f"--registered {ref} failed its validation")
            reg.append({"id": aid, "artifact_version": full})
        last = self.conn.execute("SELECT MAX(delivered_at) FROM deliveries WHERE project=?", (project,)).fetchone()[0]
        pending = {(r[0], r[1]) for r in self.conn.execute(
            "SELECT asset_id, version FROM asset_versions WHERE project=? AND created_at>? AND validation!='failed'",
            (project, last or ""))}
        unlisted = sorted(pending - {(r["id"], r["artifact_version"]) for r in reg})
        if unlisted:
            report["failures"].append("registered from this project since its last delivery but not listed: "
                                      + ", ".join(f"{a}@{self._short(a, v)}" for a, v in unlisted)
                                      + "; add them to --registered")
        report["ok"] = not report["failures"]
        if not report["ok"]:
            return {**report, "delivered": False, "catalog": "incomplete",
                    "hint": "nothing was recorded; fix the failures and deliver again. The video itself can still ship."}
        with self.tx():
            self.conn.execute(
                "INSERT INTO deliveries(project,cut,delivered_at,declared_json,registered_json,declined_reason) VALUES(?,?,?,?,?,?)",
                (project, cut, now(), json.dumps(declared, ensure_ascii=False), json.dumps(reg), none_reason))
        return {**report, "delivered": True, "catalog": "delivered", "registered": reg, "declined_reason": none_reason}

    # -- notes, archive, import ----------------------------------------------------------------

    def note(self, asset_id: str, kind: str, text: str, source: str | None = None, artifact_version: str | None = None) -> dict:
        self._asset(asset_id)
        if kind not in NOTE_KINDS:
            raise LibError(f"note kind must be one of {', '.join(NOTE_KINDS)}")
        if not (text or "").strip():
            raise LibError("a note needs --text")
        if kind == "opinion" and not source:
            raise LibError("an opinion needs --source", hint="where and when the user said it; quote their words in --text")
        version = self.resolve_version(asset_id, artifact_version) if artifact_version else None
        with self.tx():
            self.conn.execute("INSERT INTO notes(asset_id,artifact_version,kind,text,source,created_at) VALUES(?,?,?,?,?,?)",
                              (asset_id, version, kind, text.strip(), source, now()))
            self.index_fts(asset_id)
        return {"ok": True, "asset": self.asset_row(asset_id, include_uses=False)}

    def archive(self, asset_id: str) -> dict:
        self._asset(asset_id)
        with self.tx():
            self.conn.execute("UPDATE assets SET archived=1, updated_at=? WHERE id=?", (now(), asset_id))
        return {"ok": True, "archived": asset_id}

    def _catalog_record(self, raw: dict) -> dict:
        """The fields a catalog entry states, normalised to columns. Absent fields stay absent."""
        rec = {k: v for k, v in raw.items() if k in CATALOG_KEYS}
        if "duration" in rec:
            dur = rec.pop("duration")
            if "duration_seconds" not in rec:
                try:
                    rec["duration_seconds"] = float(dur) if dur is not None else None
                except (TypeError, ValueError):
                    pass
        if "thumbnail_path" in rec:
            rec.setdefault("thumbnail", rec.pop("thumbnail_path"))
            rec.pop("thumbnail_path", None)
        for key in ("path", "thumbnail"):
            if rec.get(key):
                rec[key] = self.rel(rec[key])
        if "archived" in rec:
            rec["archived"] = 1 if rec["archived"] else 0
        if "tags" in rec:
            rec["tags"] = split_tags(rec["tags"])
        extra = {k: v for k, v in raw.items() if k not in CATALOG_KEYS}
        if extra:
            rec["extra_json"] = json.dumps(extra, ensure_ascii=False)
        return rec

    def _differences(self, current: dict, rec: dict) -> dict:
        diff = {}
        for k, v in rec.items():
            if k in ("id", "category", "updated_at"):
                continue
            if k == "tags":
                have = sorted(t["tag"] for t in current["tags"])
                if have != sorted(v):
                    diff[k] = [have, sorted(v)]
            elif k == "extra_json":
                have = current.get("extra")
                if have != json.loads(v):
                    diff["extra"] = [have, json.loads(v)]
            elif k == "thumbnail" and current.get(k) and self.abspath(current[k]).exists():
                continue  # previews are derived; an existing one is not a difference worth reporting
            elif k == "path" and current.get(k) and v:
                if self.abspath(current[k]).resolve() != self.abspath(v).resolve():
                    diff[k] = [current[k], v]
            elif current.get(k) != v and not (current.get(k) in (None, "") and v in (None, "")):
                diff[k] = [current.get(k), v]
        return diff

    def _apply_update(self, asset_id: str, rec: dict) -> None:
        if rec.get("path") and "sha256" not in rec and self.abspath(rec["path"]).is_file():
            rec["sha256"] = sha256_file(self.abspath(rec["path"]))
            rec["bytes"] = self.abspath(rec["path"]).stat().st_size
        if "kind" in rec:
            rec["category"] = category_for(rec["kind"])
        cols = [c for c in ASSET_COLS if c in rec and c != "updated_at"]
        self.conn.execute(f"UPDATE assets SET {''.join(f'{c}=?, ' for c in cols)}updated_at=? WHERE id=?",
                          (*(rec[c] for c in cols), now(), asset_id))
        pcols = [c for c in PROV_COLS if c in rec]
        if pcols:
            self.conn.execute("INSERT OR IGNORE INTO provenance(asset_id) VALUES(?)", (asset_id,))
            self.conn.execute(f"UPDATE provenance SET {', '.join(f'{c}=?' for c in pcols)} WHERE asset_id=?",
                              (*(rec[c] for c in pcols), asset_id))
        if "tags" in rec:
            self._set_tags(asset_id, rec["tags"])
        if rec.get("work_id"):
            self.conn.execute(
                "INSERT INTO variants(asset_id,work_id,role) VALUES(?,?,?) ON CONFLICT(asset_id) DO UPDATE SET work_id=excluded.work_id, role=excluded.role",
                (asset_id, rec["work_id"], rec.get("variant_role")))
        self.index_fts(asset_id)

    def import_catalog(self, path, update=()) -> dict:
        """Add a catalog file's new IDs; report differences for known IDs; change only --update IDs."""
        p = Path(path).expanduser()
        if not p.is_file():
            raise LibError(f"missing catalog {p}")
        try:
            data = json.loads(p.read_text())
        except ValueError as e:
            raise LibError(f"{p} is not valid JSON: {e}")
        entries = data.get("assets") if isinstance(data, dict) else data
        if not isinstance(entries, list):
            raise LibError(f"{p} must be a list of entries, or an object with an assets list")
        update = set(update or ())
        out = {"ok": True, "catalog": str(p), "read": len(entries), "added": [], "duplicates": [], "updated": [],
               "differs": {}, "missing_files": [], "invalid": []}
        with self.tx():
            for i, raw in enumerate(entries):
                if not isinstance(raw, dict) or not all(isinstance(raw.get(k), str) and raw[k] for k in ("id", "kind", "title", "path")):
                    out["invalid"].append({"entry": i, "error": "needs id, kind, title and path (strings)"})
                    continue
                if raw.get("tags") is not None and not isinstance(raw["tags"], (str, list)):
                    out["invalid"].append({"entry": i, "id": raw["id"], "error": "tags must be a list or a comma-separated string"})
                    continue
                current = self.asset_row(raw["id"], include_uses=False)
                if current is None and not ID_RE.fullmatch(raw["id"]):
                    out["invalid"].append({"entry": i, "id": raw["id"], "error": "bad id: lowercase letters, digits and - . _"})
                    continue
                if current is None and raw["kind"] not in (*MEDIA_KINDS, *BUNDLE_KINDS):
                    out["invalid"].append({"entry": i, "id": raw["id"],
                                           "error": f"kind {raw['kind']!r} is not one of {', '.join((*MEDIA_KINDS, *BUNDLE_KINDS))}"})
                    continue
                rec = self._catalog_record(raw)
                if current is None:
                    f = self.abspath(rec["path"])
                    if not f.exists():
                        out["missing_files"].append(raw["id"])
                        continue
                    if f.is_file():
                        rec.setdefault("sha256", sha256_file(f))
                        rec.setdefault("bytes", f.stat().st_size)
                    if not rec.get("thumbnail"):
                        for cand in (f"thumbnails/{raw['id']}.jpg", f"previews/{raw['id']}.jpg"):
                            if (self.root / cand).exists():
                                rec["thumbnail"] = cand
                                break
                    dup = self.conn.execute("SELECT id FROM assets WHERE sha256=? AND canonical_id IS NULL ORDER BY id LIMIT 1",
                                            (rec.get("sha256"),)).fetchone() if rec.get("sha256") else None
                    if dup and not rec.get("canonical_id"):
                        rec["canonical_id"] = dup["id"]
                        out["duplicates"].append({"id": raw["id"], "duplicate_of": dup["id"]})
                    self._insert_asset(rec)
                    out["added"].append(raw["id"])
                else:
                    diff = self._differences(current, rec)
                    if diff and raw["id"] in update:
                        self._apply_update(raw["id"], rec)
                        out["updated"].append(raw["id"])
                    elif diff:
                        out["differs"][raw["id"]] = diff
        missing_update = sorted(update - {e.get("id") for e in entries if isinstance(e, dict)})
        if missing_update:
            out["warnings"] = [f"--update {i} is not in the catalog" for i in missing_update]
        return out

    # -- reports -------------------------------------------------------------------------------

    def check_library(self) -> dict:
        failures, warnings = [], []
        missing_archived, resized = 0, []
        for a in self.conn.execute("SELECT id, kind, path, bytes, archived, canonical_id FROM assets ORDER BY id"):
            f = self.abspath(a["path"])
            if not f.exists():
                if a["archived"] or a["canonical_id"]:
                    missing_archived += 1
                else:
                    failures.append(f"missing file for {a['id']}: {a['path']}")
            elif a["kind"] in MEDIA_KINDS and a["bytes"] is not None and f.is_file() and f.stat().st_size != a["bytes"]:
                resized.append(a["id"])
        if missing_archived:
            warnings.append(f"{missing_archived} archived or duplicate assets have no file")
        if resized:
            warnings.append(f"{len(resized)} media file(s) differ in size from their record, so not the recorded version "
                            f"(replaced in place?): {resized[:10]}")
        ids = {r[0] for r in self.conn.execute("SELECT id FROM assets")}
        known: dict[str, list[str]] = {}
        unknown, bad_version = {}, {}
        for u in self.conn.execute("SELECT asset_id, artifact_version FROM uses"):
            if u["asset_id"] not in ids:
                unknown[u["asset_id"]] = unknown.get(u["asset_id"], 0) + 1
            elif u["artifact_version"]:
                if u["asset_id"] not in known:
                    known[u["asset_id"]] = self.versions_of(u["asset_id"])
                if u["artifact_version"] in known[u["asset_id"]]:
                    continue
                bad_version[u["asset_id"]] = bad_version.get(u["asset_id"], 0) + 1
        failures += [f"{n} use(s) of unknown asset {i}" for i, n in sorted(unknown.items())]
        failures += [f"{n} use(s) of {i} name an unknown version" for i, n in sorted(bad_version.items())]
        legacy_roles = {(r[0] if r[0] is not None else "(none)"): r[1] for r in self.conn.execute(
            f"SELECT role, COUNT(*) FROM uses WHERE role IS NULL OR role NOT IN ({','.join('?' * len(ROLES))}) GROUP BY role", ROLES)}
        unversioned = self.conn.execute("SELECT COUNT(*) FROM uses WHERE artifact_version IS NULL").fetchone()[0]
        if legacy_roles:
            warnings.append(f"uses with legacy roles (kept as written): {legacy_roles}")
        if unversioned:
            warnings.append(f"{unversioned} legacy uses have no artifact version (unknown)")
        rows = list(self.conn.execute("SELECT asset_id, version, dir, manifest_json, validation FROM asset_versions"))
        recorded = {(r["asset_id"], Path(r["dir"]).name) for r in rows}
        for r in rows:
            vdir = self.abspath(r["dir"])
            if not vdir.is_dir():
                failures.append(f"bundle {r['asset_id']} {Path(r['dir']).name}: folder {r['dir']} is missing")
            elif self._dir_version(vdir) != r["version"]:
                failures.append(f"bundle {r['asset_id']} {Path(r['dir']).name}: bundle.json does not match the recorded version")
            else:
                bad = self._verify_dir(vdir)
                if bad:
                    failures.append(f"bundle {r['asset_id']} {Path(r['dir']).name}: files differ from the manifest: {', '.join(bad[:5])}")
        not_validated = sum(1 for r in rows if r["validation"] != "passed")
        if not_validated:
            warnings.append(f"{not_validated} bundle version(s) not validated or failed; see `show ID`")
        bundles = self.root / "bundles"
        orphans = []
        if bundles.is_dir():
            for id_dir in sorted(bundles.iterdir()):
                if id_dir.name == ".staging" or not id_dir.is_dir():
                    continue
                orphans += [self.rel(v) for v in sorted(id_dir.iterdir()) if v.is_dir() and (id_dir.name, v.name) not in recorded]
            staging = sorted((bundles / ".staging").glob("*")) if (bundles / ".staging").is_dir() else []
            if staging:
                warnings.append(f"staging folders left by an interrupted or running register: {[self.rel(s) for s in staging]}")
        if orphans:
            warnings.append(f"published bundle folders with no record (never served; `register` the same content to adopt): {orphans}")
        counts = {k: self.conn.execute(f"SELECT COUNT(*) FROM {k}").fetchone()[0]
                  for k in ("assets", "uses", "asset_versions", "notes", "deliveries")}
        return {"ok": not failures, "root": str(self.root), "schema_version": SCHEMA_VERSION, "counts": counts,
                "orphans": orphans, "failures": failures, "warnings": warnings,
                **({"backup": self.backup} if self.backup else {})}

    def stats(self) -> dict:
        q = lambda sql, *a: self.conn.execute(sql, a).fetchone()[0]  # noqa: E731
        kinds = {r["kind"]: r["n"] for r in self.conn.execute(
            "SELECT kind, COUNT(*) n FROM assets WHERE archived=0 AND canonical_id IS NULL GROUP BY kind")}
        reused = [dict(r) for r in self.conn.execute(
            """SELECT asset_id AS id, COUNT(DISTINCT project) AS projects FROM uses GROUP BY asset_id
               HAVING COUNT(DISTINCT project)>=2 ORDER BY projects DESC, id""")]
        return {
            "ok": True, "db": str(self.db_path), "schema_version": SCHEMA_VERSION, "active": sum(kinds.values()),
            "archived": q("SELECT COUNT(*) FROM assets WHERE archived=1"),
            "duplicates": q("SELECT COUNT(*) FROM assets WHERE canonical_id IS NOT NULL"), "kinds": kinds,
            "uses": q("SELECT COUNT(*) FROM uses"),
            "projects": [r[0] for r in self.conn.execute("SELECT DISTINCT project FROM uses ORDER BY project")],
            "reused": len(reused), "most_reused": reused[:20], "versions": q("SELECT COUNT(*) FROM asset_versions"),
            "notes": q("SELECT COUNT(*) FROM notes"), "deliveries": q("SELECT COUNT(*) FROM deliveries"),
        }

    def export(self) -> dict:
        """exports/library.json: every row of every table (derived search indexes excepted);
        exports/index.html: a browsable list of every asset."""
        master = list(self.conn.execute("SELECT name, sql FROM sqlite_master WHERE type='table' ORDER BY name"))
        virtual = [r["name"] for r in master if (r["sql"] or "").upper().startswith("CREATE VIRTUAL TABLE")]
        tables = {}
        for r in master:
            name = r["name"]
            if name.startswith("sqlite_") or name in virtual or any(name.startswith(v + "_") for v in virtual):
                continue
            pk = [c[1] for c in sorted(self.conn.execute(f'PRAGMA table_info("{name}")'), key=lambda c: c[5]) if c[5]]
            order = ", ".join(f'"{c}"' for c in pk) if pk else "rowid"
            tables[name] = [dict(x) for x in self.conn.execute(f'SELECT * FROM "{name}" ORDER BY {order}')]
        out_dir = self.root / "exports"
        out_dir.mkdir(exist_ok=True)
        payload = {"schema_version": SCHEMA_VERSION, "exported_at": now(), "tables": tables}
        blob = lambda b: {"base64": base64.b64encode(b).decode()}  # noqa: E731  (BLOBs in adapter tables)
        write_atomic(out_dir / "library.json", json.dumps(payload, ensure_ascii=False, indent=1, default=blob) + "\n")
        assets = [self.asset_row(a["id"]) for a in tables.get("assets", [])]
        write_atomic(out_dir / "index.html", browse_html(assets, self.root, out_dir))
        return {"ok": True, "json": self.rel(out_dir / "library.json"), "html": self.rel(out_dir / "index.html"),
                "rows": {k: len(v) for k, v in tables.items()}}


def write_atomic(path: Path, text: str) -> None:
    part = path.with_name(f".{path.name}.{secrets.token_hex(4)}.part")
    part.write_text(text)
    os.replace(part, path)


def browse_html(assets: list[dict], root: Path, out_dir: Path) -> str:
    def href(stored):
        if not stored:
            return None
        p = Path(stored)
        return p.as_uri() if p.is_absolute() else os.path.relpath(root / p, out_dir)

    slim = [{
        "id": a["id"], "kind": a["kind"], "title": a["title"], "path": href(a["path"]), "thumb": href(a.get("thumbnail")),
        "dur": a.get("duration_seconds"), "tags": [t["tag"] for t in a["tags"]], "rights": a.get("rights_status"),
        "use": a.get("planned_use"), "source": a.get("source_url"), "archived": bool(a["archived"]), "dup": a.get("canonical_id"),
        "versions": [v["short"] + (f" · {v['validation']}" if v.get("validation") else "") for v in a["versions"]],
        "uses": [f"{u['project']} / {u['version'] or '?'}" + (f" @ {(u['artifact_version'] or '')[:SHORT_LEN]}" if u["artifact_version"] else "") for u in a["uses"]],
        "notes": [f"{n['kind']}: {n['text']}" + (f" ({n['source']})" if n["source"] else "") for n in a["notes"]],
    } for a in assets]
    return BROWSE_HTML.replace("__DATA__", json.dumps(slim, ensure_ascii=False).replace("<", "\\u003c"))


BROWSE_HTML = r"""<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Asset library</title>
<style>
:root{--bg:#121212;--panel:#1c1c1c;--sel:#262626;--line:#2c2c2c;--text:#e0e0e0;--muted:#9b9b9b;--accent:#9fbccc;
--ui:"Avenir Next","Segoe UI Variable","Helvetica Neue",Helvetica,sans-serif;--mono:"SF Mono",Menlo,Consolas,monospace}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 var(--ui)}
header{display:flex;gap:16px;align-items:center;padding:16px 24px;border-bottom:1px solid var(--line)}
h1{font-size:18px;font-weight:600;margin:0 auto 0 0}input,select{font:inherit;color:var(--text);background:var(--panel);border:1px solid var(--line);border-radius:4px;padding:6px 8px}
#count{color:var(--muted);font-size:12px}main{display:grid;grid-template-columns:minmax(280px,38%) 1fr;height:calc(100vh - 66px)}
#list{overflow:auto;border-right:1px solid var(--line)}#detail{overflow:auto;padding:24px 32px}
.row{display:grid;grid-template-columns:1fr auto;gap:8px;width:100%;padding:8px 24px;border:0;border-bottom:1px solid var(--line);background:none;color:inherit;font:inherit;text-align:left;cursor:pointer}
.row:hover,.row[aria-selected=true]{background:var(--sel)}.id{font:12px var(--mono);color:var(--muted)}.k{font-size:12px;color:var(--muted)}
h2{font-size:24px;font-weight:600;margin:4px 0 12px}.media img,.media video{max-width:100%;max-height:360px;border-radius:4px}.media audio{width:100%}
dl{display:grid;grid-template-columns:120px 1fr;gap:6px 16px}dt{color:var(--muted);font-size:12px}dd{margin:0}
</style>
<header><h1>Asset library</h1><input id="q" type="search" placeholder="Search"><select id="kind"><option value="">All kinds</option></select><label class="k"><input id="arch" type="checkbox"> archived</label><span id="count"></span></header>
<main><nav id="list"></nav><article id="detail"></article></main>
<script>
const A=__DATA__,$=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let sel=null;[...new Set(A.map(a=>a.kind))].sort().forEach(k=>$('#kind').insertAdjacentHTML('beforeend',`<option>${esc(k)}</option>`));
const rows=()=>{const q=$('#q').value.toLowerCase(),k=$('#kind').value,ar=$('#arch').checked;return A.filter(a=>(ar||(!a.archived&&!a.dup))&&(!k||a.kind===k)&&(!q||[a.id,a.title,a.tags.join(' '),a.use,a.notes.join(' ')].join(' ').toLowerCase().includes(q)))};
function list(){const r=rows();$('#count').textContent=`${r.length} of ${A.length}`;$('#list').innerHTML=r.map(a=>`<button class="row" data-id="${esc(a.id)}" aria-selected="${a.id===sel}"><span>${esc(a.title)}<br><span class="id">${esc(a.id)}</span></span><span class="k">${esc(a.kind)}${a.dur!=null?' · '+a.dur.toFixed(2)+' s':''}</span></button>`).join('')}
function show(id){const a=A.find(x=>x.id===id);if(!a)return;sel=id;list();const m=a.kind==='video'?`<video controls preload="metadata" poster="${esc(a.thumb||'')}" src="${esc(a.path)}"></video>`:['sfx','music'].includes(a.kind)?`<audio controls preload="metadata" src="${esc(a.path)}"></audio>`:a.thumb?`<img src="${esc(a.thumb)}" alt="">`:'';
const dd=(k,v)=>v&&v.length?`<dt>${k}</dt><dd>${Array.isArray(v)?v.map(esc).join('<br>'):esc(v)}</dd>`:'';
$('#detail').innerHTML=`<div class="media">${m}</div><div class="id">${esc(a.id)}</div><h2>${esc(a.title)}</h2><dl>${dd('Kind',a.kind)}${dd('Use',a.use)}${dd('Tags',a.tags.join(', '))}${dd('Rights',a.rights)}${dd('Versions',a.versions)}${dd('Used in',a.uses)}${dd('Notes',a.notes)}${dd('Duplicate of',a.dup)}${dd('Source',a.source)}${dd('File',a.path)}</dl>`}
$('#list').addEventListener('click',e=>{const b=e.target.closest('.row');if(b)show(b.dataset.id)});['q','kind','arch'].forEach(i=>$('#'+i).addEventListener('input',list));list();const f=rows()[0];if(f)show(f.id);
</script></html>
"""

# -- CLI ---------------------------------------------------------------------------------------

EPILOG = """workflow:
  init ROOT                      create a library (once)
  search / show                  before sourcing or building anything
  ingest FILE                    bring in a sourced or recorded media file
  register --kind code|...       snapshot a bundle version another project is about to reuse
  used --from DECLARATION.json   record the uses a cut declares
  deliver --project --cut ...    run the project check, then record the delivery decision
root: --root, else ASSET_LIBRARY_ROOT, else a 'Root: `PATH`' line in ~/.asset-library/profile.md"""


def emit(obj) -> None:
    json.dump(obj, sys.stdout, ensure_ascii=False, indent=2, default=str)
    sys.stdout.write("\n")


def _search(lib, a):
    rows = lib.search(" ".join(a.query), kind=a.kind, tag=a.tag, max_duration=a.max_duration, min_duration=a.min_duration,
                      rights=a.rights, unused_in=a.unused_in, archived=a.archived, limit=a.limit)
    if a.text:
        for r in rows:
            dur = f" {r['duration_seconds']:.2f}s" if r.get("duration_seconds") else ""
            print(f"{r['id']}\t{r['kind']}{dur}\t{r['title']}\t{','.join(t['tag'] for t in r['tags'])}")
        return 0
    return {"query": " ".join(a.query), "count": len(rows), "assets": rows}


def _show(lib, a):
    row = lib.asset_row(a.id)
    if not row:
        raise LibError(f"unknown id {a.id}", hint="find it with `search`")
    return row


def _ingest(lib, a):
    prov = {k: getattr(a, k) for k in ("source_url", "download_url", "creator", "license", "license_url", "rights_status",
                                         "planned_use", "spoken_cue", "source_in", "source_out") if getattr(a, k) is not None}
    return lib.ingest(a.file, a.kind, title=a.title, asset_id=a.id, tags=split_tags(a.tags), work_id=a.work_id,
                      variant_role=a.variant_role, **prov)


def _register(lib, a):
    dims = None
    if a.dimensions:
        try:
            dims = json.loads(a.dimensions)
        except ValueError as e:
            raise LibError(f"--dimensions is not JSON: {e}")
    validate = {"command": a.validate_command, "setup": a.validate_setup, "cwd": a.validate_cwd,
                "env": a.validate_env or [], "timeout_s": a.validate_timeout} if a.validate_command else None
    if a.no_validate and validate:
        raise LibError("give --validate-command or --no-validate, not both")
    return lib.register(a.kind, a.id, a.entry, a.files, source=a.source, title=a.title, example=a.example, preview=a.preview,
                        planned_use=a.planned_use, tags=split_tags(a.tags), dependencies=a.dependency or (), dimensions=dims,
                        validate=validate, no_validate=a.no_validate, project=a.project, origin=a.origin,
                        creator=a.creator, rights_status=a.rights_status)


def _used(lib, a):
    if a.from_file:
        if a.id or a.artifact_version or a.file:
            raise LibError("give either ID with its flags, or --from DECLARATION, not both")
        d = lib.read_declaration(a.from_file)
        for flag, value in (("project", a.project), ("cut", a.cut)):
            if value and value != d[flag]:
                raise LibError(f"--{flag} {value} differs from the declaration's {d[flag]}")
        return lib.record_uses(d["project"], d["cut"], d["selected"], Path(a.from_file).expanduser().resolve().parent)
    if not a.id:
        raise LibError("give an asset ID, or --from DECLARATION")
    entry = {"id": a.id, "role": a.role, "artifact_version": a.artifact_version, "file": a.file,
             "cue": a.cue, "output_time": a.output_time, "modified": a.modified}
    out = lib.record_uses(a.project, a.cut, [entry], Path.cwd())
    return {**out, "asset": lib.asset_row(a.id)}


def _check(lib, a):
    if a.project or a.cut:
        if not (a.project and a.cut):
            raise LibError("a project check needs both --project and --cut")
        return lib.check_project(a.project, a.cut, a.declared, a.project_dir)
    if a.declared:
        raise LibError("--declared needs --project and --cut")
    return lib.check_library()


COMMANDS = {
    "init": lambda lib, a: {"ok": True, "root": str(lib.root), "db": str(lib.db_path), "schema_version": SCHEMA_VERSION,
                            **({"backup": lib.backup} if lib.backup else {})},
    "search": _search,
    "show": _show,
    "ingest": _ingest,
    "register": _register,
    "used": _used,
    "note": lambda lib, a: lib.note(a.id, a.kind, a.text, a.source, a.artifact_version),
    "archive": lambda lib, a: lib.archive(a.id),
    "deliver": lambda lib, a: lib.deliver(a.project, a.cut, a.declared, a.registered, a.none, a.project_dir),
    "check": _check,
    "import": lambda lib, a: lib.import_catalog(a.catalog, a.update or ()),
    "stats": lambda lib, a: lib.stats(),
    "export": lambda lib, a: lib.export(),
}


def build_parser() -> tuple[argparse.ArgumentParser, argparse._SubParsersAction, dict]:
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--root", default=argparse.SUPPRESS, help="library root folder")
    parser = argparse.ArgumentParser(prog="library.py", parents=[common], epilog=EPILOG,
                                     description="Persistent library of reusable video-production assets. JSON on stdout.",
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True, metavar="COMMAND")
    parsers = {}

    def add(name, text, example=None):
        p = sub.add_parser(name, help=text, description=text, parents=[common],
                           epilog=f"example:\n  {example}" if example else None,
                           formatter_class=argparse.RawDescriptionHelpFormatter)
        parsers[name] = p
        return p

    p = add("init", "Create an empty library at ROOT (or open and migrate an existing one).", "library.py init ~/video-library")
    p.add_argument("path", metavar="ROOT")

    p = add("search", "Full-text search plus filters; hides archived assets and exact duplicates.",
            'library.py search "keyboard typing" --kind sfx --max-duration 0.5 --unused-in my-project')
    p.add_argument("query", nargs="*")
    p.add_argument("--kind", choices=["visual", *MEDIA_KINDS, *BUNDLE_KINDS])
    p.add_argument("--tag")
    p.add_argument("--max-duration", type=float)
    p.add_argument("--min-duration", type=float)
    p.add_argument("--rights", choices=["verified", "unknown", "any"], default="any")
    p.add_argument("--unused-in", metavar="PROJECT", help="exclude assets with any use in PROJECT")
    p.add_argument("--archived", action="store_true", help="include archived assets and duplicates")
    p.add_argument("--limit", type=int, default=20)
    p.add_argument("--text", action="store_true", help="tab-separated rows for a human")

    p = add("show", "One asset: provenance, versions, notes and uses.", "library.py show sfx-07")
    p.add_argument("id")

    p = add("ingest", "Add a media file: hash, probe, preview, copy into the root. An exact duplicate returns the existing ID.",
            'library.py ingest ~/Downloads/click.wav --kind sfx --title "Soft click" --source-url URL --creator NAME --rights-status unknown --tags click,ui')
    p.add_argument("file")
    p.add_argument("--kind", required=True, choices=MEDIA_KINDS)
    p.add_argument("--title")
    p.add_argument("--id", help="default: KIND-<title slug>")
    p.add_argument("--tags", default="", help="comma-separated")
    for flag in ("source-url", "download-url", "creator", "license", "license-url", "planned-use", "spoken-cue"):
        p.add_argument(f"--{flag}")
    p.add_argument("--rights-status", default="unknown", help="verified, own work, unknown, ... (default unknown)")
    p.add_argument("--source-in", type=float, help="seconds into the source it was cut from")
    p.add_argument("--source-out", type=float)
    p.add_argument("--work-id", help="group variants of one original")
    p.add_argument("--variant-role", help="original, extended, ducked-bed, crop, ...")

    p = add("register", "Snapshot a character, code or model bundle as an immutable version, then validate it in a clean copy.",
            "library.py register --kind code --id street-kit --title \"Street kit\" --project my-film \\\n"
            "    --entry src/kit/street.tsx --files 'src/kit/street*.ts*' public/street/ package-lock.json \\\n"
            "    --example src/kit/street-demo.tsx --preview out/street.jpg \\\n"
            "    --validate-setup \"npm ci\" --validate-command \"npx remotion still src/index.ts StreetDemo out/check.jpg\" \\\n"
            "    --planned-use \"a dusk street; parameters: lamp count, wetness\"")
    p.add_argument("--kind", required=True, choices=BUNDLE_KINDS)
    p.add_argument("--id", required=True)
    p.add_argument("--title", help="required for a new asset")
    p.add_argument("--entry", required=True, help="main file, relative to --source")
    p.add_argument("--files", nargs="+", required=True, help="files, folders or quoted globs, relative to --source")
    p.add_argument("--source", default=".", help="the folder paths are relative to (default: current folder)")
    p.add_argument("--example", help="file showing it in use (required for code and character)")
    p.add_argument("--preview", help="preview image in the bundle (required)")
    p.add_argument("--planned-use", help="what it draws or does, and its parameters (required for a new asset)")
    p.add_argument("--tags", default="")
    p.add_argument("--dependency", action="append", metavar="SPEC", help="repeatable: npm:three@0.170.0, py:numpy==2.1, tool:ffmpeg, tool:blender@5")
    p.add_argument("--dimensions", metavar="JSON", help='physical size, e.g. {"x": 4.5, "y": 1.6, "z": 2.0, "up": "y"} (metres)')
    p.add_argument("--validate-command", help="shell command that exits 0 when the snapshot works")
    p.add_argument("--validate-setup", help="shell command run first in the copy, e.g. npm ci")
    p.add_argument("--validate-cwd", default=".", help="folder inside the snapshot to run in")
    p.add_argument("--validate-env", action="append", metavar="NAME", help="environment variable to pass through (repeatable)")
    p.add_argument("--validate-timeout", type=int, default=600, help="seconds per step (default 600)")
    p.add_argument("--no-validate", metavar="REASON", help="record without validation (code and character need a reason)")
    p.add_argument("--project", help="the project registering it (its delivery accounts for it)")
    p.add_argument("--origin", help="override the recorded origin, e.g. a published skill and commit")
    p.add_argument("--creator")
    p.add_argument("--rights-status", help="default: own work")

    p = add("used", "Record that a project's cut used a pinned version of an asset, or every entry of a cut declaration.",
            "library.py used --from library-v3.json\n  library.py used sfx-07 --project my-film --cut v3 --role sfx --file audio/sfx-07.flac --cue keyboard")
    p.add_argument("id", nargs="?")
    p.add_argument("--from", dest="from_file", metavar="DECLARATION", help="record every selected entry, all or nothing")
    p.add_argument("--project")
    p.add_argument("--cut", "--version", dest="cut", help="the project's cut (v3, final); --version is the old name")
    p.add_argument("--role", choices=ROLES)
    p.add_argument("--artifact-version", help="the asset version placed (prefix of at least 4 hex)")
    p.add_argument("--file", help="media only: the exact file placed; hashed and matched")
    p.add_argument("--modified", action="store_true", help="the project changed the bundle after copying it")
    p.add_argument("--cue")
    p.add_argument("--output-time", type=float, help="seconds into the cut's output")

    p = add("note", "Append a dated opinion, test, rights or caveat note.",
            'library.py note sfx-07 --kind opinion --text "too sharp" --source "review call, 2026-01-05"')
    p.add_argument("id")
    p.add_argument("--kind", required=True, choices=NOTE_KINDS)
    p.add_argument("--text", required=True)
    p.add_argument("--source", help="where it was said or found (required for opinion)")
    p.add_argument("--artifact-version")

    p = add("archive", "Hide an asset from search; keep its row and uses.", "library.py archive sfx-07")
    p.add_argument("id")

    p = add("deliver", "Run the project check; when it passes, record the cut's delivery decision.",
            "library.py deliver --project my-film --cut v3 --declared library-v3.json --registered street-kit@3f9a1c0b7d22\n"
            '  library.py deliver --project my-film --cut v3 --declared library-v3.json --none "only one-off shots"')
    p.add_argument("--project", required=True)
    p.add_argument("--cut", required=True)
    p.add_argument("--declared", required=True, metavar="FILE")
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--registered", nargs="+", metavar="ID@VERSION", help="versions registered from this project since its last delivery")
    g.add_argument("--none", metavar="REASON", help="why nothing from this project is reusable")
    p.add_argument("--project-dir", help="folder to scan for unrecorded references (default: the declaration's folder)")

    p = add("check", "Library check; with --project and --cut, the project check against a cut declaration.",
            "library.py check\n  library.py check --project my-film --cut v3 --declared library-v3.json")
    p.add_argument("--project")
    p.add_argument("--cut")
    p.add_argument("--declared", metavar="FILE", help="default: the declaration stored at delivery")
    p.add_argument("--project-dir", help="folder to scan for unrecorded references (default: the declaration's folder)")

    p = add("import", "Add a JSON catalog's new IDs; report differing fields; change existing rows only with --update.",
            "library.py import old/catalog.json --update sfx-07")
    p.add_argument("catalog")
    p.add_argument("--update", nargs="+", metavar="ID", help="apply the catalog's stated fields to these existing IDs")

    add("stats", "Counts by kind, uses, reuse, versions, notes, deliveries.")
    add("export", "Write exports/library.json (every record) and exports/index.html (browser).")
    return parser, sub, parsers


def main(argv=None, root=None, extend=None) -> int:
    """The CLI. `root` sets the default root; `extend(subparsers, parsers)` returns extra or
    replacement handlers {name: fn(lib, args) -> dict | int}."""
    parser, sub, parsers = build_parser()
    handlers = dict(COMMANDS)
    if extend:
        handlers.update(extend(sub, parsers))
    args = parser.parse_args(argv)
    lib = None
    try:
        if args.cmd == "init":
            lib = Library(args.path, create=True)
        else:
            lib = Library(resolve_root(getattr(args, "root", None) or root))
        result = handlers[args.cmd](lib, args)
    except LibError as e:
        emit(e.payload)
        return 1
    except (sqlite3.Error, OSError) as e:
        emit({"ok": False, "error": f"{type(e).__name__}: {e}",
              "hint": "nothing was half-written (each write is one transaction); check the path, permissions and free space, "
                      "or retry if another process held the library longer than the 30 s busy timeout"})
        return 1
    except Exception as e:  # still JSON for a caller parsing stdout; the traceback goes to stderr
        traceback.print_exc()
        emit({"ok": False, "error": f"{type(e).__name__}: {e}",
              "hint": "unexpected; nothing was half-written (each write is one transaction). Check the input files, "
                      "and report the traceback on stderr if they look right"})
        return 1
    finally:
        if lib:
            lib.close()
    if isinstance(result, int):
        return result
    emit(result)
    return 0 if result.get("ok", True) else 1


if __name__ == "__main__":
    sys.exit(main())

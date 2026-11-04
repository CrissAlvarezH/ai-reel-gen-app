#!/usr/bin/env python3
"""Throwaway-root check of library.py. Needs Python 3.9+ and FFmpeg; prints ok.

    python3 test_library.py

Covers setup and root resolution, ingest and duplicates, bundle versions (digest, isolation,
publishing, changed sources, orphans, prefix collisions), uses and cut declarations, the
project check, deliver, v1 migration with backup, additive import and full export, and the
failure paths (publish errors, concurrent same-name ingest, repair, bad input, unknown schema).
Set KEEP=1 to keep the temporary folder.
"""
import io
import json
import math
import os
from pathlib import Path
import shutil
import sqlite3
import struct
import subprocess
import sys
import tempfile
import threading
import wave
import zlib

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import library as core  # noqa: E402

TMP = Path(tempfile.mkdtemp(prefix="asset-library-test-")).resolve()
ENV = {k: v for k, v in os.environ.items() if not k.startswith("ASSET_LIBRARY_")}
ENV["HOME"] = str(TMP / "home")


def run(*args, root=None, ok=True, cwd=None, env=None):
    cmd = [sys.executable, str(HERE / "library.py"), *(["--root", str(root)] if root else []), *map(str, args)]
    r = subprocess.run(cmd, capture_output=True, text=True, env=env or ENV, cwd=cwd, timeout=180)
    assert (r.returncode == 0) == ok, f"{args}: exit {r.returncode}\n{r.stdout}\n{r.stderr}"
    return json.loads(r.stdout) if r.stdout.strip().startswith("{") else r


def wav(path, freq, secs=0.3):
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(48000)
        w.writeframes(b"".join(struct.pack("<h", int(12000 * math.sin(2 * math.pi * freq * i / 48000))) for i in range(int(48000 * secs))))
    return path


def png(path, rgb):
    path.parent.mkdir(parents=True, exist_ok=True)
    chunk = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d))  # noqa: E731
    raw = b"".join(b"\0" + bytes(rgb) * 8 for _ in range(8))
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 8, 8, 8, 2, 0, 0, 0))
                     + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))
    return path


def write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
    return path


def rows(db, sql):
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    try:
        return con.execute(sql).fetchall()
    finally:
        con.close()


def dump_tables(db, tables):
    return {t: rows(db, f"SELECT * FROM {t} ORDER BY 1, 2") for t in tables}


def test_setup(root):
    out = run("init", root)
    assert out["schema_version"] == 2 and (root / "library.db").is_file() and (root / "bundles").is_dir()
    assert run("check", root=root)["ok"], "a fresh empty library passes its check"
    assert run("stats", env={**ENV, "ASSET_LIBRARY_ROOT": str(root)})["active"] == 0, "root from the environment"
    write(TMP / "home/.asset-library/profile.md", f"# Profile\n\n- Root: `{root}`. More text.\n")
    assert run("stats")["db"] == str(root.resolve() / "library.db"), "root from the profile"
    os.remove(TMP / "home/.asset-library/profile.md")
    err = run("stats", ok=False)
    assert "no library root" in err["error"] and err["hint"]
    assert "no library at" in run("stats", root=TMP / "nowhere", ok=False)["error"]
    for cmd in core.COMMANDS:
        assert "usage:" in run(cmd, "--help").stdout


def test_ingest(root):
    src = TMP / "downloads"
    out = run("ingest", wav(src / "click.wav", 880), "--kind", "sfx", "--title", "Soft click", "--tags", "click,ui",
              "--source-url", "https://example.org/click", "--creator", "Example", root=root)
    a = out["asset"]
    assert a["id"] == "sfx-soft-click" and a["path"] == "media/sfx/click.wav" and a["sample_rate"] == 48000
    assert a["peak_dbfs"] is not None and abs(a["duration_seconds"] - 0.3) < 0.01 and a["rights_status"] == "unknown"
    shutil.copy(src / "click.wav", src / "click-copy.wav")
    dup = run("ingest", src / "click-copy.wav", "--kind", "sfx", "--title", "Again", root=root)
    assert dup["duplicate_of"] == "sfx-soft-click"
    assert rows(root / "library.db", "SELECT COUNT(*) FROM assets")[0][0] == 1, "a duplicate adds no row"
    img = run("ingest", png(src / "red.png", (200, 30, 30)), "--kind", "image", "--title", "Red square", root=root)["asset"]
    assert img["width"] == 8 and img["thumbnail"] == "previews/image-red-square.jpg" and (root / img["thumbnail"]).is_file()
    run("ingest", wav(src / "boom.wav", 110, 0.6), "--kind", "sfx", "--title", "Low boom", "--tags", "boom", root=root)
    assert "missing file" in run("ingest", src / "nope.wav", "--kind", "sfx", root=root, ok=False)["error"]
    bad = run("ingest", write(src / "notes.txt", "not audio"), "--kind", "sfx", root=root, ok=False)
    assert "ffprobe" in bad["error"] and bad["hint"]
    hits = run("search", "click", "--kind", "sfx", root=root)
    assert [h["id"] for h in hits["assets"]] == ["sfx-soft-click"]
    assert [h["id"] for h in run("search", "--kind", "sfx", "--max-duration", "0.4", root=root)["assets"]] == ["sfx-soft-click"]
    assert "sfx-soft-click\tsfx" in run("search", "click", "--text", root=root).stdout


def make_project(path):
    write(path / "src/kit/thing.py", "def draw():\n    return 'thing'\n")
    write(path / "src/kit/helper.py", "VALUE = 42\n")
    write(path / "src/kit/demo.py",
          "import os, sys\nsys.path.insert(0, os.path.dirname(__file__))\nimport thing, helper\n"
          "os.makedirs('out', exist_ok=True)\nopen('out/check.txt', 'w').write(thing.draw())\n"
          "open('src/kit/thing.py', 'a').write('# validation may scribble; the snapshot must not change\\n')\n")
    png(path / "out/preview.png", (20, 120, 200))
    return path


def register(root, proj, *extra, ok=True, kit="kit", files=("src/kit/",)):
    return run("register", "--kind", "code", "--id", kit, "--title", "Thing kit", "--entry", "src/kit/thing.py",
               "--files", *files, "--example", "src/kit/demo.py", "--preview", "out/preview.png",
               "--planned-use", "draws a thing", "--validate-command", "python3 src/kit/demo.py", "--project", "film",
               *extra, root=root, cwd=proj, ok=ok)


def test_bundles(root):
    proj = make_project(TMP / "film")
    first = register(root, proj)
    assert first["status"] == "registered" and first["validation"] == "passed" and len(first["short"]) == 12
    vdir = root / first["dir"]
    manifest = json.loads((vdir / "bundle.json").read_text())
    assert manifest["version"] == first["version"] == core.content_digest(manifest["content"])
    assert {f["path"] for f in manifest["content"]["files"]} == {"src/kit/thing.py", "src/kit/helper.py", "src/kit/demo.py", "out/preview.png"}
    assert manifest["content"]["validate"]["command"] == "python3 src/kit/demo.py"
    assert "scribble" not in (vdir / "files/src/kit/thing.py").read_text(), "validation ran in a copy"
    again = register(root, proj)
    assert again["status"] == "unchanged" and again["version"] == first["version"]
    timeout = register(root, proj, "--validate-timeout", "300")
    assert timeout["version"] != first["version"], "a changed validation setting is a new version"
    write(proj / "src/kit/thing.py", "def draw():\n    return 'thing v2'\n")
    changed = register(root, proj)
    assert changed["version"] not in (first["version"], timeout["version"])
    shown = run("show", "kit", root=root)
    assert [v["version"] for v in shown["versions"]] == [first["version"], timeout["version"], changed["version"]]
    assert all(v["validation"] == "passed" for v in shown["versions"]) and shown["path"].startswith("bundles/kit/")

    partial = register(root, proj, kit="kit-b", files=("src/kit/thing.py", "src/kit/demo.py"), ok=False)
    assert partial["validation"] == "failed" and "helper" in partial["validation_run"]["output_tail"], \
        "a bundle missing a project file fails validation from its snapshot"
    assert "Validation failed" in run("show", "kit-b", root=root)["notes"][0]["text"]

    write(TMP / "outside.py", "x = 1\n")
    assert "leaves the bundle source" in register(root, proj, kit="kit-c", files=("../outside.py",), ok=False)["error"]
    os.symlink(TMP / "outside.py", proj / "src/kit/link.py")
    assert "outside the bundle source" in register(root, proj, kit="kit-c", ok=False)["error"]
    os.remove(proj / "src/kit/link.py")
    missing = run("register", "--kind", "code", "--id", "kit-d", "--title", "x", "--entry", "src/kit/thing.py",
                  "--files", "src/kit/", "--preview", "out/preview.png", "--planned-use", "x", root=root, cwd=proj, ok=False)
    assert "--example" in missing["error"] and "--validate-command" in missing["error"]
    model = run("register", "--kind", "model", "--id", "crate", "--title", "Crate", "--entry", "src/kit/thing.py",
                "--files", "src/kit/thing.py", "--preview", "out/preview.png", "--planned-use", "a crate",
                "--dimensions", '{"x": 0.6, "y": 0.4, "z": 0.4, "up": "y"}', root=root, cwd=proj)
    assert model["validation"] == "not-run" and model["warnings"]
    probe = ("python3 -c \"import os, sys; sys.exit(0 if os.environ.get('PASS_X') == '1' "
             "and 'HIDE_X' not in os.environ else 1)\"")
    envkit = run("register", "--kind", "code", "--id", "envkit", "--title", "Env kit", "--entry", "src/kit/thing.py",
                 "--files", "src/kit/", "--example", "src/kit/demo.py", "--preview", "out/preview.png", "--planned-use", "x",
                 "--validate-command", probe, "--validate-env", "PASS_X", root=root, cwd=proj,
                 env={**ENV, "PASS_X": "1", "HIDE_X": "1"})
    assert envkit["validation"] == "passed", "validation sees only the base environment plus --validate-env names"
    assert run("check", root=root)["ok"]
    return first, changed


def test_publish_failures(root):
    proj = make_project(TMP / "film-2")
    lib = core.Library(root)
    real_copy = core.shutil.copyfile
    calls = []

    def racing_copy(src, dst, *a, **k):
        if not calls:
            Path(src).write_bytes(Path(src).read_bytes() + b"\n")
        calls.append(src)
        return real_copy(src, dst, *a, **k)

    args = dict(kind="code", asset_id="racy", entry="src/kit/thing.py", files=["src/kit/"], source=proj, title="Racy",
                example="src/kit/demo.py", preview="out/preview.png", planned_use="x", no_validate="test")
    core.shutil.copyfile = racing_copy
    try:
        lib.register(**args)
        raise AssertionError("a source changed mid-copy must be refused")
    except core.LibError as e:
        assert "changed while they were copied" in str(e)
    finally:
        core.shutil.copyfile = real_copy
    assert not any((root / "bundles/.staging").iterdir()) and not (root / "bundles/racy").exists(), "nothing staged or published"
    assert lib.asset_row("racy") is None

    real_index = core.Library.index_fts
    core.Library.index_fts = lambda self, aid: (_ for _ in ()).throw(RuntimeError("crash after publish"))
    try:
        lib.register(**args)
        raise AssertionError("the simulated crash should surface")
    except RuntimeError:
        pass
    finally:
        core.Library.index_fts = real_index
    report = lib.check_library()
    assert len(report["orphans"]) == 1 and report["orphans"][0].startswith("bundles/racy/") and report["ok"]
    assert lib.asset_row("racy") is None and not lib.search("racy"), "an orphan is never served"
    adopted = lib.register(**args)
    assert adopted["status"] == "adopted" and adopted["dir"] == report["orphans"][0]
    assert lib.check_library()["orphans"] == []
    lib.close()


def test_prefix_collision(root):
    proj = make_project(TMP / "film-3")
    lib = core.Library(root)
    base = dict(source=proj, entry="src/kit/thing.py", files=["src/kit/thing.py"], preview="out/preview.png")
    seen, pair = {}, None
    for i in range(20000):
        dims = {"x": float(i)}
        content, _ = lib.build_content(dimensions=dims, **base)
        v = core.content_digest(content)
        if v[:4] in seen:
            pair = (seen[v[:4]], dims)
            break
        seen[v[:4]] = dims
    assert pair, "no 4-hex collision found"
    old = core.SHORT_LEN
    core.SHORT_LEN = 4
    try:
        a = lib.register("model", "set", title="Set", planned_use="a set", dimensions=pair[0], **base)
        b = lib.register("model", "set", title="Set", planned_use="a set", dimensions=pair[1], **base)
    finally:
        core.SHORT_LEN = old
    assert a["version"][:4] == b["version"][:4] and len(a["short"]) == 4 and len(b["short"]) > 4
    try:
        lib.resolve_version("set", a["version"][:4])
        raise AssertionError("a shared prefix must be ambiguous")
    except core.LibError as e:
        assert "ambiguous" in str(e)
    assert lib.resolve_version("set", b["short"]) == b["version"] and lib.resolve_version("set", a["version"]) == a["version"]
    lib.close()


def test_uses_and_delivery(root, first, changed):
    proj = TMP / "film"
    placed = proj / "audio/click.wav"
    placed.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy(TMP / "downloads/click.wav", placed)
    db = root / "library.db"
    count = lambda: rows(db, "SELECT COUNT(*) FROM uses")[0][0]  # noqa: E731

    assert "unknown id" in run("used", "nope", "--project", "film", "--cut", "v1", "--role", "sfx", "--file", placed, root=root, ok=False)["errors"][0]["error"]
    assert run("used", "sfx-soft-click", "--project", "film", "--cut", "v1", "--role", "whoosh", "--file", placed, root=root, ok=False).returncode == 2
    assert "no version" in run("used", "sfx-soft-click", "--project", "film", "--cut", "v1", "--role", "sfx", root=root, ok=False)["errors"][0]["error"]
    wrong = run("used", "sfx-soft-click", "--project", "film", "--cut", "v1", "--role", "sfx", "--file", TMP / "downloads/boom.wav", root=root, ok=False)
    assert "is the library's sfx-low-boom" in wrong["errors"][0]["hint"]
    assert "bundle" in run("used", "kit", "--project", "film", "--cut", "v1", "--role", "code", "--file", placed, root=root, ok=False)["errors"][0]["error"]
    assert count() == 0
    one = run("used", "sfx-soft-click", "--project", "film", "--version", "v0", "--role", "sfx", "--file", placed, "--cue", "tap", root=root)
    assert one["asset"]["uses"][0]["cut"] == "v0" and one["asset"]["uses"][0]["artifact_version"] == one["recorded"][0]["artifact_version"]

    decl = lambda cut, selected: write(proj / f"library-{cut}.json", json.dumps({"project": "film", "cut": cut, "selected": selected}))  # noqa: E731
    good = [{"id": "sfx-soft-click", "role": "sfx", "file": "audio/click.wav", "cue": "tap", "output_time": 1.5},
            {"id": "kit", "role": "code", "artifact_version": first["short"]}]
    bad = decl("v1", good + [{"id": "kit", "role": "code", "artifact_version": "ffff"}])
    before = count()
    assert run("used", "--from", bad, root=root, ok=False)["errors"][0]["entry"] == 2
    assert count() == before, "a declaration with one bad entry records nothing"
    v1 = decl("v1", good)
    assert len(run("used", "--from", v1, root=root)["recorded"]) == 2
    assert run("used", "--from", v1, root=root)["already_recorded"] == ["sfx-soft-click", "kit"] and count() == before + 2

    write(proj / "notes.md", "Tried sfx-low-boom and image-red-square here; rejected.\n")
    shutil.copy(TMP / "downloads/red.png", proj / "rejected.png")
    ok = run("check", "--project", "film", "--cut", "v1", "--declared", v1, root=root, ok=False)
    assert ok["declared"] == 2 and len(ok["failures"]) == 1 and "kit-b" in ok["failures"][0], \
        "uses match; only the failed kit-b bundle from this project blocks"
    refs = {(r["id"], r["basis"]) for r in ok["unrecorded_references"]}
    assert ("sfx-low-boom", "id named") in refs and ("image-red-square", "same content") in refs
    assert not any(r["id"] in ("sfx-soft-click", "kit") for r in ok["unrecorded_references"])

    v2 = decl("v2", good)
    other_cut = run("check", "--project", "film", "--cut", "v2", "--declared", v2, root=root, ok=False)
    assert any("cut v1 do not count" in f for f in other_cut["failures"]), other_cut
    run("used", "sfx-soft-click", "--project", "film", "--cut", "v2", "--role", "sfx", "--file", placed, "--cue", "tap", root=root)
    run("used", "kit", "--project", "film", "--cut", "v2", "--role", "code", "--artifact-version", first["short"], root=root)
    v2b = decl("v2", [good[0], {"id": "kit", "role": "code", "artifact_version": changed["short"], "modified": True}])
    mismatch = run("check", "--project", "film", "--cut", "v2", "--declared", v2b, root=root, ok=False)
    assert any("declared at version" in f for f in mismatch["failures"]), mismatch
    assert any("kit-b" in f and "failed its validation" in f for f in mismatch["failures"])
    assert "no declaration" in run("check", "--project", "film", "--cut", "v9", root=root, ok=False)["failures"][0]

    blocked = run("deliver", "--project", "film", "--cut", "v2", "--declared", v2b, "--registered", f"kit@{changed['short']}", root=root, ok=False)
    assert blocked["delivered"] is False and blocked["catalog"] == "incomplete"
    assert rows(db, "SELECT COUNT(*) FROM deliveries")[0][0] == 0
    assert run("deliver", "--project", "film", "--cut", "v1", "--declared", v1, root=root, ok=False).returncode == 2

    # Fix: a passing kit-b version, the modified use, then account for every registration.
    fixed = register(root, proj, kit="kit-b", files=("src/kit/thing.py", "src/kit/demo.py", "src/kit/helper.py"))
    run("used", "kit", "--project", "film", "--cut", "v2", "--role", "code", "--artifact-version", changed["short"], "--modified", root=root)
    lacking = run("deliver", "--project", "film", "--cut", "v2", "--declared", v2b, "--none", "nothing new", root=root, ok=False)
    assert any("not listed" in f and "kit-b" in f for f in lacking["failures"]), lacking
    regs = [f"kit@{v['short']}" for v in run("show", "kit", root=root)["versions"]]
    kit_b = run("show", "kit-b", root=root)["versions"]
    regs += [f"kit-b@{v['short']}" for v in kit_b if v["validation"] == "passed"]
    assert fixed["validation"] == "passed" and len(kit_b) == 2
    failed = [f"kit-b@{v['short']}" for v in kit_b if v["validation"] == "failed"]
    refused = run("deliver", "--project", "film", "--cut", "v2", "--declared", v2b, "--registered", *regs, *failed, root=root, ok=False)
    assert any("failed its validation" in f for f in refused["failures"]), "a failed version is not a reusable registration"
    done = run("deliver", "--project", "film", "--cut", "v2", "--declared", v2b, "--registered", *regs, root=root)
    assert done["delivered"] and done["catalog"] == "delivered" and rows(db, "SELECT COUNT(*) FROM deliveries")[0][0] == 1
    assert run("check", "--project", "film", "--cut", "v2", root=root)["ok"], "a delivered cut checks from its stored declaration"
    empty = decl("v3", [])
    assert run("deliver", "--project", "film", "--cut", "v3", "--declared", empty, "--none", "used nothing from the library", root=root)["delivered"]

    clicks = [subprocess.Popen([sys.executable, str(HERE / "library.py"), "--root", str(root), "used", "sfx-low-boom",
                                "--project", "busy", "--cut", "v1", "--role", "sfx", "--file", str(TMP / "downloads/boom.wav"),
                                "--cue", f"hit {i}"], env=ENV, stdout=subprocess.DEVNULL) for i in range(6)]
    assert all(p.wait() == 0 for p in clicks)
    assert rows(db, "SELECT COUNT(*) FROM uses WHERE project='busy'")[0][0] == 6, "concurrent writers all land"

    assert "needs --source" in run("note", "kit", "--kind", "opinion", "--text", "love it", root=root, ok=False)["error"]
    noted = run("note", "kit", "--kind", "opinion", "--text", "love the wobble", "--source", "review call", "--artifact-version", first["short"], root=root)
    assert noted["asset"]["notes"][-1]["artifact_version"] == first["version"]
    assert [a["id"] for a in run("search", "wobble", root=root)["assets"]] == ["kit"]
    run("archive", "sfx-low-boom", root=root)
    assert run("search", "boom", root=root)["count"] == 0 and len(run("show", "sfx-low-boom", root=root)["uses"]) == 6


def raises(fn, text):
    try:
        fn()
    except core.LibError as e:
        assert text in str(e.payload), f"{text!r} not in {e.payload}"
        return e
    raise AssertionError(f"expected a LibError with {text!r}")


def test_hardening():
    """Publishing errors, concurrent ingest, repair, input checks and export of adapter tables."""
    root = TMP / "hard"
    run("init", root)
    src = TMP / "hard-src"
    proj = make_project(TMP / "hard-film")

    (root / "bundles/ro").mkdir(parents=True)
    os.chmod(root / "bundles/ro", 0o555)  # rename into it fails with EACCES; it used to retry forever
    try:
        out = register(root, proj, kit="ro", ok=False)
    finally:
        os.chmod(root / "bundles/ro", 0o755)
    assert "cannot publish" in out["error"] and not any((root / "bundles/.staging").iterdir())

    a, b = wav(src / "a/click.wav", 440), wav(src / "b/click.wav", 990)
    barrier, real_copy, results = threading.Barrier(2), core.shutil.copyfile, {}

    def both_copied(s, d, *x, **k):
        r = real_copy(s, d, *x, **k)
        if str(d).endswith(".part"):
            barrier.wait(timeout=20)  # both copies are made before either is published
        return r

    def go(name, f):
        lib = core.Library(root)
        results[name] = lib.ingest(f, "sfx", title=f"click {name}")
        lib.close()

    core.shutil.copyfile = both_copied
    try:
        ts = [threading.Thread(target=go, args=(n, f)) for n, f in (("a", a), ("b", b))]
        [t.start() for t in ts]
        [t.join(60) for t in ts]
    finally:
        core.shutil.copyfile = real_copy
    lib = core.Library(root)
    got = [(r["asset"]["path"], r["asset"]["sha256"]) for r in results.values()]
    assert len({p for p, _ in got}) == 2 and all(core.sha256_file(root / p) == s for p, s in got), \
        "same-name files ingested at once keep their own bytes"

    first = results["a"]["asset"]
    os.remove(first["abs_path"])
    again = lib.ingest(a, "sfx")
    assert again["duplicate_of"] == first["id"] and again["restored"] == first["path"]
    assert core.sha256_file(first["abs_path"]) == first["sha256"] and lib.check_library()["ok"]

    def ingest_while(rival, mine, **kw):
        """Ingest `mine` while another process takes the ID: `rival` lands after the copy."""
        real = core.Library._copy_in

        def copy_then_rival(self, *x):
            out = real(self, *x)
            core.Library._copy_in = real
            other = core.Library(root)
            other.ingest(rival, "image", title="Square", asset_id=kw.get("asset_id"))
            other.close()
            return out
        core.Library._copy_in = copy_then_rival
        try:
            return lib.ingest(mine, "image", title="Square", **kw)
        finally:
            core.Library._copy_in = real

    red, blue = png(src / "red.png", (200, 0, 0)), png(src / "blue.png", (0, 0, 200))
    raises(lambda: ingest_while(red, blue, asset_id="img-x"), "taken meanwhile")
    assert not (root / "media/image/blue.png").exists(), "the losing copy is removed"
    lib.make_preview("ref-red", "image", red, None)
    rival_preview = core.sha256_file(root / "previews/ref-red.jpg")
    assert core.sha256_file(root / "previews/img-x.jpg") == rival_preview, "the loser does not overwrite the winner's preview"
    green, yellow = png(src / "green.png", (0, 200, 0)), png(src / "yellow.png", (200, 200, 0))
    won = ingest_while(green, yellow)["asset"]
    assert won["id"].startswith("image-square-") and won["thumbnail"] == f"previews/{won['id']}.jpg"
    assert core.sha256_file(root / "previews/img-x.jpg") == rival_preview

    wav(Path(first["abs_path"]), 330, 0.5)  # a file replaced in place
    assert any("differ in size" in w for w in lib.check_library()["warnings"])
    os.remove(first["abs_path"])
    lib.ingest(a, "sfx")  # restores it

    raises(lambda: lib.ingest(b, "sfx", source_in=5, source_out=1), "must be after")
    raises(lambda: lib.ingest(b, "sfx", source_in=-1), "0 or more")
    sid = first["id"]
    for bad in (-3, "nan", float("inf"), "soon"):
        raises(lambda: lib.record_uses("p", "v1", [{"id": sid, "role": "sfx", "file": str(a), "output_time": bad}]), "output_time")
    assert rows(root / "library.db", "SELECT COUNT(*) FROM uses")[0][0] == 0

    decl = write(src / "a/decl.json", json.dumps({"project": "p", "cut": "v1", "selected": [{"id": sid, "role": "sfx", "file": "click.wav"}]}))
    lib.record_uses("p", "v1", [{"id": sid, "role": "sfx", "file": str(a)}])
    real_read = core.Library.read_declaration

    def read_then_rewrite(path):
        d = real_read(path)
        write(decl, json.dumps({"project": "p", "cut": "v1", "selected": [{"id": "img-x", "role": "visual", "file": "../red.png"}]}))
        return d
    core.Library.read_declaration = staticmethod(read_then_rewrite)
    try:
        assert lib.deliver("p", "v1", decl, none_reason="nothing")["delivered"]
    finally:
        core.Library.read_declaration = staticmethod(real_read)
    stored = json.loads(rows(root / "library.db", "SELECT declared_json FROM deliveries")[0][0])
    assert [e["id"] for e in stored] == [sid] and lib.check_project("p", "v1")["ok"], "deliver stores what it checked"

    legacy = write(TMP / "hard-legacy/globe.tsx", "export const Globe = 1;\n")
    catalog = write(root / "catalog.json", json.dumps([
        {"id": "kit", "kind": "code", "title": "Kit", "path": str(legacy), "planned_use": "a globe"},
        {"id": "Bad ID/../x", "kind": "sfx", "title": "t", "path": "media/sfx/click.wav"},
        {"id": "sound-x", "kind": "sound", "title": "t", "path": "media/sfx/click.wav"},
        {"id": "tags-x", "kind": "sfx", "title": "t", "path": "media/sfx/click.wav", "tags": 5},
    ]))
    imp = lib.import_catalog(catalog)
    assert imp["added"] == ["kit"] and [i["entry"] for i in imp["invalid"]] == [1, 2, 3]
    lib.register("code", "kit", "src/kit/thing.py", ["src/kit/"], source=proj, example="src/kit/demo.py",
                 preview="out/preview.png", no_validate="test")
    notes = [n["text"] for n in lib.asset_row("kit")["notes"]]
    assert any(str(legacy) in n for n in notes), "the replaced legacy pointer is kept in a note"

    lib.conn.execute("CREATE TABLE thumbs (id TEXT PRIMARY KEY, data BLOB)")
    lib.conn.execute("INSERT INTO thumbs VALUES ('t1', x'00ff')")
    assert lib.export()["rows"]["thumbs"] == 1
    assert json.loads((root / "exports/library.json").read_text())["tables"]["thumbs"][0]["data"] == {"base64": "AP8="}

    real_out, real_err, sys.stdout, sys.stderr = sys.stdout, sys.stderr, io.StringIO(), io.StringIO()
    try:
        code = core.main(["stats"], root=root, extend=lambda sub, parsers: {"stats": lambda lib, a: 1 / 0})
        crashed = json.loads(sys.stdout.getvalue())
    finally:
        sys.stdout, sys.stderr = real_out, real_err
    assert code == 1 and crashed["ok"] is False and "ZeroDivisionError" in crashed["error"], "an unexpected error is still JSON"

    for value in ("3", "2.1", "3-beta"):
        lib.conn.execute("UPDATE meta SET value=? WHERE key='schema_version'", (value,))
        raises(lambda: core.Library(root), "newer than or unknown")
        assert rows(root / "library.db", "SELECT value FROM meta")[0][0] == value
    lib.conn.execute("UPDATE meta SET value='2' WHERE key='schema_version'")
    lib.close()


V1_DDL = """
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE assets (id TEXT PRIMARY KEY, kind TEXT NOT NULL, category TEXT NOT NULL, title TEXT NOT NULL,
  path TEXT NOT NULL, sha256 TEXT, bytes INTEGER, duration_seconds REAL, width INTEGER, height INTEGER,
  sample_rate INTEGER, peak_dbfs REAL, thumbnail TEXT, archived INTEGER NOT NULL DEFAULT 0, canonical_id TEXT,
  extra_json TEXT, updated_at TEXT NOT NULL);
CREATE TABLE provenance (asset_id TEXT PRIMARY KEY, source_url TEXT, download_url TEXT, original_filename TEXT,
  creator TEXT, rights_status TEXT, license TEXT, license_url TEXT, review_status TEXT, selection_status TEXT,
  downloaded_at TEXT, review_notes TEXT, spoken_cue TEXT, planned_use TEXT, source_in REAL, source_out REAL, audio_use TEXT);
CREATE TABLE tags (asset_id TEXT NOT NULL, tag TEXT NOT NULL, facet TEXT NOT NULL DEFAULT 'content', PRIMARY KEY (asset_id, tag, facet));
CREATE TABLE variants (asset_id TEXT PRIMARY KEY, work_id TEXT NOT NULL, role TEXT);
CREATE TABLE uses (id INTEGER PRIMARY KEY AUTOINCREMENT, asset_id TEXT NOT NULL, project TEXT NOT NULL, version TEXT,
  cue TEXT, output_time REAL, role TEXT, used_at TEXT NOT NULL);
CREATE INDEX uses_asset ON uses(asset_id);
CREATE INDEX uses_project ON uses(project);
CREATE VIRTUAL TABLE assets_fts USING fts5(id UNINDEXED, title, tags, notes, creator, cue, tokenize='unicode61 remove_diacritics 2');
CREATE TABLE videos (id TEXT PRIMARY KEY, record_json TEXT NOT NULL);
INSERT INTO meta VALUES('schema_version','1');
"""
V1_TABLES = ("meta", "assets", "provenance", "tags", "variants", "uses", "videos")


def test_v1_migration():
    root = TMP / "old"
    wav(root / "sfx/clips/tick.wav", 1500)
    elsewhere = write(TMP / "elsewhere/rig.tsx", "export const Rig = 1;\n")
    con = sqlite3.connect(root / "library.db")
    con.executescript(V1_DDL)
    t = "2026-01-01T00:00:00+00:00"
    tick_sha = core.sha256_file(root / "sfx/clips/tick.wav")
    con.executemany("INSERT INTO assets(id,kind,category,title,path,sha256,archived,canonical_id,updated_at) VALUES(?,?,?,?,?,?,?,?,?)", [
        ("sfx-tick", "sfx", "sfx", "Tick", "sfx/clips/tick.wav", tick_sha, 0, None, t),
        ("sfx-tick-copy", "sfx", "sfx", "Tick copy", "sfx/clips/tick.wav", tick_sha, 0, "sfx-tick", t),
        ("old-card", "image", "visual", "Old card", "visuals/gone.png", None, 1, None, t),
        ("character-rig", "character", "character", "Rig", str(elsewhere), None, 0, None, t),
    ])
    con.execute("INSERT INTO provenance(asset_id, review_notes, rights_status) VALUES('character-rig', 'Opinion: not recorded.', 'own work')")
    con.execute("INSERT INTO tags VALUES('sfx-tick','tick','function')")
    con.execute("INSERT INTO variants VALUES('sfx-tick','work-tick','original')")
    con.executemany("INSERT INTO uses(asset_id,project,version,cue,output_time,role,used_at) VALUES(?,?,?,?,?,?,?)", [
        ("sfx-tick", "p1", "v8", "beat", 1.0, "supporting visual", t), ("sfx-tick", "p1", None, None, None, None, t),
        ("character-rig", "p2", "v2", None, None, "character", t),
    ])
    con.execute("INSERT INTO assets_fts(id,title,tags,notes,creator,cue) VALUES('sfx-tick','Tick','tick','','','')")
    con.execute("INSERT INTO videos VALUES('p1/v8', '{}')")
    con.commit()
    con.close()
    before = dump_tables(root / "library.db", V1_TABLES)

    report = run("check", root=root)
    backups = list(root.glob("library.db.bak-1-*"))
    assert len(backups) == 1 and report["backup"] == str(backups[0]), report
    assert dump_tables(backups[0], V1_TABLES) == before, "the backup holds the v1 rows"
    after = dump_tables(root / "library.db", [t for t in V1_TABLES if t != "uses"])
    assert after == {k: v for k, v in before.items() if k != "uses"} | {"meta": [("schema_version", "2")]}
    assert rows(root / "library.db", "SELECT id,asset_id,project,version,cue,output_time,role,used_at FROM uses ORDER BY 1") == before["uses"]
    assert rows(root / "library.db", "SELECT COUNT(*) FROM uses WHERE artifact_version IS NULL AND modified IS NULL")[0][0] == 3
    assert report["ok"] and any("legacy roles" in w for w in report["warnings"]) and any("3 legacy uses" in w for w in report["warnings"])
    assert run("show", "character-rig", root=root)["path"] == str(elsewhere), "legacy absolute pointers stay"
    run("stats", root=root)
    assert len(list(root.glob("library.db.bak-*"))) == 1, "an up-to-date library is not backed up again"
    con = sqlite3.connect(root / "library.db")
    con.execute("UPDATE meta SET value='1' WHERE key='schema_version'")  # an older tool rewriting its version
    con.commit()
    con.close()
    run("stats", root=root)
    assert rows(root / "library.db", "SELECT value FROM meta")[0][0] == "2" and len(list(root.glob("library.db.bak-*"))) == 1

    catalog = write(root / "catalog.json", json.dumps([
        {"id": "character-rig", "kind": "character", "title": "Rig (renamed)", "path": str(elsewhere)},
        {"id": "sfx-new", "kind": "sfx", "title": "New tick", "path": "sfx/clips/tick.wav", "tags": ["tick"]},
        {"id": "sfx-ghost", "kind": "sfx", "title": "Ghost", "path": "sfx/clips/ghost.wav"},
        {"id": "visual-new", "kind": "image", "title": "New", "path": "visuals/new.png", "work_id": "work-new", "variant_role": "crop"},
    ]))
    png(root / "visuals/new.png", (1, 2, 3))
    run("note", "character-rig", "--kind", "caveat", "--text", "eyes drift in profile", root=root)
    imp = run("import", catalog, root=root)
    assert imp["added"] == ["sfx-new", "visual-new"] and imp["missing_files"] == ["sfx-ghost"]
    assert imp["duplicates"] == [{"id": "sfx-new", "duplicate_of": "sfx-tick"}]
    assert imp["differs"] == {"character-rig": {"title": ["Rig", "Rig (renamed)"]}}
    rig = run("show", "character-rig", root=root)
    assert rig["title"] == "Rig" and rig["review_notes"] == "Opinion: not recorded." and len(rig["notes"]) == 1
    again = run("import", catalog, root=root)
    assert again["added"] == [] and set(again["differs"]) == {"character-rig"}, "importing twice changes nothing"
    upd = run("import", catalog, "--update", "character-rig", root=root)
    assert upd["updated"] == ["character-rig"]
    rig = run("show", "character-rig", root=root)
    assert rig["title"] == "Rig (renamed)" and rig["review_notes"] == "Opinion: not recorded.", "--update changes only stated fields"
    assert rig["rights_status"] == "own work" and len(rig["uses"]) == 1 and len(rig["notes"]) == 1
    assert run("show", "visual-new", root=root)["work_id"] == "work-new"

    exp = run("export", root=root)
    data = json.loads((root / "exports/library.json").read_text())
    con = sqlite3.connect(root / "library.db")
    for table in ("meta", "assets", "provenance", "tags", "variants", "uses", "videos", "asset_versions", "notes", "deliveries"):
        n = con.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        assert len(data["tables"][table]) == n == exp["rows"][table], table
    con.close()
    assert "assets_fts" not in data["tables"] and not any(k.startswith("assets_fts_") for k in data["tables"])
    assert {a["id"] for a in data["tables"]["assets"]} >= {"old-card", "sfx-tick-copy"}, "archived and duplicate rows are exported"
    html = (root / "exports/index.html").read_text()
    assert 'id="list"' in html and "character-rig" in html


def main():
    try:
        root = TMP / "lib"
        test_setup(root)
        test_ingest(root)
        first, changed = test_bundles(root)
        test_publish_failures(root)
        test_prefix_collision(root)
        test_uses_and_delivery(root, first, changed)
        test_v1_migration()
        test_hardening()
        assert run("check", root=root)["ok"]
    finally:
        if os.environ.get("KEEP"):
            print(f"kept {TMP}", file=sys.stderr)
        else:
            shutil.rmtree(TMP, ignore_errors=True)
    print("ok")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Memoria de una automatización, for its agents: what they keep from one run to the next, one entry per thing,
through Reel Studio (the page follows every change). Kinds: note (a rule or lesson for every run), pending (where to
pick up; close it when resolved), done (already done, not to repeat, with a stable --key), run (the studio's summary
of each run; not written from here).

    memory.py show                                       what an agent starts with: notes, pending, pinned, last runs
    memory.py check <clave>                              whether something is already done (a done with that key)
    memory.py search [palabras] [--kind K] [--limit N]   the whole memory, resolved and old included
    memory.py add note|pending|done "texto" [--key K] [--pin]
    memory.py edit <id> [--text "…"] [--key K] [--kind K] [--pin | --unpin]
    memory.py close <id>   /   memory.py reopen <id>     a pending resolved, or open again
    memory.py rm <id>

The automation is REEL_STUDIO_AUTOMATION (set by Reel Studio when an automation runs), or --automation <id>; the project
is the agent's own (REEL_STUDIO_PROJECT), else the one open. Needs Reel Studio running (REEL_STUDIO_URL).
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime

BASE = os.environ.get("REEL_STUDIO_URL", "http://127.0.0.1:4000").rstrip("/")
PROJECT = os.path.basename(os.environ.get("REEL_STUDIO_PROJECT", "").rstrip("/\\"))
KINDS = ["note", "pending", "done", "run"]
LABEL = {"note": "nota", "pending": "pendiente", "done": "hecho", "run": "ejecución"}
BY = {"agent": "agente", "creator": "creador", "studio": "studio"}


def call(automation, method, path=(), body=None, **query):
    query = {k: v for k, v in query.items() if v is not None}
    if PROJECT:
        query["project"] = PROJECT
    url = BASE + "/api/automations/" + urllib.parse.quote(automation, safe="") + "/memory"
    url += "".join("/" + urllib.parse.quote(p, safe="") for p in path)
    if query:
        url += "?" + urllib.parse.urlencode(query)
    data = None if body is None else json.dumps({**body, "by": "agent"}).encode()
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"}, method=method)
    try:
        return json.load(urllib.request.urlopen(req, timeout=30))
    except urllib.error.HTTPError as e:
        try:
            msg = json.load(e).get("error")
        except ValueError:
            msg = None
        sys.exit(f"error: {msg or f'Reel Studio respondió {e.code}'}")
    except urllib.error.URLError:
        sys.exit(f"error: Reel Studio no responde en {BASE}; ¿está abierto?")


def when(ms):
    return datetime.fromtimestamp(ms / 1000).strftime("%Y-%m-%d %H:%M")


def entry(e):
    head = f"[{e['id']}] {LABEL[e['kind']]}"
    if e.get("key"):
        head += f" · clave: {e['key']}"
    if e.get("pinned"):
        head += " · fijado"
    if e.get("closed"):
        head += f" · resuelto el {when(e['closed'])}"
    head += f" · {BY.get(e['by'], e['by'])}, {when(e['updated'])}"
    return head + "\n    " + e["text"].replace("\n", "\n    ")


def parser():
    p = argparse.ArgumentParser(prog="memory.py", description=__doc__.split("\n\n")[0])
    p.add_argument("--automation", default=os.environ.get("REEL_STUDIO_AUTOMATION"))
    cmd = p.add_subparsers(dest="cmd", required=True)
    cmd.add_parser("show")
    c = cmd.add_parser("check")
    c.add_argument("key")
    c = cmd.add_parser("search")
    c.add_argument("words", nargs="*")
    c.add_argument("--kind", choices=KINDS)
    c.add_argument("--limit", type=int, default=30)
    c = cmd.add_parser("add")
    c.add_argument("kind", choices=KINDS[:3])
    c.add_argument("text")
    c.add_argument("--key")
    c.add_argument("--pin", action="store_true")
    c = cmd.add_parser("edit")
    c.add_argument("id")
    c.add_argument("--text")
    c.add_argument("--key")
    c.add_argument("--kind", choices=KINDS[:3])
    pin = c.add_mutually_exclusive_group()
    pin.add_argument("--pin", action="store_true")
    pin.add_argument("--unpin", action="store_true")
    for name in ("close", "reopen", "rm"):
        cmd.add_parser(name).add_argument("id")
    return p


def main():
    a = parser().parse_args()
    if not a.automation:
        sys.exit("error: ¿de qué automatización? Solo funciona dentro de una ejecución (REEL_STUDIO_AUTOMATION) o con --automation <id>.")
    at = a.automation
    if a.cmd == "show":
        print(call(at, "GET", ["brief"])["text"])
    elif a.cmd == "check":
        e = call(at, "GET", ["check"], key=a.key)["entry"]
        print(f"Ya está hecho:\n{entry(e)}" if e else f"No hay ningún hecho con la clave «{a.key}».")
    elif a.cmd == "search":
        found = call(at, "GET", ["search"], q=" ".join(a.words) or None, kind=a.kind, limit=a.limit)["entries"]
        print("\n".join(entry(e) for e in found) if found else "Nada coincide.")
        if len(found) == a.limit:
            print(f"(las {a.limit} más recientes; afina la búsqueda o sube --limit)")
    elif a.cmd == "add":
        body = {"kind": a.kind, "text": a.text}
        if a.key is not None:
            body["key"] = a.key
        if a.pin:
            body["pinned"] = True
        r = call(at, "POST", body=body)
        print(("Actualizado (ya había un hecho con esa clave):\n" if r["existed"] else "Añadido:\n") + entry(r["entry"]))
    elif a.cmd == "edit":
        body = {k: v for k, v in {"text": a.text, "key": a.key, "kind": a.kind}.items() if v is not None}
        if a.pin or a.unpin:
            body["pinned"] = bool(a.pin)
        if not body:
            sys.exit("error: nada que cambiar (--text, --key, --kind, --pin o --unpin)")
        print("Cambiado:\n" + entry(call(at, "PUT", [a.id], body)["entry"]))
    elif a.cmd in ("close", "reopen"):
        print(("Resuelto:\n" if a.cmd == "close" else "Abierto otra vez:\n") + entry(call(at, "PUT", [a.id], {"closed": a.cmd == "close"})["entry"]))
    elif a.cmd == "rm":
        call(at, "DELETE", [a.id])
        print("Borrado.")


if __name__ == "__main__":
    main()

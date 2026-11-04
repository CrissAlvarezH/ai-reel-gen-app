#!/usr/bin/env python3
"""Ideas de contenido, for the agent: the project's board of video ideas (content verticals, lists and their cards),
through Reel Studio, so the page follows every change. Everything the page does can be done from here.

    ideas.py show [--json]
    ideas.py add "título" [--list L] [--notes "…"] [--vertical V] [--top]
    ideas.py edit <id> [--title "…"] [--notes "…"] [--vertical V]      (one at most: it replaces its vertical; "" clears it)
    ideas.py move <id> [--list L] [--before <id> | --top]          (no position: last)
    ideas.py rm <id>
    ideas.py list add "nombre" [--before L]
    ideas.py list rename L "nombre"
    ideas.py list move L [--before M | --top]                      (no position: last)
    ideas.py list rm L [--to M | --with-cards]                     (a list with cards needs one of them)
    ideas.py vertical add "nombre" --description "…" --icon i [--color c]
    ideas.py vertical edit V [--name "…"] [--description "…"] [--icon i] [--color c]
    ideas.py vertical rm V                                         (its cards stay, without it)

Cards go by id (show lists them); lists and verticals by name or id. The project is the agent's own
(REEL_STUDIO_PROJECT, set by Reel Studio), else the one open. Needs Reel Studio running (REEL_STUDIO_URL).
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

BASE = os.environ.get("REEL_STUDIO_URL", "http://127.0.0.1:4000").rstrip("/")
PROJECT = os.path.basename(os.environ.get("REEL_STUDIO_PROJECT", "").rstrip("/\\"))


def call(method, path, body=None, **query):
    query = {k: v for k, v in query.items() if v is not None}
    if PROJECT:
        query["project"] = PROJECT
    url = BASE + "/api/ideas" + "".join("/" + urllib.parse.quote(p, safe="") for p in path)
    if query:
        url += "?" + urllib.parse.urlencode(query)
    data = None if body is None else json.dumps(body).encode()
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


def show(board):
    names = {v["id"]: v["name"] for v in board["verticals"]}
    print("Verticales:" if board["verticals"] else "Verticales: ninguna")
    for v in board["verticals"]:
        print(f"- {v['name']} ({v['color']}, {v['icon']})" + (f": {v['description']}" if v["description"] else ""))
    for lst in board["lists"]:
        print(f"\n## {lst['name']} ({len(lst['cards'])}) [{lst['id']}]")
        for c in lst["cards"]:
            tags = f" #{names[c['vertical']]}" if c["vertical"] else ""
            print(f"- {c['id']}  {c['title']}{tags}")
            if c["notes"]:
                print("    " + c["notes"].replace("\n", "\n    "))


def fields(**kw):
    return {k: v for k, v in kw.items() if v is not None}


def position(a):
    return fields(before=getattr(a, "before", None), top=True if getattr(a, "top", False) else None)


def parser():
    p = argparse.ArgumentParser(prog="ideas.py", description="Ideas de contenido: " + __doc__.split("\n\n")[0])
    cmd = p.add_subparsers(dest="cmd", required=True)
    c = cmd.add_parser("show")
    c.add_argument("--json", action="store_true")
    c = cmd.add_parser("add")
    c.add_argument("title")
    c.add_argument("--list")
    c.add_argument("--notes")
    c.add_argument("--vertical")
    c.add_argument("--top", action="store_true")
    c = cmd.add_parser("edit")
    c.add_argument("id")
    c.add_argument("--title")
    c.add_argument("--notes")
    c.add_argument("--vertical")
    c = cmd.add_parser("move")
    c.add_argument("id")
    c.add_argument("--list")
    c.add_argument("--before")
    c.add_argument("--top", action="store_true")
    c = cmd.add_parser("rm")
    c.add_argument("id")

    lists = cmd.add_parser("list").add_subparsers(dest="sub", required=True)
    c = lists.add_parser("add")
    c.add_argument("name")
    c.add_argument("--before")
    c = lists.add_parser("rename")
    c.add_argument("ref")
    c.add_argument("name")
    c = lists.add_parser("move")
    c.add_argument("ref")
    c.add_argument("--before")
    c.add_argument("--top", action="store_true")
    c = lists.add_parser("rm")
    c.add_argument("ref")
    c.add_argument("--to")
    c.add_argument("--with-cards", action="store_true")

    verts = cmd.add_parser("vertical").add_subparsers(dest="sub", required=True)
    c = verts.add_parser("add")
    c.add_argument("name")
    c.add_argument("--description")
    c.add_argument("--icon")
    c.add_argument("--color")
    c = verts.add_parser("edit")
    c.add_argument("ref")
    c.add_argument("--name")
    c.add_argument("--description")
    c.add_argument("--icon")
    c.add_argument("--color")
    c = verts.add_parser("rm")
    c.add_argument("ref")
    return p


def run(a):
    if a.cmd == "add":
        return call("POST", ["cards"], fields(title=a.title, list=a.list, notes=a.notes, vertical=a.vertical, top=True if a.top else None))
    if a.cmd == "edit":
        return call("PUT", ["cards", a.id], fields(title=a.title, notes=a.notes, vertical=a.vertical))
    if a.cmd == "move":
        return call("POST", ["cards", a.id, "move"], {**fields(list=a.list), **position(a)})
    if a.cmd == "rm":
        return call("DELETE", ["cards", a.id])
    if a.cmd == "list":
        if a.sub == "add":
            return call("POST", ["lists"], {"name": a.name, **position(a)})
        if a.sub == "rename":
            return call("PUT", ["lists", a.ref], {"name": a.name})
        if a.sub == "move":
            return call("POST", ["lists", a.ref, "move"], position(a))
        return call("DELETE", ["lists", a.ref], moveTo=a.to, withCards="1" if a.with_cards else None)
    if a.cmd == "vertical":
        if a.sub == "add":
            return call("POST", ["verticals"], fields(name=a.name, description=a.description, icon=a.icon, color=a.color))
        if a.sub == "edit":
            return call("PUT", ["verticals", a.ref], fields(name=a.name, description=a.description, icon=a.icon, color=a.color))
        return call("DELETE", ["verticals", a.ref])
    return call("GET", [])


def main():
    a = parser().parse_args()
    board = run(a)
    if a.cmd == "show" and a.json:
        print(json.dumps(board, ensure_ascii=False, indent=2))
    else:
        show(board)


main()

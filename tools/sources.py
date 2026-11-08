#!/usr/bin/env python3
"""Fuentes de información, for the agent: the project's information sources (what to follow, its links, how to read
them and the instructions for whoever extracts them) and what was extracted from them, through Reel Studio, so the
page follows every change.

    sources.py show [F] [--json]                       (all sources, or one in full with its instructions)
    sources.py source add "nombre" [--description "…"] [--link "Etiqueta | URL"]… [--instructions "…" | --instructions-file f] [--disabled]
    sources.py source edit F [--name "…"] [--description "…"] [--link …]… (replaces them) [--instructions … | --instructions-file f] [--enable | --disable]
    sources.py source rm F                             (its results go with it)
    sources.py items [--source F] [--state s] [--tag t] [--q "…"] [--since-days N] [--limit N] [--json]
    sources.py item <id>                               (one result, with its markdown)
    sources.py add --source F --title "…" --url URL [--published AAAA-MM-DD] [--summary "…"] [--tag t]… [--link URL]…
                   [--markdown "…" | --markdown-file f | --markdown-file -] [--update]
    sources.py edit <id> [--state new|read|used|discarded] [--title] [--summary] [--published] [--tag t]… [--markdown-file f]
    sources.py rm <id>
    sources.py done F [--added N] [--note "…" | --error "…"]
    sources.py apify <usuario/actor> --input '{…}' [--max-items N] [--out f.json]

How to read a source is the agent's call, with whatever it has. States: new, read, used, discarded (items --state pending: new or read).
Sources go by name or id; results by id. The same URL is never saved twice in a source: add says so (use --update to
replace it). The project is the agent's own (REEL_STUDIO_PROJECT, set by Reel Studio), else the one open. Needs Reel
Studio running (REEL_STUDIO_URL).
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


def call(method, path, body=None, timeout=30, **query):
    query = {k: v for k, v in query.items() if v is not None}
    if PROJECT:
        query["project"] = PROJECT
    url = BASE + path
    if query:
        url += "?" + urllib.parse.urlencode(query)
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"}, method=method)
    try:
        return json.load(urllib.request.urlopen(req, timeout=timeout))
    except urllib.error.HTTPError as e:
        try:
            msg = json.load(e).get("error")
        except ValueError:
            msg = None
        sys.exit(f"error: {msg or f'Reel Studio respondió {e.code}'}")
    except urllib.error.URLError:
        sys.exit(f"error: Reel Studio no responde en {BASE}; ¿está abierto?")


def seg(s):
    return urllib.parse.quote(s, safe="")


def read_file(path):
    if path == "-":
        return sys.stdin.read()
    try:
        with open(path, encoding="utf-8") as f:
            return f.read()
    except OSError as e:
        sys.exit(f"error: no se puede leer {path}: {e.strerror}")


def text_or_file(value, path):
    return read_file(path) if path else value


def when(ms):
    import datetime

    return datetime.datetime.fromtimestamp(ms / 1000).strftime("%Y-%m-%d %H:%M")


def show_sources(view, one=None):
    sources = view["sources"]
    if one:
        key = one.lower()
        sources = [s for s in sources if s["id"] == one or s["name"].lower() == key]
        if not sources:
            sys.exit(f"error: no existe la fuente «{one}». Hay: {', '.join(s['name'] for s in view['sources']) or 'ninguna'}")
    if not sources:
        print("Todavía no hay fuentes.")
    for s in sources:
        state = "" if s["enabled"] else " (desactivada)"
        print(f"## {s['name']} [{s['id']}]{state} · {s['items']} resultados ({s['fresh']} sin abrir)")
        if s["description"]:
            print(f"Qué quiere: {s['description']}")
        for l in s["links"]:
            print(f"- {l['label']} | {l['url']}")
        run = s.get("lastRun")
        if run:
            print(f"Última extracción: {when(run['at'])} · {'bien' if run['ok'] else 'con error'} · {run['added']} nuevos" + (f" · {run['note']}" if run["note"] else ""))
        if one or len(sources) == 1:
            print("Instrucciones:\n" + (s["instructions"] or "(ninguna)"))
        print()


def show_items(lst):
    print(f"{lst['total']} resultados" + (f" (se muestran {len(lst['rows'])})" if lst["total"] > len(lst["rows"]) else ""))
    for r in lst["rows"]:
        tags = " ".join(f"#{t}" for t in r["tags"])
        print(f"- {r['id']}  [{r['state']}] {r['published'] or '—'}  {r['title']}  {tags}".rstrip())
        print(f"    {r['url']}")
        if r["summary"]:
            print(f"    {r['summary']}")


def parser():
    p = argparse.ArgumentParser(prog="sources.py", description=__doc__.split("\n\n")[0])
    cmd = p.add_subparsers(dest="cmd", required=True)
    c = cmd.add_parser("show")
    c.add_argument("ref", nargs="?")
    c.add_argument("--json", action="store_true")

    src = cmd.add_parser("source").add_subparsers(dest="sub", required=True)
    for name in ("add", "edit"):
        c = src.add_parser(name)
        c.add_argument("ref" if name == "edit" else "name")
        if name == "edit":
            c.add_argument("--name")
        c.add_argument("--description")
        c.add_argument("--link", action="append")
        c.add_argument("--instructions")
        c.add_argument("--instructions-file")
        if name == "add":
            c.add_argument("--disabled", action="store_true")
        else:
            g = c.add_mutually_exclusive_group()
            g.add_argument("--enable", action="store_true")
            g.add_argument("--disable", action="store_true")
    c = src.add_parser("rm")
    c.add_argument("ref")

    c = cmd.add_parser("items")
    c.add_argument("--source")
    c.add_argument("--state", choices=["new", "read", "used", "discarded", "pending"])
    c.add_argument("--tag")
    c.add_argument("--q")
    c.add_argument("--since-days", type=int)
    c.add_argument("--limit", type=int, default=30)
    c.add_argument("--json", action="store_true")
    c = cmd.add_parser("item")
    c.add_argument("id")

    c = cmd.add_parser("add")
    c.add_argument("--source", required=True)
    c.add_argument("--title", required=True)
    c.add_argument("--url", required=True)
    c.add_argument("--published")
    c.add_argument("--summary")
    c.add_argument("--tag", action="append")
    c.add_argument("--link", action="append")
    c.add_argument("--markdown")
    c.add_argument("--markdown-file")
    c.add_argument("--update", action="store_true")
    c = cmd.add_parser("edit")
    c.add_argument("id")
    c.add_argument("--state", choices=["new", "read", "used", "discarded"])
    c.add_argument("--title")
    c.add_argument("--summary")
    c.add_argument("--published")
    c.add_argument("--tag", action="append")
    c.add_argument("--markdown-file")
    c = cmd.add_parser("rm")
    c.add_argument("id")

    c = cmd.add_parser("done")
    c.add_argument("ref")
    c.add_argument("--added", type=int, default=0)
    g = c.add_mutually_exclusive_group()
    g.add_argument("--note")
    g.add_argument("--error")

    c = cmd.add_parser("apify")
    c.add_argument("actor")
    c.add_argument("--input", default="{}")
    c.add_argument("--max-items", type=int, default=20)
    c.add_argument("--out")
    return p


def fields(**kw):
    return {k: v for k, v in kw.items() if v is not None}


def main():
    a = parser().parse_args()
    if a.cmd == "show":
        view = call("GET", "/api/sources")
        if a.json:
            print(json.dumps(view if not a.ref else [s for s in view["sources"] if s["id"] == a.ref or s["name"].lower() == a.ref.lower()], ensure_ascii=False, indent=2))
        else:
            show_sources(view, a.ref)
        return

    if a.cmd == "source":
        if a.sub == "rm":
            call("DELETE", f"/api/sources/{seg(a.ref)}")
            return print("Fuente borrada, con sus resultados.")
        body = fields(
            description=a.description,
            links=a.link,
            instructions=text_or_file(a.instructions, a.instructions_file),
        )
        if a.sub == "add":
            body["name"] = a.name
            if a.disabled:
                body["enabled"] = False
            view = call("POST", "/api/sources", body)
            return show_sources(view, a.name)
        if a.name:
            body["name"] = a.name
        if a.enable or a.disable:
            body["enabled"] = bool(a.enable)
        call("PUT", f"/api/sources/{seg(a.ref)}", body)
        return show_sources(call("GET", "/api/sources"), a.name or a.ref)

    if a.cmd == "items":
        lst = call("GET", "/api/source-items", source=a.source, state=a.state, tag=a.tag, q=a.q, sinceDays=a.since_days, size=a.limit)
        return print(json.dumps(lst, ensure_ascii=False, indent=2)) if a.json else show_items(lst)

    if a.cmd == "item":
        r = call("GET", f"/api/source-items/{seg(a.id)}")
        print(f"# {r['title']}\n{r['url']}\nFuente: {r['source']} · publicado: {r['published'] or '—'} · extraído: {when(r['extracted'])} · estado: {r['state']} · etiquetas: {', '.join(r['tags']) or '—'}")
        for l in r["links"]:
            print(f"- {l['label']} | {l['url']}")
        if r["summary"]:
            print(f"\n{r['summary']}")
        return print(f"\n{r['markdown']}" if r["markdown"] else "\n(sin contenido)")

    if a.cmd == "add":
        body = fields(
            source=a.source,
            title=a.title,
            url=a.url,
            published=a.published,
            summary=a.summary,
            tags=a.tag,
            links=a.link,
            markdown=text_or_file(a.markdown, a.markdown_file),
            update=True if a.update else None,
        )
        r = call("POST", "/api/source-items", body)
        it = r["item"]
        if r.get("created"):
            return print(f"Guardado: {it['id']}  {it['title']}")
        if r.get("updated"):
            return print(f"Ya existía y se actualizó: {it['id']}  {it['title']}")
        return print(f"Ya existía (no se guardó otra vez): {it['id']}  {it['title']}")

    if a.cmd == "edit":
        body = fields(state=a.state, title=a.title, summary=a.summary, published=a.published, tags=a.tag, markdown=read_file(a.markdown_file) if a.markdown_file else None)
        it = call("PUT", f"/api/source-items/{seg(a.id)}", body)
        return print(f"Cambiado: {it['id']}  [{it['state']}] {it['title']}")

    if a.cmd == "rm":
        call("DELETE", f"/api/source-items/{seg(a.id)}")
        return print("Resultado borrado.")

    if a.cmd == "done":
        body = {"added": a.added, "ok": a.error is None, "note": a.error or a.note or ""}
        call("POST", f"/api/sources/{seg(a.ref)}/done", body)
        return print("Anotado.")

    if a.cmd == "apify":
        try:
            actor_input = json.loads(a.input)
        except ValueError as e:
            sys.exit(f"error: --input no es JSON válido: {e}")
        items = call("POST", "/api/sources/apify", {"actor": a.actor, "input": actor_input, "maxItems": a.max_items}, timeout=340)
        out = json.dumps(items, ensure_ascii=False, indent=2)
        if a.out:
            with open(a.out, "w", encoding="utf-8") as f:
                f.write(out)
            return print(f"{len(items)} ítems en {a.out}")
        return print(out)


main()

#!/usr/bin/env python3
"""Investigación, for the agent: what short videos work on a topic in TikTok, YouTube Shorts and Instagram, for the
project's audience, through Reel Studio (the page follows every change).

    research.py list                                  (the project's researches)
    research.py show <id> [--top N] [--all] [--json]  (its searches, how each platform went, the ranking and the report)
    research.py new "tema" [--platform tiktok,youtube,instagram] [--since DÍAS] [--max-seconds S] [--per-query N]
                           [--country CO] [--query "…"]… (without --query, Reel Studio's agent proposes the searches)
    research.py new --from <id> ["otro tema"] [--query "…"]… [--platform …] […]
                                                      (a copy: its topic, searches and options, with what you change)
    research.py edit <id> [--topic "…"] [--query "…"]… (replaces them) [--platform …] [--since DÍAS] [--country CO]
                                                      (only before its search: a searched one doesn't change nor
                                                      search again, new --from makes another)
    research.py cost <id>                             (what a search would cost at most; spends nothing)
    research.py search <id> [--wait]                  (once; spends: ScrapeCreators' credits, Apify's balance)
    research.py analyse <id> [--top N | KEY…] [--wait] (downloads, transcribes and analyses; then the report)
    research.py report <id> [--wait]                  (the report again, from what's there)
    research.py relevant <id> KEY yes|no              (it is, or isn't, for his audience)
    research.py status <id> | wait <id> | stop <id> | rm <id>

DÍAS: 7, 30, 90, 180, 365 or 0 (any time). A video's KEY is "<platform>-<id>" (as show lists them). The ranking's
score (0–100) is how a video does against the rest of the research on views, views per day, views over its author's
followers and interaction. Searching spends from his balance: say what cost says and wait for his yes. Analysing uses
his agent's subscription: ask before more than 5. The project is the agent's own (REEL_STUDIO_PROJECT), else the open
one. Needs Reel Studio running (REEL_STUDIO_URL).
"""
import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = os.environ.get("REEL_STUDIO_URL", "http://127.0.0.1:4000").rstrip("/")
PROJECT = os.path.basename(os.environ.get("REEL_STUDIO_PROJECT", "").rstrip("/\\"))
STAGES = {"queries": "proponiendo búsquedas", "searching": "buscando", "filtering": "filtrando lo que le sirve a tu audiencia", "processing": "bajando y transcribiendo", "analyzing": "analizando", "report": "escribiendo el informe"}


def call(method, path, body=None, timeout=60):
    url = BASE + path + (("?" + urllib.parse.urlencode({"project": PROJECT})) if PROJECT else "")
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


def n(v):
    return "—" if v is None else f"{round(v):,}".replace(",", ".")


def when(ms):
    import datetime

    return datetime.datetime.fromtimestamp(ms / 1000).strftime("%Y-%m-%d %H:%M") if ms else "nunca"


def job_line(r):
    j = r.get("job")
    if not j:
        return None
    total = f" {j['done']}/{j['total']}" if j.get("total") else ""
    return f"trabajando: {STAGES.get(j['stage'], j['stage'])}{total}"


def head(r):
    c = r["counts"]
    o = r["options"]
    print(f"{r['id']}  «{r['topic']}»")
    print(f"  búsquedas: {' · '.join(r['queries'])}")
    print(f"  plataformas: {', '.join(o['platforms'])} · últimos {o['sinceDays'] or 'todos los'} días · hasta {o['maxSeconds']} s · país {o.get('country') or '—'}")
    print(f"  {c['videos']} videos · {c['relevant']} útiles · {c['analysed']} analizados · buscada {when(r.get('searched'))}")
    for run in r.get("runs") or []:
        print(f"  {run['platform']}: {run['found']} videos · {run['cost']}{' · ' + run['error'] if run.get('error') else ''}")
    if job_line(r):
        print(f"  {job_line(r)}")
    if r.get("error"):
        print(f"  error: {r['error']}")


def video_line(v):
    ratio = f" · {v['ratio']:.1f}× seguidores" if v.get("ratio") is not None else ""
    eng = f" · {v['engagement'] * 100:.1f}% interacción" if v.get("engagement") is not None else ""
    rel = "" if v.get("relevant") is not False else f" · NO útil ({v.get('reason') or 'sin razón'})"
    state = {"ready": " · analizado", "error": f" · error: {v.get('error')}", "processing": " · bajando", "analyzing": " · analizando"}.get(v["state"], "")
    title = " ".join((v.get("title") or "").split())[:110]
    return f"{v.get('score') if v.get('score') is not None else '—':>3}  {v['key']}  @{v['author']} · {n(v.get('views'))} vistas · {n(v.get('perDay'))}/día{ratio}{eng} · {(v.get('posted') or '')[:10]}{rel}{state}\n     {title}"


def wait(rid, quiet=False, minutes=15):
    last = None
    deadline = time.time() + minutes * 60
    while True:
        r = call("GET", f"/api/research/{rid}")
        line = job_line(r)
        if not line:
            return r
        if time.time() > deadline:
            print(f"sigue trabajando después de {minutes} min ({line}); mira más tarde con: research.py status {rid}")
            return r
        if line != last and not quiet:
            print(line, flush=True)
            last = line
        time.sleep(3)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list")
    s = sub.add_parser("show")
    s.add_argument("id")
    s.add_argument("--top", type=int, default=15)
    s.add_argument("--all", action="store_true", help="también los que no le sirven a su audiencia")
    s.add_argument("--json", action="store_true")
    s = sub.add_parser("new")
    s.add_argument("topic", nargs="?")
    s.add_argument("--from", dest="source", metavar="ID", help="copia esa investigación (tema, búsquedas, opciones)")
    s.add_argument("--country")
    s.add_argument("--platform")
    s.add_argument("--since", type=int)
    s.add_argument("--max-seconds", type=int)
    s.add_argument("--per-query", type=int)
    s.add_argument("--query", action="append")
    s = sub.add_parser("edit")
    s.add_argument("id")
    s.add_argument("--topic")
    s.add_argument("--query", action="append")
    s.add_argument("--platform")
    s.add_argument("--since", type=int)
    s.add_argument("--max-seconds", type=int)
    s.add_argument("--per-query", type=int)
    s.add_argument("--country")
    for c in ("cost", "status", "stop", "rm"):
        sub.add_parser(c).add_argument("id")
    s = sub.add_parser("wait")
    s.add_argument("id")
    for c in ("search", "report"):
        s = sub.add_parser(c)
        s.add_argument("id")
        s.add_argument("--wait", action="store_true")
    s = sub.add_parser("analyse")
    s.add_argument("id")
    s.add_argument("keys", nargs="*")
    s.add_argument("--top", type=int)
    s.add_argument("--wait", action="store_true")
    s = sub.add_parser("relevant")
    s.add_argument("id")
    s.add_argument("key")
    s.add_argument("answer", choices=["yes", "no", "si", "sí"])
    a = p.parse_args()

    def options():
        o = {}
        if a.platform:
            o["platforms"] = [x.strip() for x in a.platform.split(",") if x.strip()]
        if a.since is not None:
            o["sinceDays"] = a.since
        if a.max_seconds is not None:
            o["maxSeconds"] = a.max_seconds
        if a.per_query is not None:
            o["perQuery"] = a.per_query
        return o

    if a.cmd == "list":
        rs = call("GET", "/api/research")["researches"]
        if not rs:
            print("Todavía no hay investigaciones en este proyecto.")
        for r in rs:
            c = r["counts"]
            extra = f" · {job_line(r)}" if job_line(r) else ""
            print(f"{r['id']}  «{r['topic']}» · {c['videos']} videos, {c['relevant']} útiles, {c['analysed']} analizados · {'con informe' if r.get('report') else 'sin informe'} · buscada {when(r.get('searched'))}{extra}")
    elif a.cmd == "show":
        r = call("GET", f"/api/research/{a.id}")
        if a.json:
            print(json.dumps(r, ensure_ascii=False, indent=1))
            return
        head(r)
        vs = [v for v in r["videos"] if a.all or v.get("relevant") is not False]
        print(f"\nRanking ({len(vs)} videos; puntaje 0–100):")
        for v in vs[: a.top]:
            print(video_line(v))
        if r.get("report"):
            print(f"\nInforme ({when(r['report']['at'])}):\n\n{r['report']['text']}")
        print(f"\nArchivos: projects/<proyecto>/research/{a.id}/ (research.json; videos/<clave>/reel.json, analysis.json, transcript.json)")
    elif a.cmd == "new":
        if a.source:
            src = call("GET", f"/api/research/{a.source}")
            body = {"topic": a.topic or src["topic"], **src["options"], **options(), "queries": a.query or src["queries"]}
        elif not a.topic:
            sys.exit('research.py new: falta el tema (o --from <id> para copiar una)')
        else:
            body = {"topic": a.topic, **options()}
            if a.query:
                body["queries"] = a.query
        if a.country is not None:
            body["country"] = a.country
        r = call("POST", "/api/research", body)
        if "queries" not in body:
            print("El agente de Reel Studio está proponiendo las búsquedas…", flush=True)
            r = wait(r["id"], quiet=True)
        head(r)
        print(f"\nCosto de buscar: research.py cost {r['id']}")
    elif a.cmd == "edit":
        body = {}
        if a.topic:
            body["topic"] = a.topic
        if a.query:
            body["queries"] = a.query
        o = options()
        if a.country is not None:
            o["country"] = a.country
        if o:
            body["options"] = o
        head(call("PUT", f"/api/research/{a.id}", body))
    elif a.cmd == "cost":
        e = call("POST", f"/api/research/{a.id}/estimate", {})
        for line in e["lines"]:
            print(f"{line['platform']}: {line['text']}")
        print(f"total: como mucho ≈ {e['usd']} US$")
    elif a.cmd == "search":
        call("POST", f"/api/research/{a.id}/search", {})
        print("Buscando en segundo plano.")
        if a.wait:
            head(wait(a.id))
    elif a.cmd == "analyse":
        body = {"keys": a.keys} if a.keys else {"top": a.top or 5}
        call("POST", f"/api/research/{a.id}/analyse", body)
        print("Analizando en segundo plano (después escribe el informe).")
        if a.wait:
            r = wait(a.id)
            head(r)
            if r.get("report"):
                print(f"\n{r['report']['text']}")
    elif a.cmd == "report":
        call("POST", f"/api/research/{a.id}/report", {})
        if a.wait:
            r = wait(a.id)
            print(r["report"]["text"] if r.get("report") else f"error: {r.get('error') or 'sin informe'}")
        else:
            print("Escribiendo el informe en segundo plano.")
    elif a.cmd == "relevant":
        call("PUT", f"/api/research/{a.id}/videos/{a.key}", {"relevant": a.answer != "no"})
        print("ok")
    elif a.cmd == "status":
        head(call("GET", f"/api/research/{a.id}"))
    elif a.cmd == "wait":
        head(wait(a.id))
    elif a.cmd == "stop":
        call("POST", f"/api/research/{a.id}/stop", {})
        print("detenida")
    elif a.cmd == "rm":
        call("DELETE", f"/api/research/{a.id}")
        print("borrada")


if __name__ == "__main__":
    main()

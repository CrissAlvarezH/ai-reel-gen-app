# The social-media scraper for the agent: Instagram reels and profiles, through Reel Studio (which uses the
# scraper chosen in Ajustes → Extracción de datos, Apify or ScrapeCreators, and its key). Each call spends
# from the creator's balance and prints what it cost at most; "cost" says it without spending.
# usage: social.py mine [n]              his own n newest reels (Mi cuenta): saved to account/<user>/ and listed
#        social.py reels @account [n]    another account's n newest reels (not saved)
#        social.py reel <url>            one reel
#        social.py profile @account      followers, bio…
#        social.py cost reels|reel|profile [n]
# And the analysis of his own reels (Mi cuenta → Analizar; it spends from his Claude subscription, not the
# scraper's balance: each video is downloaded, transcribed and analysed by the agent, in the background):
#        social.py analyse <code> [code…]  those reels (again if they were analysed)
#        social.py analyse pending       every reel not analysed yet (and those that failed)
#        social.py analyse status        what's running, how many are analysed and which failed
#        social.py analyse wait          wait until what's running ends (up to 9 min), then the status
#        social.py analyse stop          stop what's running
# And the analysis of Inspiración's accounts (the other accounts this project studies; also his Claude subscription,
# in the background; when it ends the account's general analysis is redone with them):
#        social.py inspiration analyse @account top [n]     its n best reels by Multiplicador (5), those missing
#                                                          (Inspiración → Destacados → Analizar)
#        social.py inspiration analyse @account pending     every reel of it not analysed yet
#        social.py inspiration analyse @account <code…>     those reels, if not analysed yet
#        social.py inspiration analyse status [@account]    what's running and how many are analysed
#        social.py inspiration analyse wait [@account]      wait until it ends (up to 9 min), then the status
#        social.py inspiration analyse stop @account        stop it
# Needs Reel Studio running (REEL_STUDIO_URL, set for its agents; default http://127.0.0.1:4000).
import json, os, sys, urllib.error, urllib.request

BASE = os.environ.get("REEL_STUDIO_URL", "http://127.0.0.1:4000").rstrip("/")


# The project of the agent running this (Reel Studio refuses Mi cuenta's routes if another one is open now).
PROJECT = os.path.basename(os.environ.get("REEL_STUDIO_PROJECT", "").rstrip("/\\"))
HEADERS = {"Content-Type": "application/json", **({"X-Reel-Studio-Project": PROJECT} if PROJECT else {})}


def call(path, body=None):
    req = urllib.request.Request(BASE + path, data=None if body is None else json.dumps(body).encode(), headers=HEADERS, method="GET" if body is None else "POST")
    try:
        return json.load(urllib.request.urlopen(req, timeout=20 * 60))
    except urllib.error.HTTPError as e:
        try:
            msg = json.load(e).get("error")
        except ValueError:
            msg = None
        sys.exit(f"error: {msg or f'Reel Studio respondió {e.code}'}")
    except urllib.error.URLError:
        sys.exit(f"error: Reel Studio no responde en {BASE}; ¿está abierto?")


def n(v):
    return "—" if v is None else f"{v:,}".replace(",", ".")


def show(reels, median=None):
    for r in reels:
        ratio = f" ×{r['views'] / median:.1f}" if median and r.get("views") is not None else ""
        er = f" · {((r.get('likes') or 0) + (r.get('comments') or 0)) / r['views'] * 100:.1f}% interacción" if r.get("views") else ""
        dur = f" · {r['duration']:.0f}s" if r.get("duration") else ""
        cap = " ".join((r.get("caption") or "").split())[:140]
        print(f"{(r.get('posted') or '')[:10]}  {r.get('code')}  {n(r.get('views'))} vistas{ratio} · {n(r.get('likes'))} likes · {n(r.get('comments'))} coment.{dur}{er}\n   {cap}")


args = sys.argv[1:]
if not args:
    sys.exit("usage: social.py mine [n] | reels @cuenta [n] | reel <url> | profile @cuenta | cost reels|reel|profile [n] | analyse <código…>|pending|status|wait|stop")
cmd, rest = args[0], args[1:]
num = lambda i, d: int(rest[i]) if len(rest) > i else d

if cmd == "mine":
    lim = num(0, 10)
    est = call("/api/account/estimate", {"limit": lim})
    st = call("/api/account/fetch", {"limit": lim})
    rows = call(f"/api/account/reels?sort=posted&size={min(lim, 100)}")["rows"]
    print(f"@{st['username']}: {st['count']} reels en account/{st['username']}/ · mediana {n(st['median'])} vistas")
    p = st.get("profile") or {}
    if p:
        print(f"perfil: {n(p.get('followers'))} seguidores · {n(p.get('posts'))} publicaciones")
    if st.get("error"):
        print(f"aviso: {st['error']}")
    show(rows, st.get("median"))
    print(f"\nCosto: {est['charge']}.")
elif cmd == "reels":
    if not rest:
        sys.exit("usage: social.py reels @cuenta [n]")
    r = call("/api/social/reels", {"account": rest[0], "limit": num(1, 12)})
    vs = sorted(x["views"] for x in r["reels"] if x.get("views") is not None)
    med = vs[len(vs) // 2] if len(vs) >= 5 else None
    print(f"@{r['account']}: {len(r['reels'])} reels · mediana {n(med)} vistas")
    if r.get("problem"):
        print(f"aviso: {r['problem']}")
    show(r["reels"], med)
    print(f"\nCosto: {r['charge']}.")
elif cmd == "reel":
    if not rest:
        sys.exit("usage: social.py reel <url>")
    r = call("/api/social/reel", {"url": rest[0]})
    if r.get("problem"):
        print(f"aviso: {r['problem']}")
    for x in r["reels"]:
        print(f"@{x.get('owner')}")
    show(r["reels"])
    print(f"\nCosto: {r['charge']}.")
elif cmd == "profile":
    if not rest:
        sys.exit("usage: social.py profile @cuenta")
    est = call("/api/social/cost", {"kind": "profile"})
    r = call("/api/social/profile", {"account": rest[0]})
    print(json.dumps(r, ensure_ascii=False, indent=1))
    print(f"\nCosto: {est['charge']}.")
elif cmd == "analyse":
    import time

    STATES = {"pending": "sin analizar", "processed": "sin analizar (transcrito)", "queued": "en cola", "processing": "transcribiendo", "analyzing": "analizando", "ready": "analizado", "error": "error"}

    def reels():
        out, page = [], 0
        while True:
            r = call(f"/api/account/reels?sort=posted&size=100&page={page}")
            out += r["rows"]
            page += 1
            if len(out) >= r["total"] or not r["rows"]:
                return out

    def status():
        st = call("/api/account")
        rs = reels()
        a = st.get("analysis")
        print(f"@{st['username']}: {sum(r['state'] == 'ready' for r in rs)} de {len(rs)} reels analizados." + (f" En marcha: {a['done']} de {a['total']} terminados." if a else " Nada en marcha."))
        for r in rs:
            if r["state"] in ("queued", "processing", "analyzing"):
                print(f"  {r['code']}  {STATES[r['state']]}")
        for r in rs:
            if r["state"] == "error":
                print(f"  {r['code']}  error: {r['error']}")
        if not st.get("transcriber"):
            print("aviso: falta la transcripción (Ajustes → Requisitos → Transcripción): los reels sin transcribir no se pueden analizar.")
        print("Los análisis están en el índice (own_reels con state = 'ready', own_beats) y en analysis.json de cada reel.")
        return a

    what = rest[0] if rest else "status"
    if what == "status":
        status()
    elif what == "wait":
        end = time.time() + 9 * 60
        while call("/api/account").get("analysis") and time.time() < end:
            time.sleep(10)
        if status():
            print("Sigue en marcha: vuelve a esperar con «analyse wait».")
    elif what == "stop":
        call("/api/account/reels/stop", {})
        print("Detenido: lo que estaba en cola no empieza y lo que estaba en marcha se paró.")
        status()
    else:
        body = {"all": True} if what == "pending" else {"codes": rest}
        r = call("/api/account/reels/analyse", body)
        print(f"{r['queued']} reel{'s' if r['queued'] != 1 else ''} en cola: se transcriben y el agente los analiza en segundo plano (tarda uno o dos minutos cada uno). Espera con «analyse wait».")
elif cmd == "inspiration":
    import time

    STAGES = {"fetching": "descargando", "processing": "transcribiendo", "analyzing": "analizando reels", "summary": "rehaciendo el análisis general"}
    args = rest[1:] if rest and rest[0] == "analyse" else sys.exit("uso: social.py inspiration analyse @cuenta top [n] | pending | <code…> | status | wait | stop")

    def accounts():
        return [a for a in call("/api/inspiration")["accounts"] if a["followed"]]

    def account(u):
        u = u.lstrip("@").lower()
        a = next((a for a in accounts() if a["username"].lower() == u), None)
        return a or sys.exit(f"error: @{u} no es una cuenta escaneada en Inspiración")

    def status(only=None):
        running = False
        for a in [only] if only else accounts():
            c = call(f"/api/inspiration/list/{a['username']}?size=1")["counts"]
            total = sum(c.values())
            job = a.get("job")
            running = running or bool(job)
            line = f"@{a['username']}: {c.get('ready', 0)} de {total} reels analizados"
            if job:
                line += f". En marcha: {STAGES.get(job['stage'], job['stage'])}" + (f", {job['done']} de {job['total']}" if job["total"] > 1 else "")
            if c.get("error"):
                line += f". {c['error']} con error"
            if a.get("error"):
                line += f". Aviso: {a['error']}"
            print(line + ".")
        print("Los análisis están en el índice (tablas de Inspiración, ver studio_sql.py --schema), en analysis.json de cada reel y el general en account.json (analysis.text).")
        return running

    what = args[0] if args else "status"
    if what in ("status", "wait", "stop"):
        only = account(args[1]) if len(args) > 1 else None
        if what == "stop":
            if not only:
                sys.exit("uso: social.py inspiration analyse stop @cuenta")
            call(f"/api/inspiration/accounts/{only['username']}/stop", {})
            print(f"Detenido @{only['username']}.")
            only = account(only["username"])
        if what == "wait":
            end = time.time() + 9 * 60
            busy = lambda: any(a.get("job") for a in ([account(only["username"])] if only else accounts()))
            while busy() and time.time() < end:
                time.sleep(10)
            only = account(only["username"]) if only else None
        if status(only) and what == "wait":
            print("Sigue en marcha: vuelve a esperar con «inspiration analyse wait».")
    else:
        a = account(what)
        u, how = a["username"], args[1:] or sys.exit("dime qué analizar: top [n], pending o los códigos")
        if how[0] == "top":
            n = int(how[1]) if len(how) > 1 else 5
            rows = call(f"/api/inspiration/list/{u}?sort=ratio&desc=true&page=0&size={n}&minRatio=1")["rows"]
            done = set((a.get("analysis") or {}).get("codes") or [])
            codes = [r["code"] for r in rows if r["state"] != "ready" or (done and r["code"] not in done)]
            if not rows:
                sys.exit(f"@{u} no tiene reels por encima de su mediana todavía.")
            if not codes:
                sys.exit(f"Los {len(rows)} destacados de @{u} ya están analizados y en su análisis general.")
            body = {"codes": codes}
        elif how[0] == "pending":
            body, codes = {}, None
        else:
            body, codes = {"codes": how}, how
        call(f"/api/inspiration/accounts/{u}/process", body)
        print(f"@{u}: en marcha ({len(codes)} reel{'s' if len(codes) != 1 else ''}: {' '.join(codes)})." if codes else f"@{u}: en marcha con todos los que faltan.", "Se transcriben, el agente los analiza y luego rehace el análisis general de la cuenta. Espera con «inspiration analyse wait @" + u + "».")
elif cmd == "cost":
    kind = rest[0] if rest else "reels"
    r = call("/api/social/cost", {"kind": kind, "limit": int(rest[1]) if len(rest) > 1 else 12})
    print(f"{r['charge']}.")
else:
    sys.exit(f"no conozco «{cmd}»: mine, reels, reel, profile, cost, analyse o inspiration")

# Search Openverse (openverse.org, by WordPress) for openly licensed images: one search over Flickr, NASA,
# Wikimedia, museums and more. Only licenses that allow commercial use and changes (CC0, public domain, CC BY,
# CC BY-SA), since collages modify the photos. No key: 20 requests a minute, 200 a day; a search can take
# up to a minute.
# usage: openverse.py "query" [n]           -> license, size, title, author, source, id, page
#        openverse.py --get <id> <out.jpg>  -> downloads it and prints the credit line for CREDITS.md
import json, sys, time, urllib.error, urllib.parse, urllib.request
from keys import source_on

if not source_on("openverse"):
    sys.exit("Openverse está desactivada en Reel Studio → Ajustes → Extracción de datos → Imágenes.")
H = {"User-Agent": "reel-studio/1.0 (narrated explainer videos)"}
API = "https://api.openverse.org/v1/images/"


def api(url, tries=2):
    """Openverse is slow at times and now and then answers 500: one more try for those."""
    for i in range(tries):
        try:
            return json.load(urllib.request.urlopen(urllib.request.Request(url, headers=H), timeout=90))
        except urllib.error.HTTPError as e:
            if e.code == 429:
                sys.exit("Openverse: límite de peticiones alcanzado (20 por minuto, 200 al día); espera un poco.")
            if e.code < 500 or i == tries - 1:
                sys.exit(f"Openverse respondió {e.code}; inténtalo otra vez o usa otra fuente.")
        except TimeoutError:
            if i == tries - 1:
                sys.exit("Openverse no respondió en 90 s; inténtalo otra vez o usa otra fuente.")
        time.sleep(3)


if sys.argv[1] == "--get":
    iid, out = sys.argv[2], sys.argv[3]
    p = api(API + urllib.parse.quote(iid) + "/")
    with urllib.request.urlopen(urllib.request.Request(p["url"], headers=H), timeout=60) as r, open(out, "wb") as f:
        f.write(r.read())
    print(f"{out}\n{p['attribution']} Fuente: {p['source']} ({p['foreign_landing_url']}) vía Openverse")
else:
    q, n = sys.argv[1], min(int(sys.argv[2]) if len(sys.argv) > 2 else 8, 20)
    res = api(API + "?" + urllib.parse.urlencode({"q": q, "page_size": n, "license": "cc0,pdm,by,by-sa", "mature": "false"}))
    for p in res.get("results", []):
        lic = f"{p['license'].upper()} {p.get('license_version') or ''}".strip()
        size = f"{p['width']}x{p['height']}" if p.get("width") else "?"
        print(f"{lic:10} {size:>9} {(p.get('title') or '')[:60]} — {p.get('creator') or '?'} [{p['source']}]\n   id {p['id']}  {p['foreign_landing_url']}")

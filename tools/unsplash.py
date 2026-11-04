# Search Unsplash for free photos (Unsplash license: free to use and modify; credit the photographer and Unsplash).
# usage: unsplash.py "query" [n]           -> id, size, description, photographer, page
#        unsplash.py --get <id> <out.jpg>  -> downloads it and prints the credit line for CREDITS.md
# Always download with --get: Unsplash's API terms ask to report each download. Needs UNSPLASH_ACCESS_KEY.
import json, sys, urllib.parse, urllib.request
from keys import key, source_on

if not source_on("unsplash"):
    sys.exit("Unsplash está desactivada en Reel Studio → Ajustes → Extracción de datos → Imágenes.")
H = {"Authorization": f"Client-ID {key('UNSPLASH_ACCESS_KEY')}", "Accept-Version": "v1", "User-Agent": "reel-studio/1.0"}
api = lambda url: json.load(urllib.request.urlopen(urllib.request.Request(url, headers=H), timeout=30))

if sys.argv[1] == "--get":
    pid, out = sys.argv[2], sys.argv[3]
    p = api(f"https://api.unsplash.com/photos/{urllib.parse.quote(pid)}")
    url = api(p["links"]["download_location"])["url"]  # reports the download, returns the file's URL
    urllib.request.urlretrieve(url, out)
    print(f"{out}\nFoto de {p['user']['name']} en Unsplash ({p['links']['html']}) — Licencia Unsplash")
else:
    q, n = sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 8
    res = api("https://api.unsplash.com/search/photos?" + urllib.parse.urlencode({"query": q, "per_page": n}))
    for p in res.get("results", []):
        desc = (p.get("description") or p.get("alt_description") or "")[:60]
        print(f"Unsplash {p['width']}x{p['height']} {desc} — {p['user']['name']}\n   id {p['id']}  {p['links']['html']}")

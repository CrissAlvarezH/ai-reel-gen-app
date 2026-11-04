# Search Pexels for free photos (Pexels license: free to use and modify, credit not required but kind).
# usage: pexels.py "query" [n]   -> licence, size, description, photographer, file URL and page
# Download the file URL directly (add ?w=1600 for a lighter copy). Needs PEXELS_API_KEY (Ajustes → Extracción de datos → Imágenes).
import json, sys, urllib.parse, urllib.request
from keys import key, source_on

if not source_on("pexels"):
    sys.exit("Pexels está desactivada en Reel Studio → Ajustes → Extracción de datos → Imágenes.")
q, n = sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 8
u = "https://api.pexels.com/v1/search?" + urllib.parse.urlencode({"query": q, "per_page": n})
req = urllib.request.Request(u, headers={"Authorization": key("PEXELS_API_KEY"), "User-Agent": "reel-studio/1.0"})
for p in json.load(urllib.request.urlopen(req, timeout=30)).get("photos", []):
    print(f"Pexels   {p['width']}x{p['height']} {(p.get('alt') or '')[:60]} — {p['photographer']}\n   {p['src']['original']}\n   {p['url']}")

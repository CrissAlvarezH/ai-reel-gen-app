# Search Pixabay for free photos, illustrations and vectors (Pixabay license: free to use and modify, credit
# not required; don't resell them unaltered). Vectors and illustrations make good collage cutouts.
# usage: pixabay.py "query" [n] [photo|illustration|vector|all]  -> size, tags, author, file URL and page
# Download the file URL (up to 1280 px) to assets/src/: Pixabay doesn't allow linking to it. Needs PIXABAY_API_KEY.
import json, sys, urllib.error, urllib.parse, urllib.request
from keys import key, source_on

if not source_on("pixabay"):
    sys.exit("Pixabay está desactivada en Reel Studio → Ajustes → Extracción de datos → Imágenes.")
q = sys.argv[1]
n = max(3, min(int(sys.argv[2]) if len(sys.argv) > 2 else 8, 200))  # the API takes 3–200
kind = sys.argv[3] if len(sys.argv) > 3 else "all"
u = "https://pixabay.com/api/?" + urllib.parse.urlencode({"key": key("PIXABAY_API_KEY"), "q": q[:100], "per_page": n, "image_type": kind, "safesearch": "true"})
try:
    res = json.load(urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": "reel-studio/1.0"}), timeout=30))
except urllib.error.HTTPError as e:
    sys.exit("Pixabay: límite de peticiones alcanzado (100 por minuto); espera un poco." if e.code == 429 else f"Pixabay respondió {e.code}: {e.read()[:200].decode(errors='replace')}")
for p in res.get("hits", []):
    print(f"Pixabay  {p['type']:12} {p['imageWidth']}x{p['imageHeight']} {p['tags'][:60]} — {p['user']}\n   {p['largeImageURL']}\n   {p['pageURL']}")

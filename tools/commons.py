# Search Wikimedia Commons for freely licensed photos. usage: commons.py "query" [n]
import json, sys, urllib.parse, urllib.request
from keys import source_on

if not source_on("commons"):
    sys.exit("Wikimedia Commons está desactivada en Reel Studio → Ajustes → Extracción de datos → Imágenes.")
q, n = sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 8
u = "https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode({
    "action": "query", "format": "json", "generator": "search", "gsrnamespace": 6, "gsrsearch": q + " filetype:bitmap",
    "gsrlimit": n, "prop": "imageinfo", "iiprop": "url|size|extmetadata", "iiurlwidth": 1600})
req = urllib.request.Request(u, headers={"User-Agent": "reel-studio/1.0 (narrated explainer videos)"})
for p in json.load(urllib.request.urlopen(req, timeout=30)).get("query", {}).get("pages", {}).values():
    ii = p["imageinfo"][0]; md = ii.get("extmetadata", {})
    lic = md.get("LicenseShortName", {}).get("value", "?")
    print(f"{lic:14} {ii['width']}x{ii['height']} {p['title'][5:70]}\n   {ii.get('thumburl', ii['url'])}")

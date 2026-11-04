# Generate an image with OpenAI, only when Reel Studio allows it (Ajustes → Extracción de datos → Imágenes → Imágenes generadas).
# usage: generate_image.py "prompt" out.png [size]   size: 1024x1536 (vertical, default), 1536x1024, 1024x1024
# Model: gpt-image-1, or OPENAI_IMAGE_MODEL. Needs OPENAI_API_KEY (Ajustes → Extracción de datos → Imágenes).
# Note it in CREDITS.md as generated (model and prompt).
import base64, json, os, sys, urllib.request
from keys import key, source_on

if not source_on("generated"):
    sys.exit("Las imágenes generadas están desactivadas en Reel Studio → Ajustes → Extracción de datos → Imágenes.")
prompt, out = sys.argv[1], sys.argv[2]
size = sys.argv[3] if len(sys.argv) > 3 else "1024x1536"
model = os.environ.get("OPENAI_IMAGE_MODEL", "gpt-image-1")
body = json.dumps({"model": model, "prompt": prompt, "size": size, "n": 1}).encode()
req = urllib.request.Request("https://api.openai.com/v1/images/generations", data=body,
                             headers={"Authorization": f"Bearer {key('OPENAI_API_KEY')}", "Content-Type": "application/json"})
res = json.load(urllib.request.urlopen(req, timeout=300))
open(out, "wb").write(base64.b64decode(res["data"][0]["b64_json"]))
print(out, f"({model}, {size})")

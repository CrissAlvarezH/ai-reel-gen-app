# Contact sheet of stills: python sheet.py out.png a.png b.png ...
# Each tile shades in red where the platform's interface covers a 1080x1920 frame (SHEET_UI=instagram|tiktok|youtube|none,
# default instagram): nothing important (captions, numbers, footnotes) may sit in red.
import os, sys
from PIL import Image, ImageDraw
# (x0, y0, x1, y1) on 1080x1920: top bar, bottom name/caption/audio, right action column.
# shortcut: measured against Reel Studio's preview, not every phone; widen them if a real post shows a clash.
UI = {
    "instagram": [(0, 0, 1080, 220), (0, 1500, 1080, 1920), (940, 1150, 1080, 1920)],
    "tiktok": [(0, 0, 1080, 200), (0, 1440, 1080, 1920), (920, 900, 1080, 1920)],
    "youtube": [(0, 0, 1080, 180), (0, 1480, 1080, 1920), (900, 950, 1080, 1920)],
    "none": [],
}
ui = os.environ.get("SHEET_UI", "instagram")
if ui not in UI: sys.exit(f"SHEET_UI must be one of {', '.join(UI)}")
files = sys.argv[2:]; W, H, cols = 360, 640, 5
rows = (len(files) + cols - 1) // cols
sheet = Image.new("RGB", (cols * W, rows * (H + 30)), "white")
for i, p in enumerate(files):
    im = Image.open(p).convert("RGB").resize((W, H))
    shade = Image.new("RGBA", (W, H)); d = ImageDraw.Draw(shade)
    for x0, y0, x1, y1 in UI[ui]:
        d.rectangle((x0 * W // 1080, y0 * H // 1920, x1 * W // 1080 - 1, y1 * H // 1920 - 1), fill=(255, 0, 0, 70), outline=(255, 0, 0, 200))
    im = Image.alpha_composite(im.convert("RGBA"), shade).convert("RGB")
    x, y = (i % cols) * W, (i // cols) * (H + 30)
    sheet.paste(im, (x, y + 30)); ImageDraw.Draw(sheet).text((x + 8, y + 8), p.split("/")[-1] + (f"  [{ui}]" if UI[ui] else ""), fill="black")
sheet.save(sys.argv[1])

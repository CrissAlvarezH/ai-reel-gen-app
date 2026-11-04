# Photo -> halftone paper cutout PNG (transparent bg, torn white border).
# usage: cutout.py src.jpg out.png [--cell 9] [--border 18] [--crop x0,y0,x1,y1] [--keep-hole x0,y0,x1,y1] [--contrast 1.3]
import argparse, numpy as np
from PIL import Image, ImageFilter, ImageOps
from scipy import ndimage
p = argparse.ArgumentParser()
p.add_argument("src"); p.add_argument("out")
p.add_argument("--cell", type=float, default=9); p.add_argument("--border", type=int, default=18)
p.add_argument("--crop"); p.add_argument("--contrast", type=float, default=1.35)
p.add_argument("--bluekey", type=float, default=0)  # also keep pixels whose B-R is below this (blue backdrop)
p.add_argument("--lineart", action="store_true")  # ink drawing: mask from ink, no halftone
p.add_argument("--inkmask", action="store_true")  # with --lineart: take the mask from rembg instead of the ink
p.add_argument("--rect", action="store_true")  # keep the whole (cropped) frame as one paper piece
p.add_argument("--pick", type=int, default=1)  # keep the N largest pieces
p.add_argument("--gamma", type=float, default=1.0)
p.add_argument("--seed", type=int, default=3); p.add_argument("--width", type=int, default=1400)
a = p.parse_args()
im = Image.open(a.src).convert("RGB")
if a.crop: im = im.crop(tuple(int(v) for v in a.crop.split(",")))
im = im.resize((a.width, int(im.height * a.width / im.width)), Image.LANCZOS)
if a.rect:
    mask = np.ones((im.height, im.width), bool); mask[:4] = mask[-4:] = False; mask[:, :4] = mask[:, -4:] = False
elif a.lineart and not a.inkmask:
    L = np.array(im.convert("L")).astype(np.float32) / 255
    inkm = L < 0.55
    mask = ndimage.binary_closing(ndimage.binary_dilation(inkm, iterations=5), iterations=2)
else:
    from rembg import remove, new_session
    mask = np.array(remove(im, session=new_session("isnet-general-use"), only_mask=True)).astype(np.float32) / 255
    mask = mask > 0.5
if a.bluekey:
    f = np.array(im).astype(np.float32); f = ndimage.gaussian_filter(f, (2, 2, 0))
    mask |= (f[..., 2] - f[..., 0]) < a.bluekey
mask = ndimage.binary_opening(mask, iterations=2); lab, n = ndimage.label(mask)
if n > 1:
    sizes = ndimage.sum(mask, lab, range(1, n + 1)); keep = np.argsort(sizes)[::-1][:a.pick] + 1
    mask = np.isin(lab, keep)
if not a.lineart: mask = ndimage.binary_fill_holes(mask)
# tone: grayscale, local contrast
g = np.array(ImageOps.autocontrast(im.convert("L"), cutoff=1)).astype(np.float32) / 255
g = np.clip((g ** a.gamma - 0.5) * a.contrast + 0.5, 0, 1)
H, W = g.shape; c = a.cell
# 45deg halftone: dot radius from darkness, sampled at cell centres
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
u, v = (xx + yy) / np.sqrt(2), (xx - yy) / np.sqrt(2)
cu, cv = (np.floor(u / c) + 0.5) * c, (np.floor(v / c) + 0.5) * c
cx, cy = (cu + cv) / np.sqrt(2), (cu - cv) / np.sqrt(2)
blur = ndimage.gaussian_filter(g, c / 2)
samp = ndimage.map_coordinates(blur, [np.clip(cy, 0, H - 1), np.clip(cx, 0, W - 1)], order=1)
r = np.sqrt(1 - samp) * c * 0.75
d = np.hypot(xx - cx, yy - cy)
ink = np.clip(r - d + 0.5, 0, 1)
ink = np.maximum(ink, (samp < 0.12).astype(np.float32))  # solid deep shadows
paper = np.array([236, 233, 226], np.float32)
if a.lineart:
    ink = np.clip((0.62 - ndimage.gaussian_filter(np.array(im.convert("L")).astype(np.float32) / 255, 0.6)) * 6, 0, 1)
rgb = paper * (1 - ink[..., None]) + np.array([18, 17, 16], np.float32) * ink[..., None]
# torn border: dilate mask, perturb edge with noise
rng = np.random.default_rng(a.seed); pad = a.border * 3
M = np.pad(mask, pad); rgb = np.pad(rgb, ((pad, pad), (pad, pad), (0, 0)), constant_values=245)
dist = ndimage.distance_transform_edt(~M)
noise = ndimage.gaussian_filter(rng.standard_normal(M.shape), 6) * 40 + ndimage.gaussian_filter(rng.standard_normal(M.shape), 1.5) * 6
outer = dist < (a.border + noise * a.border / 18)
if not a.lineart: outer = ndimage.binary_fill_holes(outer)
inner_noise = ndimage.gaussian_filter(rng.standard_normal(M.shape), 2) * 3
inner = ndimage.distance_transform_edt(M) > (1.5 + inner_noise)
out = np.full(M.shape + (3,), 248, np.float32); out[inner] = rgb[inner]
alpha = ndimage.gaussian_filter(outer.astype(np.float32), 0.7)
img = Image.fromarray(np.dstack([out, alpha * 255]).astype(np.uint8), "RGBA")
img = img.crop(img.getbbox()); img.save(a.out)
try:  # lossless PNG optimisation: same pixels, ~30% smaller
    import oxipng; oxipng.optimize(a.out, level=4, strip=oxipng.StripChunks.safe())
except ImportError:
    pass
print(a.out, img.size)

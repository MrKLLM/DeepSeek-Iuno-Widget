"""Make the Iuno pet sprite: assets/iuno-chibi-src.* -> assets/iuno-pet.png

Background removal strategy (v2 — magic wand):
  1. flood-fill FROM THE IMAGE BORDERS over near-white pixels: only white that
     is connected to the border is background. Interior whites (dress, skin
     highlights, eyes) are enclosed by dark outlines and stay intact.
  2. soften only the 1px outer edge ring with a partial alpha ramp, so the
     anti-aliased halo disappears without eating thin details.
  3. drop small *greyish* opaque islands (neighbouring-image slivers, border
     arcs) but keep coloured ones (the gold sparkles around her head).
  4. crop to the content bounding box (small margin) and save PNG.

Run:  python tools/make_pet_sprite.py [src_path]
Default src: assets/iuno-chibi-src.png (also tries .jpg/.jpeg/.webp)
"""
import os
import sys
from collections import deque

import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
OUT = os.path.join(ROOT, 'assets', 'iuno-pet.png')
CANDIDATES = [
    os.path.join(ROOT, 'assets', 'iuno-chibi-src.png'),
    os.path.join(ROOT, 'assets', 'iuno-chibi-src.jpg'),
    os.path.join(ROOT, 'assets', 'iuno-chibi-src.jpeg'),
    os.path.join(ROOT, 'assets', 'iuno-chibi-src.webp'),
    os.path.join(ROOT, 'assets', 'Iuno-Q.png'),
]

BG_MIN = 238    # min(r,g,b) above this counts as "near-white" background
EDGE_LO = 226   # edge ring feather: min channel LO..HI -> partial alpha
MARGIN = 8      # px margin kept around the content bbox


def _flood_from_border(white):
    """Boolean mask of near-white pixels connected to the image border."""
    h, w = white.shape
    bg = np.zeros_like(white, dtype=bool)
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if white[y, x] and not bg[y, x]:
                bg[y, x] = True
                q.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if white[y, x] and not bg[y, x]:
                bg[y, x] = True
                q.append((y, x))
    while q:
        y, x = q.popleft()
        for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= ny < h and 0 <= nx < w and white[ny, nx] and not bg[ny, nx]:
                bg[ny, nx] = True
                q.append((ny, nx))
    return bg


def _components(mask):
    """Yield (pixels, size) for each 4-connected component in mask."""
    h, w = mask.shape
    seen = np.zeros_like(mask, dtype=bool)
    for sy in range(h):
        for sx in range(w):
            if not mask[sy, sx] or seen[sy, sx]:
                continue
            comp = []
            q = deque([(sy, sx)])
            seen[sy, sx] = True
            while q:
                y, x = q.popleft()
                comp.append((y, x))
                for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                    if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        q.append((ny, nx))
            yield comp


def find_src():
    if len(sys.argv) > 1:
        p = os.path.abspath(sys.argv[1])
        if os.path.isfile(p):
            return p
        sys.exit('src not found: %s' % p)
    for p in CANDIDATES:
        if os.path.isfile(p):
            return p
    sys.exit('no source image found; save the sticker as assets/iuno-chibi-src.png (or pass a path)')


def main():
    src = find_src()
    img = Image.open(src).convert('RGBA')
    a = np.asarray(img).astype(np.float32)
    rgb = a[..., :3]
    mn = rgb.min(axis=2)

    # 1) border-connected near-white = background
    bg = _flood_from_border(mn >= BG_MIN)

    alpha = np.full(mn.shape, 255.0, dtype=np.float32)
    alpha[bg] = 0.0

    # 2) feather only the outer 1px ring of the remaining silhouette
    fg = alpha > 0
    ring = np.zeros_like(fg)
    ring[1:, :] |= fg[:-1, :] & ~fg[1:, :]      # neighbour above is bg
    ring[:-1, :] |= fg[1:, :] & ~fg[:-1, :]
    ring[:, 1:] |= fg[:, :-1] & ~fg[:, 1:]
    ring[:, :-1] |= fg[:, 1:] & ~fg[:, :-1]
    ring &= fg
    feather = np.clip((mn - EDGE_LO) / float(BG_MIN - EDGE_LO), 0.35, 1.0)
    alpha[ring] = np.minimum(alpha[ring], feather[ring] * 255.0)

    a[..., 3] = alpha
    out = Image.fromarray(a.astype(np.uint8), 'RGBA')
    arr = np.asarray(out).astype(np.int32)

    # 3) remove small greyish islands (slivers, border arcs), keep coloured ones
    opaque = arr[..., 3] > 128
    comps = sorted(_components(opaque), key=len, reverse=True)
    if not comps:
        sys.exit('background removal ate the whole image; check BG_MIN')
    keep = np.zeros_like(opaque)
    largest = len(comps[0])
    for comp in comps:
        ys = [p[0] for p in comp]
        xs = [p[1] for p in comp]
        if len(comp) == largest:
            keep[ys, xs] = True
            continue
        sub = arr[np.min(ys):np.max(ys) + 1, np.min(xs):np.max(xs) + 1, :3].reshape(-1, 3)
        mx = sub.max(axis=1).astype(np.float32)
        mnc = sub.min(axis=1).astype(np.float32)
        sat = np.where(mx > 0, (mx - mnc) / np.maximum(mx, 1), 0).mean()
        bright = mx.mean() / 255.0
        # greyish + bright small island -> junk; coloured or dark -> decoration
        if not (sat < 0.10 and bright > 0.72):
            keep[ys, xs] = True
    arr[~keep] = 0
    out = Image.fromarray(arr.astype(np.uint8), 'RGBA')

    # 4) content bbox crop
    mask = np.asarray(out)[..., 3] > 8
    ys, xs = np.where(mask)
    if ys.size == 0:
        sys.exit('background removal ate the whole image; check BG_MIN')
    x0 = max(0, xs.min() - MARGIN)
    x1 = min(out.width, xs.max() + MARGIN + 1)
    y0 = max(0, ys.min() - MARGIN)
    y1 = min(out.height, ys.max() + MARGIN + 1)
    out = out.crop((int(x0), int(y0), int(x1), int(y1)))

    out.save(OUT, 'PNG')
    print('pet sprite written: %s (%dx%d, %.1f KB)' % (OUT, out.width, out.height, os.path.getsize(OUT) / 1024.0))


if __name__ == '__main__':
    main()

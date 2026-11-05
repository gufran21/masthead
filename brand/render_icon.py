"""Render the Masthead app icon with physically motivated glass refraction.

Scene: orange rounded tile with a warm-white rounded-rect outline and three
status dots on its top edge.
Glass: a clear capsule on the top edge of the outline. No border, no blur and
no shadow. The capsule works as a magnifier over the stripe and dots, easing
to no magnification at the rim so there is no seam, with a thin white rim
light on the light-facing edge, a fainter one on the opposite edge, and a soft
inner shade on the far side.

Usage: python render_icon.py <out_dir>
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image


def hexc(h):
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)]) / 255.0


TILE_TOP = hexc('#FF8A2A')
TILE_BOT = hexc('#E85500')
LINE = hexc('#FFF6EC')
# Three agent-status dots on the frame, seen through the glass (running, needs you, idle).
DOTS = [(-13.0, hexc('#28B44E')), (0.0, hexc('#FF6E01')), (13.0, hexc('#8A8F9E'))]
DOT_R = 4.6

FRAME_Y, FRAME_H, STROKE = 78.0, 126.0, 18.0
CAP_C = np.array([128.0, FRAME_Y])
CAP_H = np.array([46.0, 27.0])   # ends stay on the straight top edge of the frame
BEVEL = 18.0        # width of the curved rim, in icon units (icon is 256 wide)
LENS = 0.38         # magnifier strength: the centre shows 1 / (1 - LENS) = 1.6x
LENS_EDGE = 9.0     # the lens eases from none at the rim to full strength over this depth
LIGHT = np.array([-0.5, -0.85])
RIM_WIDTH = 3.0     # thickness of the rim light, in icon units


def sd_box(px, py, cx, cy, hx, hy, r):
    qx = np.abs(px - cx) - hx + r
    qy = np.abs(py - cy) - hy + r
    outside = np.hypot(np.maximum(qx, 0), np.maximum(qy, 0))
    inside = np.minimum(np.maximum(qx, qy), 0)
    return outside + inside - r


def scene(px, py, pix):
    """Colour of the icon without the glass, sampled at arbitrary points."""
    t = np.clip((py - 8) / 240, 0, 1)[..., None]
    col = TILE_TOP * (1 - t) + TILE_BOT * t
    ring = np.abs(sd_box(px, py, 128, FRAME_Y + FRAME_H / 2, 80, FRAME_H / 2, 32)) - STROKE / 2
    cov = np.clip(0.5 - ring / pix, 0, 1)[..., None]
    col = col * (1 - cov) + LINE * cov
    for dx, dc in DOTS:
        dd = np.hypot(px - (128 + dx), py - FRAME_Y) - DOT_R
        dcov = np.clip(0.5 - dd / pix, 0, 1)[..., None]
        col = col * (1 - dcov) + dc * dcov
    return col


def capsule(px, py):
    return sd_box(px, py, *CAP_C, *CAP_H, CAP_H[1])


def render(size, ss=2):
    n = size * ss
    pix = 256.0 / n
    coords = (np.arange(n) + 0.5) * pix
    px, py = np.meshgrid(coords, coords)

    base = scene(px, py, pix)

    d = capsule(px, py)
    eps = 0.05
    gx = capsule(px + eps, py) - capsule(px - eps, py)
    gy = capsule(px, py + eps) - capsule(px, py - eps)
    gl = np.maximum(np.hypot(gx, gy), 1e-6)
    nx, ny = gx / gl, gy / gl

    depth = np.maximum(-d, 0)
    t = np.clip(1 - depth / BEVEL, 0, 1)
    # Magnifier: uniform magnification inside, easing to none at the rim so what
    # is seen through the glass meets what is outside it without a seam. Uniform
    # scaling keeps the status dots perfectly round.
    w = np.clip(depth / LENS_EDGE, 0, 1)
    w = w * w * (3 - 2 * w)
    mag = 1 - LENS * w
    glass = scene(CAP_C[0] + (px - CAP_C[0]) * mag, CAP_C[1] + (py - CAP_C[1]) * mag, pix)

    light = LIGHT / np.linalg.norm(LIGHT)
    facing = nx * light[0] + ny * light[1]
    band = np.clip(1 - depth / RIM_WIDTH, 0, 1) ** 1.5
    lit = band * (1.0 * np.clip(facing, 0, 1) ** 1.2 + 0.45 * np.clip(-facing, 0, 1) ** 1.5)
    shade = 0.10 * t ** 2 * np.clip(-facing, 0, 1)

    glass = glass * (1 - shade)[..., None]
    glass = glass * (1 - lit)[..., None] + lit[..., None]

    cover = np.clip(0.5 - d / pix, 0, 1)[..., None]
    rgb = base * (1 - cover) + glass * cover

    tile = sd_box(px, py, 128, 128, 120, 120, 62)
    alpha = np.clip(0.5 - tile / pix, 0, 1)

    out = np.concatenate([np.clip(rgb, 0, 1), alpha[..., None]], -1)
    img = Image.fromarray((out * 255 + 0.5).astype(np.uint8), "RGBA")
    return img.resize((size, size), Image.LANCZOS)


def main():
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    master = render(1024)
    master.save(out / "masthead-icon-1024.png")
    for s in (512, 256, 128, 64, 48, 32, 24, 16):
        master.resize((s, s), Image.LANCZOS).save(out / f"masthead-icon-{s}.png")
    master.save(out / "masthead.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    print("wrote", out)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Makes the native game's surface textures (seamless 512 px colour maps and normal maps).

Run from native/:  python3 tools/gen_textures.py
Everything is generated, so the game needs no downloaded art. Every texture tiles: the noise
comes from filtered random spectra, which repeat perfectly at the edges.
"""
import os
import numpy as np
from PIL import Image

N = 512
OUT = os.path.join(os.path.dirname(__file__), '..', 'textures')
os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(1977)


def fnoise(scale=8.0, power=2.0, n=N, seed=None):
    """Seamless fractal noise in 0..1. scale: rough feature count across the tile."""
    r = np.random.default_rng(seed) if seed is not None else rng
    w = r.standard_normal((n, n))
    f = np.fft.fft2(w)
    fx = np.fft.fftfreq(n)[:, None] * n
    fy = np.fft.fftfreq(n)[None, :] * n
    k = np.sqrt(fx * fx + fy * fy)
    k[0, 0] = 1
    filt = 1.0 / np.power(k, power / 2 * 2)
    filt *= np.exp(-(k / (scale * 6)) ** 2) + 0.02
    filt[0, 0] = 0
    out = np.real(np.fft.ifft2(f * filt))
    out -= out.min()
    out /= out.max() + 1e-9
    return out


def mix(a, b, t):
    t = np.clip(t, 0, 1)[..., None]
    return np.asarray(a, float) * (1 - t) + np.asarray(b, float) * t


def save(name, rgb, height=None, strength=2.0, alpha=None):
    rgb = np.clip(rgb, 0, 255).astype(np.uint8)
    if alpha is not None:
        img = Image.fromarray(np.dstack([rgb, np.clip(alpha, 0, 255).astype(np.uint8)]), 'RGBA')
    else:
        img = Image.fromarray(rgb, 'RGB')
    img.save(os.path.join(OUT, name + '.png'), optimize=True)
    if height is not None:
        h = height.astype(float)
        dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * strength
        dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * strength
        nz = np.ones_like(h)
        l = np.sqrt(dx * dx + dy * dy + nz * nz)
        nrm = np.dstack([(-dx / l) * 0.5 + 0.5, (dy / l) * 0.5 + 0.5, (nz / l) * 0.5 + 0.5]) * 255
        Image.fromarray(nrm.astype(np.uint8), 'RGB').save(os.path.join(OUT, name + '_n.png'), optimize=True)


def grain(amount=18):
    return (rng.random((N, N)) - 0.5)[..., None] * amount


yy, xx = np.mgrid[0:N, 0:N] / N

# ---------- ground ----------
def ground(name, c0, c1, speck=None, pebbles=0.0, cracks=0.0, wet=0.0):
    n1 = fnoise(6)
    n2 = fnoise(40)
    n3 = fnoise(160, 1.2)
    col = mix(c0, c1, n1 * 0.55 + n2 * 0.25 + n3 * 0.2)
    h = n1 * 0.3 + n2 * 0.4 + n3 * 0.3
    if pebbles:
        p = fnoise(90)
        m = np.clip((p - (1 - pebbles)) * 8, 0, 1)
        col = mix(col, np.array(c1) * 1.15, m * 0.7)
        h = h + m * 0.6
    if cracks:
        c = np.abs(fnoise(10) - 0.5)
        m = np.clip((0.012 - c) * 80, 0, 1) * cracks
        col = mix(col, np.array(c0) * 0.75, m)
        h = h - m * 0.5
    if speck is not None:
        s = rng.random((N, N)) > 0.985
        col[s] = speck
    if wet:
        w = fnoise(4)
        col = col * (1 - np.clip((w - 0.55) * 3, 0, 1) * wet * 0.35)[..., None]
    save(name, col + grain(14), h, 3)

ground('ground_sand', [184, 148, 104], [214, 182, 136], speck=[150, 120, 90], cracks=0.0)
ground('ground_dirt', [112, 78, 50], [156, 112, 74], pebbles=0.08, cracks=0.2)
ground('ground_gravel', [110, 104, 96], [168, 160, 148], pebbles=0.35)
ground('ground_mud', [70, 56, 40], [110, 90, 62], wet=1.0)
ground('ground_red', [138, 72, 42], [180, 104, 62], pebbles=0.06, cracks=0.2)
ground('ground_urban', [92, 88, 82], [128, 122, 114], pebbles=0.12, cracks=0.25)

# Grass patch (blended into the ground by the terrain shader).
g1 = fnoise(30)
blades = fnoise(140, 1.2)
col = mix([54, 72, 34], [104, 112, 56], g1 * 0.6 + blades * 0.4)
save('grass', col + grain(20), blades, 2)

# ---------- building surfaces ----------
# Concrete: soft stains and pores.
n = fnoise(5) * 0.5 + fnoise(60) * 0.5
col = mix([128, 126, 120], [176, 172, 164], n)
stain = np.clip((fnoise(3) - 0.6) * 3, 0, 1)
col = mix(col, [96, 92, 84], stain * 0.5)
save('concrete', col + grain(16), n, 2)

# Plaster (painted render, tinted per house in the game).
n = fnoise(8) * 0.4 + fnoise(80) * 0.6
col = mix([214, 210, 202], [246, 244, 238], n)
dirt = np.clip(1 - yy * 3.5, 0, 1) * 0  # (ground dirt is done with vertex shading)
col = mix(col, [170, 150, 120], np.clip((fnoise(4) - 0.62) * 2.5, 0, 1) * 0.35)
save('plaster', col + grain(10), n, 1.5)

# Mud wall: rough, straw flecks.
n = fnoise(10) * 0.5 + fnoise(70) * 0.5
col = mix([132, 92, 58], [176, 130, 86], n)
straw = rng.random((N, N)) > 0.992
col[straw] = [214, 186, 120]
save('mud', col + grain(20), n, 4)

# Planks: vertical boards with grain and gaps.
boards = 6
bx = (xx * boards) % 1
bid = np.floor(xx * boards)
tone = (np.sin(bid * 12.9898) * 43758.5453) % 1
grain_l = np.sin((yy * 40 + fnoise(6) * 6 + bid * 3) * np.pi) * 0.5 + 0.5
col = mix([104, 74, 46], [158, 116, 72], tone[..., None][..., 0] * 0.5 + grain_l * 0.35)
gap = (bx < 0.03) | (bx > 0.97)
col[gap] = [40, 28, 18]
h = grain_l * 0.3 + (~gap) * 0.7
save('plank', col + grain(12), h, 3)

# Stone blocks.
rows = 6
by = yy * rows
row = np.floor(by)
bx2 = (xx * 4 + (row % 2) * 0.5) % 1
fy = by % 1
mortar = (fy < 0.06) | (bx2 < 0.03)
bidx = np.floor(xx * 4 + (row % 2) * 0.5) + row * 7
tone = (np.sin(bidx * 78.233) * 43758.5453) % 1
n = fnoise(50)
col = mix([128, 122, 110], [178, 170, 152], tone * 0.6 + n * 0.4)
col[mortar] = [96, 92, 86]
h = (~mortar) * 0.8 + n * 0.2
save('stone', col + grain(14), h, 4)

# Sandbags: rows of rounded sacks.
rows = 5
by = yy * rows
row = np.floor(by)
sx = (xx * 3 + (row % 2) * 0.5) % 1
sy = by % 1
bulge = np.sin(sx * np.pi) * np.sin(sy * np.pi)
weave = (np.sin(xx * N * 0.9) * np.sin(yy * N * 0.9)) * 0.5 + 0.5
col = mix([128, 112, 78], [178, 160, 116], bulge * 0.8 + weave * 0.1)
save('sandbag', col + grain(12), bulge, 6)

# Crate: framed planks.
edge = (xx < 0.08) | (xx > 0.92) | (yy < 0.08) | (yy > 0.92)
diag = np.abs((xx - yy)) < 0.06
pl = np.sin(yy * 5 * np.pi * 2) * 0.5 + 0.5
col = mix([140, 104, 58], [186, 146, 86], fnoise(30) * 0.6 + pl * 0.2)
col[edge | diag] = col[edge | diag] * 0.78
col[(np.abs((yy * 5) % 1) < 0.03) & ~edge] = [70, 50, 30]
h = (edge | diag) * 0.8 + fnoise(60) * 0.2
save('crate', col + grain(12), h, 3)

# Corrugated zinc roof sheet, rusty in streaks.
corr = np.sin(xx * 2 * np.pi * 16) * 0.5 + 0.5
rust = np.clip((fnoise(5) * 0.7 + yy * 0.6 - 0.6) * 2.5, 0, 1)
col = mix([150, 156, 160], [196, 200, 204], corr * 0.6 + fnoise(60) * 0.2)
col = mix(col, [140, 82, 46], rust * 0.75)
save('zinc', col + grain(10), corr, 3)

# Metal plates with rivets.
n = fnoise(20)
col = mix([90, 96, 102], [132, 138, 144], n)
seam = ((xx * 2) % 1 < 0.01) | ((yy * 2) % 1 < 0.01)
col[seam] = [56, 60, 64]
rx = ((xx * 2) % 1)
ry = ((yy * 2) % 1)
riv = (((rx - 0.04) ** 2 + (ry % 0.125 - 0.06) ** 2) < 0.0002)
col[riv] = [170, 176, 180]
save('metal', col + grain(10), n * 0.3 + riv * 0.8 - seam * 0.5, 3)

# Shipping container: vertical ribs (tinted per container in the game).
rib = np.abs(np.sin(xx * np.pi * 12))
col = mix([200, 200, 200], [240, 240, 240], rib * 0.6 + fnoise(40) * 0.3)
rust = np.clip((fnoise(6) - 0.68) * 3, 0, 1)
col = mix(col, [120, 80, 50], rust * 0.6)
save('container', col + grain(8), rib, 4)

# Rust.
n = fnoise(12) * 0.6 + fnoise(90) * 0.4
col = mix([98, 52, 30], [168, 96, 52], n)
save('rust', col + grain(18), n, 3)

# Office tower facade: window grid.
cols, rows = 4, 6
cx = (xx * cols) % 1
cy = (yy * rows) % 1
win = (cx > 0.12) & (cx < 0.88) & (cy > 0.18) & (cy < 0.86)
wid = np.floor(xx * cols) + np.floor(yy * rows) * 9
lit = ((np.sin(wid * 12.9898) * 43758.5453) % 1)
col = np.zeros((N, N, 3)) + [150, 146, 138]
glass = mix([40, 62, 80], [96, 130, 150], lit * 0.7 + yy * 0.3)
col[win] = glass[win]
save('facade', col + grain(6), win * 1.0, 2)

# ---------- nature ----------
# Bark.
ridge = np.abs(np.sin((xx * 14 + fnoise(4) * 2) * np.pi)) ** 0.6
col = mix([60, 46, 32], [122, 98, 72], ridge * 0.7 + fnoise(40) * 0.3)
save('bark', col + grain(12), ridge, 4)

# Rock.
n = fnoise(8) * 0.6 + fnoise(70) * 0.4
vein = np.clip(0.03 - np.abs(fnoise(6) - 0.5), 0, 1) * 30
col = mix([110, 104, 96], [170, 164, 152], n)
col = mix(col, [80, 76, 70], vein * 0.6)
save('rock', col + grain(16), n - vein * 0.3, 4)

# Leaves (alpha): a palm frond for the tree cards.
a = np.zeros((N, N))
col = np.zeros((N, N, 3))
for k in range(0, 18):
    t = k / 17
    y0 = 0.06 + t * 0.9
    for side in (-1, 1):
        # Each leaflet: a thin slanted blade from the spine.
        ln = 0.42 * (1 - abs(t - 0.45) * 0.9)
        for s in np.linspace(0, 1, 120):
            px = 0.5 + side * s * ln
            py = y0 - s * 0.08
            r = 0.012 * (1 - s) + 0.004
            m = ((xx - px) ** 2 + (yy - py) ** 2) < r * r
            a[m] = 255
            col[m] = mix([46, 92, 34], [92, 140, 52], np.array([s * 0.8 + t * 0.2]))[0]
spine = (np.abs(xx - 0.5) < 0.006) & (yy > 0.04)
a[spine] = 255
col[spine] = [90, 110, 50]
save('frond', col, None, alpha=a)

# Broadleaf canopy cluster (alpha).
a = np.zeros((N, N))
col = np.zeros((N, N, 3))
for i in range(260):
    cx, cy = rng.random(2) * 0.8 + 0.1
    r = 0.03 + rng.random() * 0.05
    if (cx - 0.5) ** 2 + (cy - 0.5) ** 2 > 0.16:
        continue
    m = ((xx - cx) ** 2 + (yy - cy) ** 2) < r * r
    a[m] = 255
    shade = rng.random()
    col[m] = mix([40, 78, 30], [96, 138, 54], np.array([shade]))[0]
save('leaves', col + grain(10), None, alpha=a)

# ---------- water ----------
w = fnoise(14, 2.4) * 0.6 + fnoise(40, 2.0) * 0.4
save('water_h', np.dstack([w, w, w]) * 255, w, 6)
os.replace(os.path.join(OUT, 'water_h_n.png'), os.path.join(OUT, 'water_n.png'))
os.remove(os.path.join(OUT, 'water_h.png'))

# ---------- soldier cloth: woodland and desert camo ----------
def camo(name, cols):
    c = np.zeros((N, N, 3)) + cols[0]
    for i, cc in enumerate(cols[1:]):
        m = fnoise(7, seed=50 + i) > 0.58
        c[m] = cc
    save(name, c + grain(10), None)

camo('camo_wood', [[86, 92, 58], [56, 64, 40], [110, 98, 66], [38, 40, 30]])
camo('camo_desert', [[176, 152, 112], [140, 116, 80], [196, 178, 140], [112, 92, 66]])
camo('camo_urban', [[96, 100, 104], [60, 64, 70], [140, 142, 146], [40, 42, 46]])

print('textures written to', os.path.abspath(OUT))
for f in sorted(os.listdir(OUT)):
    print(' ', f, os.path.getsize(os.path.join(OUT, f)) // 1024, 'KB')

# Grass tuft (alpha): thin blades fanning out from the bottom.
a = np.zeros((N, N))
col = np.zeros((N, N, 3))
r2 = np.random.default_rng(9)
for i in range(70):
    bx = 0.15 + r2.random() * 0.7
    lean = (r2.random() - 0.5) * 0.5
    hgt = 0.45 + r2.random() * 0.5
    shade = r2.random()
    for s in np.linspace(0, 1, 200):
        px = bx + lean * s * s
        py = 1 - s * hgt
        w = 0.012 * (1 - s) + 0.002
        m = (np.abs(xx - px) < w) & (np.abs(yy - py) < 0.004)
        a[m] = 255
        col[m] = mix([58, 86, 30], [150, 160, 70], np.array([shade * 0.6 + s * 0.4]))[0]
save('tuft', col, None, alpha=a)
print('tuft done')

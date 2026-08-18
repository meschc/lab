#!/usr/bin/env python3
"""ЗЕРНО — генератор логотипа и иконок.

Рисует диафрагму из 6 лепестков с тёплым световым ядром, гало и зерном.
Всё считается математически, без внешних ассетов.
"""
import math, os, sys
from PIL import Image, ImageDraw, ImageFilter, ImageChops
import numpy as np

# ── палитра ────────────────────────────────────────────────────────────────
INK        = (11, 10, 9)
BODY_HI    = (58, 52, 46)
BODY_LO    = (26, 23, 20)
BLADE_HI   = (92, 84, 75)
BLADE_LO   = (34, 30, 27)
AMBER      = (233, 161, 59)
HALATION   = (255, 112, 92)
PAPER      = (245, 239, 227)

SS = 4  # суперсэмплинг


def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def radial_gradient(size, inner, outer, cx=0.5, cy=0.5, power=1.0, radius=0.7071,
                    mid=None, mid_at=0.45):
    """RGB-изображение с радиальным градиентом. radius — доля стороны, на которой цвет = outer.
    mid — необязательная промежуточная точка на расстоянии mid_at."""
    y, x = np.mgrid[0:size, 0:size].astype(np.float32)
    x = (x + .5) / size - cx
    y = (y + .5) / size - cy
    r = np.sqrt(x * x + y * y) / radius
    r = np.clip(r, 0, 1) ** power
    arr = np.zeros((size, size, 3), np.float32)
    for c in range(3):
        if mid is None:
            arr[..., c] = inner[c] + (outer[c] - inner[c]) * r
        else:
            t1 = np.clip(r / mid_at, 0, 1)
            t2 = np.clip((r - mid_at) / (1 - mid_at), 0, 1)
            arr[..., c] = np.where(r < mid_at,
                                   inner[c] + (mid[c] - inner[c]) * t1,
                                   mid[c] + (outer[c] - mid[c]) * t2)
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), 'RGB')


def linear_gradient(size, top, bottom, angle=90.0):
    y, x = np.mgrid[0:size, 0:size].astype(np.float32)
    a = math.radians(angle)
    t = (x / size) * math.cos(a) + (y / size) * math.sin(a)
    t = (t - t.min()) / max(t.max() - t.min(), 1e-6)
    arr = np.zeros((size, size, 3), np.float32)
    for c in range(3):
        arr[..., c] = top[c] + (bottom[c] - top[c]) * t
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), 'RGB')


def grain_layer(size, amount=10.0, seed=7):
    rng = np.random.default_rng(seed)
    n = rng.normal(0, amount, (size, size)).astype(np.float32)
    img = Image.fromarray(np.clip(n + 128, 0, 255).astype(np.uint8), 'L')
    return img.filter(ImageFilter.GaussianBlur(size / 900))


def hexagon(cx, cy, r, rot=0.0):
    return [(cx + r * math.cos(rot + i * math.pi / 3),
             cy + r * math.sin(rot + i * math.pi / 3)) for i in range(6)]


def blade_polys(cx, cy, r_in, r_out, rot):
    """Шесть лепестков ириса: каждый ограничен ребром шестиугольника,
    двумя швами и внешней дугой."""
    V = hexagon(cx, cy, r_in, rot)
    polys = []
    for i in range(6):
        a, b = V[i], V[(i + 1) % 6]
        # шов идёт от вершины наружу по касательной к ребру
        dx, dy = a[0] - b[0], a[1] - b[1]
        L = math.hypot(dx, dy)
        dx, dy = dx / L, dy / L
        # находим точку пересечения луча a + t*d с окружностью r_out
        ox, oy = a[0] - cx, a[1] - cy
        bq = ox * dx + oy * dy
        cq = ox * ox + oy * oy - r_out * r_out
        t = -bq + math.sqrt(max(bq * bq - cq, 0))
        p_far = (a[0] + dx * t, a[1] + dy * t)
        # вторая граница лепестка — шов соседней вершины
        a2, b2 = V[(i + 1) % 6], V[(i + 2) % 6]
        dx2, dy2 = a2[0] - b2[0], a2[1] - b2[1]
        L2 = math.hypot(dx2, dy2)
        dx2, dy2 = dx2 / L2, dy2 / L2
        ox2, oy2 = a2[0] - cx, a2[1] - cy
        bq2 = ox2 * dx2 + oy2 * dy2
        cq2 = ox2 * ox2 + oy2 * oy2 - r_out * r_out
        t2 = -bq2 + math.sqrt(max(bq2 * bq2 - cq2, 0))
        p_far2 = (a2[0] + dx2 * t2, a2[1] + dy2 * t2)
        # дуга между p_far и p_far2
        ang1 = math.atan2(p_far[1] - cy, p_far[0] - cx)
        ang2 = math.atan2(p_far2[1] - cy, p_far2[0] - cx)
        while ang2 < ang1:
            ang2 += 2 * math.pi
        arc = [(cx + r_out * math.cos(ang1 + (ang2 - ang1) * k / 18),
                cy + r_out * math.sin(ang1 + (ang2 - ang1) * k / 18))
               for k in range(19)]
        polys.append([a, p_far] + arc + [p_far2, b])
    return polys


def render(size, *, rounded=False, bleed=1.0, open_amount=0.50, rot=0.0, glow=1.0):
    """bleed — доля холста под корпусом; glow — сила света в отверстии."""
    S = size * SS
    cx = cy = S / 2

    base = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    body_r = S / 2 * bleed
    mask = Image.new('L', (S, S), 0)
    ImageDraw.Draw(mask).ellipse([cx - body_r, cy - body_r, cx + body_r, cy + body_r], fill=255)

    # корпус объектива
    body = linear_gradient(S, (46, 41, 36), (12, 11, 10), angle=100)
    base.paste(body, (0, 0), mask)

    bowl_r = body_r * 0.895
    bowl_mask = Image.new('L', (S, S), 0)
    ImageDraw.Draw(bowl_mask).ellipse([cx - bowl_r, cy - bowl_r, cx + bowl_r, cy + bowl_r], fill=255)
    base.paste(radial_gradient(S, (26, 23, 20), (8, 7, 7), power=1.3), (0, 0), bowl_mask)

    r_in = bowl_r * open_amount
    r_out = bowl_r * 1.02

    # ── лепестки: тёмный графит со светом, приходящим из отверстия ──
    blades = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    bd = ImageDraw.Draw(blades)
    polys = blade_polys(cx, cy, r_in, r_out, rot)
    for i, poly in enumerate(polys):
        t = (math.sin(i / 6 * 2 * math.pi - 1.2) + 1) / 2
        bd.polygon(poly, fill=lerp(BLADE_LO, BLADE_HI, 0.04 + 0.96 * t) + (255,))
    # спад света от центра наружу — блики на металле у самого отверстия
    spill = radial_gradient(S, (255, 255, 255), (40, 40, 40), power=0.55, radius=bowl_r / S * 1.05)
    barr = np.asarray(blades, np.float32)
    sarr = np.asarray(spill.convert('L'), np.float32)[..., None] / 255.0
    barr[..., :3] = np.clip(barr[..., :3] * (0.30 + 1.05 * sarr), 0, 255)
    # тёплый оттенок отражённого света
    warm = sarr[..., 0] ** 2.2
    barr[..., 0] = np.clip(barr[..., 0] * (1.0 + 0.46 * warm), 0, 255)
    barr[..., 1] = np.clip(barr[..., 1] * (1.0 + 0.10 * warm), 0, 255)
    barr[..., 2] = np.clip(barr[..., 2] * (1.0 + 0.34 * warm), 0, 255)
    blades = Image.fromarray(barr.astype(np.uint8), 'RGBA')

    # тонкий светящийся шов вдоль каждого лепестка
    seams = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    sd = ImageDraw.Draw(seams)
    for poly in polys:
        sd.line([poly[0], poly[1]], fill=(255, 222, 214, 210), width=max(1, int(S / 420)))
    seams = seams.filter(ImageFilter.GaussianBlur(S / 1600))
    blades = Image.alpha_composite(blades, seams)
    blades.putalpha(ImageChops.multiply(blades.split()[3], bowl_mask))
    base = Image.alpha_composite(base, blades)

    # ── свет в отверстии ──
    hexa = hexagon(cx, cy, r_in, rot)
    hmask = Image.new('L', (S, S), 0)
    ImageDraw.Draw(hmask).polygon(hexa, fill=255)
    core = radial_gradient(S, (255, 247, 231), (108, 52, 178), power=0.95,
                           radius=r_in / S * 0.94, mid=(255, 136, 118), mid_at=0.34)
    base.paste(core, (0, 0), hmask)

    # halation: красно-оранжевое свечение, выходящее за кромку лепестков
    hal = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    hd = ImageDraw.Draw(hal)
    hd.polygon(hexagon(cx, cy, r_in * 1.10, rot), fill=HALATION + (255,))
    hd.polygon(hexagon(cx, cy, r_in * 0.80, rot), fill=(0, 0, 0, 0))
    hal = hal.filter(ImageFilter.GaussianBlur(r_in * 0.16))
    harr = np.asarray(hal, np.float32)
    harr[..., 3] *= 0.85 * glow
    hal = Image.fromarray(harr.astype(np.uint8), 'RGBA')
    base = Image.fromarray(np.clip(
        np.asarray(base, np.float32)[..., :3] +
        np.asarray(hal, np.float32)[..., :3] * (np.asarray(hal, np.float32)[..., 3:4] / 255.0) * 0.95,
        0, 255).astype(np.uint8), 'RGB').convert('RGBA')
    base.putalpha(255 if bleed >= 0.999 else 255)

    # bloom: мягкое тёплое свечение поверх
    bl = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(bl).polygon(hexagon(cx, cy, r_in * 0.62, rot), fill=(255, 186, 158, 255))
    bl = bl.filter(ImageFilter.GaussianBlur(r_in * 0.55))
    base = Image.fromarray(np.clip(
        np.asarray(base, np.float32)[..., :3] +
        np.asarray(bl, np.float32)[..., :3] * (np.asarray(bl, np.float32)[..., 3:4] / 255.0) * 0.10 * glow,
        0, 255).astype(np.uint8), 'RGB').convert('RGBA')

    # снова маскируем всё кругом корпуса
    if bleed < 0.999:
        base.putalpha(mask)

    # кромка отверстия — тёмная линия, отделяющая свет от металла
    edge = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(edge).polygon(hexa, outline=(20, 12, 8, 220), width=max(2, int(S / 260)))
    edge = edge.filter(ImageFilter.GaussianBlur(S / 900))
    base = Image.alpha_composite(base, edge)

    # блик по верхней кромке корпуса
    spec = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(spec).ellipse([cx - body_r * .99, cy - body_r * .99,
                                  cx + body_r * .99, cy + body_r * .99],
                                 outline=(255, 244, 226, 150), width=max(2, int(S / 150)))
    spec = spec.filter(ImageFilter.GaussianBlur(S / 320))
    sh = Image.new('L', (S, S), 0)
    ImageDraw.Draw(sh).pieslice([cx - body_r, cy - body_r, cx + body_r, cy + body_r], 190, 350, fill=255)
    sh = sh.filter(ImageFilter.GaussianBlur(S / 36))
    spec.putalpha(ImageChops.multiply(spec.split()[3], sh))
    base = Image.alpha_composite(base, spec)

    # зерно
    ga = np.asarray(grain_layer(S, 8.0), np.float32) - 128
    arr = np.asarray(base.convert('RGBA'), np.float32)
    arr[..., :3] = np.clip(arr[..., :3] + ga[..., None] * 0.85, 0, 255)
    base = Image.fromarray(arr.astype(np.uint8), 'RGBA')

    if bleed >= 0.999:
        bg = radial_gradient(S, (30, 26, 22), (8, 7, 7), power=1.15).convert('RGBA')
        gg = np.asarray(grain_layer(S, 6.0, 11), np.float32) - 128
        ba = np.asarray(bg, np.float32)
        ba[..., :3] = np.clip(ba[..., :3] + gg[..., None] * 0.8, 0, 255)
        base = Image.alpha_composite(Image.fromarray(ba.astype(np.uint8), 'RGBA'), base)

    out = base.resize((size, size), Image.LANCZOS)
    if rounded:
        m = Image.new('L', (size * SS, size * SS), 0)
        ImageDraw.Draw(m).rounded_rectangle([0, 0, size * SS - 1, size * SS - 1],
                                            radius=size * SS * 0.2237, fill=255)
        out.putalpha(m.resize((size, size), Image.LANCZOS))
    return out


def export_all(outdir):
    os.makedirs(outdir, exist_ok=True)
    repo = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    ios = os.path.join(repo, 'apps', 'ios', 'ZERNO', 'Assets.xcassets', 'AppIcon.appiconset')

    # 1024 — App Store / AppIcon (без альфы, во весь квадрат)
    icon = render(1024, bleed=1.0).convert('RGB')
    icon.save(os.path.join(outdir, 'icon-1024.png'))

    # PWA / веб
    for sz in (512, 384, 192, 180, 152, 120, 96, 64, 32):
        render(sz, bleed=1.0).convert('RGB').save(os.path.join(outdir, f'icon-{sz}.png'))

    # maskable: логотип с запасом по краям (safe zone 80%)
    m = Image.new('RGB', (512, 512), (14, 12, 11))
    inner = render(410, bleed=1.0).convert('RGB')
    m.paste(inner, (51, 51))
    m.save(os.path.join(outdir, 'icon-maskable-512.png'))

    # круглая марка с прозрачным фоном — для интерфейса
    mark = render(512, bleed=0.985)
    mark.save(os.path.join(outdir, 'mark-512.png'))

    if os.path.isdir(os.path.dirname(ios)):
        icon.save(os.path.join(ios, 'icon-1024.png'))
    print('icons →', outdir)


if __name__ == '__main__':
    export_all(sys.argv[1] if len(sys.argv) > 1 else '.')

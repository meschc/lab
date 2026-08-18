#!/usr/bin/env python3
"""Синтетический демо-кадр: закат над водой. Нужен, чтобы фильтры
было видно сразу, без загрузки своей фотографии."""
import math, os, sys
from PIL import Image, ImageDraw, ImageFilter
import numpy as np

W, H = 1400, 1750


def fbm(shape, octaves=6, seed=3):
    rng = np.random.default_rng(seed)
    out = np.zeros(shape, np.float32)
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        res = max(2, int(2 ** (o + 2)))
        small = rng.random((res, int(res * shape[1] / shape[0]) or 2)).astype(np.float32)
        img = Image.fromarray((small * 255).astype(np.uint8), 'L').resize(
            (shape[1], shape[0]), Image.BICUBIC)
        out += np.asarray(img, np.float32) / 255.0 * amp
        tot += amp
        amp *= 0.52
    return out / tot


def scene():
    y, x = np.mgrid[0:H, 0:W].astype(np.float32)
    ny, nx = y / H, x / W
    img = np.zeros((H, W, 3), np.float32)

    horizon = 0.56
    sky = np.clip(ny / horizon, 0, 1)
    # небо: холодная синева вверху → тёплая дымка у горизонта
    top = np.array([38, 52, 86], np.float32)
    mid = np.array([176, 132, 118], np.float32)
    bot = np.array([246, 186, 122], np.float32)
    t = sky[..., None]
    upper = top + (mid - top) * np.clip(t / .72, 0, 1) ** 1.3
    lower = mid + (bot - mid) * np.clip((t - .72) / .28, 0, 1)
    img[:] = np.where(t < .72, upper, lower)

    # солнце
    sx, sy = 0.615, horizon - 0.055
    d = np.sqrt(((nx - sx) * (W / H)) ** 2 + (ny - sy) ** 2)
    sun = np.exp(-(d / 0.028) ** 2)
    glow = np.exp(-(d / 0.30) ** 1.6) * 0.85
    img += sun[..., None] * np.array([255, 246, 214], np.float32)
    img += glow[..., None] * np.array([210, 118, 52], np.float32)

    # облачные полосы
    cl = fbm((H, W), 6, 11)
    bands = (np.sin(ny * 46 + cl * 5.5) * .5 + .5) ** 3
    cloud = np.clip((cl - .48) * 2.6, 0, 1) * bands * np.clip(1 - sky * 1.15, 0, 1)
    img += cloud[..., None] * np.array([64, 40, 46], np.float32) * -1.0
    img += (cloud * np.exp(-(d / .45) ** 2))[..., None] * np.array([255, 168, 96], np.float32) * 1.1

    # дальние горы
    ridge = fbm((H, W), 5, 21)[0] if False else None
    for k, (base, col, blur) in enumerate([(0.545, (58, 62, 82), 1.0),
                                           (0.556, (40, 44, 60), 0.6)]):
        prof = base - (fbm((64, W), 4, 30 + k)[0] * 0.055 + 0.005)
        prof = np.interp(np.arange(W), np.arange(W), prof)
        m = (ny > prof[None, :]) & (ny < horizon + 0.002)
        img[m] = np.array(col, np.float32)

    # вода
    water = ny > horizon
    wnorm = np.clip((ny - horizon) / (1 - horizon), 0, 1)
    refl_y = (horizon - (ny - horizon) * 0.85)
    ry = np.clip((refl_y * H).astype(np.int32), 0, H - 1)
    rx = np.clip(x.astype(np.int32), 0, W - 1)
    refl = img[ry, rx]
    ripple = (fbm((H, W), 5, 44) - .5) * 2
    shift = (ripple * (18 + wnorm * 70)).astype(np.int32)
    rx2 = np.clip(rx + shift, 0, W - 1)
    refl = img[ry, rx2]
    refl = refl * (0.62 + 0.22 * wnorm[..., None])
    # блики на воде — дорожка от солнца
    lane = np.exp(-(((nx - sx) * (W / H)) / (0.045 + wnorm * 0.30)) ** 2)
    spark = (fbm((H, W), 7, 57) > .70).astype(np.float32) * lane * (0.30 + wnorm * 0.35)
    refl += spark[..., None] * np.array([255, 214, 150], np.float32) * 0.85
    refl += (lane * (1 - wnorm * .5))[..., None] * np.array([120, 62, 24], np.float32)
    img = np.where(water[..., None], refl, img)

    # силуэт лодки на воде
    im = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8), 'RGB')
    dr = ImageDraw.Draw(im, 'RGBA')
    bx, by = int(W * .30), int(H * (horizon + .085))
    dr.polygon([(bx - 96, by), (bx + 96, by), (bx + 66, by + 30), (bx - 62, by + 30)],
               fill=(16, 16, 22, 255))
    dr.line([(bx + 6, by), (bx + 6, by - 150)], fill=(16, 16, 22, 255), width=5)
    dr.polygon([(bx + 10, by - 146), (bx + 10, by - 18), (bx + 84, by - 18)],
               fill=(24, 22, 28, 235))
    # отражение лодки
    dr.polygon([(bx - 80, by + 34), (bx + 80, by + 34), (bx + 54, by + 62), (bx - 52, by + 62)],
               fill=(20, 18, 24, 110))

    arr = np.asarray(im, np.float32)
    # атмосферная дымка у горизонта
    haze = np.exp(-((ny - horizon) / 0.075) ** 2)
    arr += haze[..., None] * np.array([70, 46, 30], np.float32) * 0.55
    # виньетка объектива + лёгкий шум съёмки
    vx = (nx - .5) * 2; vy = (ny - .5) * 2
    vig = np.clip(1 - (vx * vx + vy * vy) * 0.20, 0, 1) ** 1.1
    arr *= vig[..., None]
    rng = np.random.default_rng(5)
    arr += rng.normal(0, 2.6, arr.shape)
    out = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), 'RGB')
    return out.filter(ImageFilter.GaussianBlur(0.4))


if __name__ == '__main__':
    outdir = sys.argv[1] if len(sys.argv) > 1 else '.'
    os.makedirs(outdir, exist_ok=True)
    im = scene()
    im.save(os.path.join(outdir, 'demo.jpg'), quality=86, optimize=True, progressive=True)
    im.resize((im.width // 4, im.height // 4), Image.LANCZOS).save(
        os.path.join(outdir, 'demo-thumb.jpg'), quality=80)
    print('demo.jpg', os.path.getsize(os.path.join(outdir, 'demo.jpg')) // 1024, 'KB')

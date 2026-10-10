// 2. Фракталы: Мандельброт и Жюлиа — изолиниями, остальные — рекурсией по глубине
import { contours, segments, poly } from '../core/draw.js';
import { mulberry32 } from '../core/rng.js';

const GRID = 128;
const GRID_M = 150;

// сглаженное число итераций; внутри множества — maxIt
function escapeField(nx, maxIt, fn) {
  const f = new Float32Array(nx * nx);
  for (let j = 0; j < nx; j++) {
    for (let i = 0; i < nx; i++) {
      const [zx0, zy0, cx, cy] = fn(i / (nx - 1), j / (nx - 1));
      let x = zx0, y = zy0, x2 = x * x, y2 = y * y, k = 0;
      while (x2 + y2 <= 256 && k < maxIt) {
        y = 2 * x * y + cy;
        x = x2 - y2 + cx;
        x2 = x * x;
        y2 = y * y;
        k++;
      }
      f[j * nx + i] = k >= maxIt ? maxIt : k + 1 - Math.log2(0.5 * Math.log(x2 + y2));
    }
  }
  return f;
}

// эквипотенциальные линии с равным шагом по числу итераций;
// саму границу множества не рисуем — на сетке она превращается в кляксу
function isoLines(f, nx, maxIt, levels, step) {
  let lo = Infinity;
  for (let i = 0; i < f.length; i++) if (f[i] < lo) lo = f[i];
  const out = [];
  for (let k = 1; k <= levels; k++) {
    const level = lo + k * step;
    if (level >= maxIt - 1) break;
    contours(f, nx, nx, level, out);
  }
  return out;
}

// Мандельброт: медленный зум в «долину морских коньков»
const TX = -0.743643887037151, TY = 0.13182590420533;
const SX = -0.6, SY = 0, S0 = 3.0;

function mandel(s) {
  const k = s.scale / S0;
  s.cx = TX + (SX - TX) * k;
  s.cy = TY + (SY - TY) * k;
  const maxIt = Math.round(70 + 45 * Math.log10(S0 / s.scale));
  const f = escapeField(GRID_M, maxIt, (u, v) => [0, 0, s.cx + (u - 0.5) * s.scale, s.cy + (v - 0.5) * s.scale]);
  s.segs = isoLines(f, GRID_M, maxIt, 14, 1.5);
}

function julia(s) {
  const cx = 0.7885 * Math.cos(s.a), cy = 0.7885 * Math.sin(s.a);
  const f = escapeField(GRID, 60, (u, v) => [(u - 0.5) * 3.2, (v - 0.5) * 3.2, cx, cy]);
  s.segs = isoLines(f, GRID, 60, 12, 1);
}

// рекурсивные построения → массив отрезков
function sierpinski(depth) {
  const out = [];
  const side = 0.86, h = (side * Math.sqrt(3)) / 2;
  const top = (1 - h) / 2 + 0.02;
  const rec = (ax, ay, bx, by, cx, cy, d) => {
    if (d === 0) {
      out.push(ax, ay, bx, by, bx, by, cx, cy, cx, cy, ax, ay);
      return;
    }
    const abx = (ax + bx) / 2, aby = (ay + by) / 2;
    const bcx = (bx + cx) / 2, bcy = (by + cy) / 2;
    const cax = (cx + ax) / 2, cay = (cy + ay) / 2;
    rec(ax, ay, abx, aby, cax, cay, d - 1);
    rec(abx, aby, bx, by, bcx, bcy, d - 1);
    rec(cax, cay, bcx, bcy, cx, cy, d - 1);
  };
  rec(0.5, top, 0.5 + side / 2, top + h, 0.5 - side / 2, top + h, depth);
  return out;
}

function koch(depth, closed, seed) {
  const rng = mulberry32(seed);
  let pts;
  if (closed) {
    const r = 0.36, cy = 0.53;
    pts = [];
    for (let i = 0; i <= 3; i++) {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / 3;
      pts.push(0.5 + r * Math.cos(a), cy + r * Math.sin(a));
    }
  } else {
    pts = [0.06, 0.62, 0.94, 0.62];
  }
  for (let d = 0; d < depth; d++) {
    const next = [pts[0], pts[1]];
    for (let i = 0; i < pts.length - 2; i += 2) {
      const x1 = pts[i], y1 = pts[i + 1], x2 = pts[i + 2], y2 = pts[i + 3];
      const dx = (x2 - x1) / 3, dy = (y2 - y1) / 3;
      // для «берега» направление зубца случайное, но фиксированное seed'ом
      const sign = closed ? -1 : rng() < 0.5 ? -1 : 1;
      const ax = x1 + dx, ay = y1 + dy;
      const bx = x1 + 2 * dx, by = y1 + 2 * dy;
      const px = ax + dx / 2 - (sign * dy * Math.sqrt(3)) / 2;
      const py = ay + dy / 2 + (sign * dx * Math.sqrt(3)) / 2;
      next.push(ax, ay, px, py, bx, by, x2, y2);
    }
    pts = next;
  }
  return pts;
}

function pythagoras(depth, angle) {
  const out = [];
  const a = 0.1;
  const rec = (x, y, ux, uy, d) => {
    // квадрат на отрезке (x,y)→(x+ux,y+uy), «вверх» — перпендикуляр (uy,-ux)
    const vx = uy, vy = -ux;
    const p1x = x, p1y = y, p2x = x + ux, p2y = y + uy;
    const p3x = p2x + vx, p3y = p2y + vy, p4x = x + vx, p4y = y + vy;
    out.push(p1x, p1y, p2x, p2y, p2x, p2y, p3x, p3y, p3x, p3y, p4x, p4y, p4x, p4y, p1x, p1y);
    if (d === 0) return;
    const c = Math.cos(angle), s = Math.sin(angle);
    // левая ветвь: повернуть основание на angle и сжать на cos
    const lx = (ux * c + vx * s) * c, ly = (uy * c + vy * s) * c;
    rec(p4x, p4y, lx, ly, d - 1);
    rec(p4x + lx, p4y + ly, p3x - (p4x + lx), p3y - (p4y + ly), d - 1);
  };
  rec(0.5 - a / 2, 0.9, a, 0, depth);
  return out;
}

function cantor(depth) {
  const out = [];
  const gap = 0.12, hgt = 0.03;
  const y0 = 0.5 - (depth * gap) / 2 - hgt / 2;
  let segs = [[0.07, 0.93]];
  for (let d = 0; d <= depth; d++) {
    const y = y0 + d * gap;
    for (const [a, b] of segs) {
      out.push(a, y, b, y, b, y, b, y + hgt, b, y + hgt, a, y + hgt, a, y + hgt, a, y);
    }
    segs = segs.flatMap(([a, b]) => {
      const t = (b - a) / 3;
      return [[a, a + t], [b - t, b]];
    });
  }
  return out;
}

const MAXD = { sierpinski: 7, koch: 5, coast: 6, pythagoras: 10, cantor: 6 };

export default {
  id: 'fractals',
  create(p, rng) {
    const s = { mode: p.mode || 'mandelbrot', t: 0, d: 0, acc: 0, hold: 0, seed: (rng() * 1e9) | 0 };
    if (s.mode === 'mandelbrot') { s.scale = S0; mandel(s); }
    if (s.mode === 'julia') { s.a = p.a ?? 2.2; julia(s); }
    if (MAXD[s.mode] != null) this.build(s);
    return s;
  },
  build(s) {
    if (s.mode === 'sierpinski') s.segs = sierpinski(s.d);
    if (s.mode === 'koch') s.pts = koch(s.d, true, s.seed);
    if (s.mode === 'coast') s.pts = koch(s.d, false, s.seed);
    if (s.mode === 'pythagoras') s.segs = pythagoras(s.d, s.angle ?? Math.PI / 4);
    if (s.mode === 'cantor') s.segs = cantor(s.d);
  },
  step(s, dt) {
    s.t += dt;
    if (s.mode === 'mandelbrot') {
      // сначала узнаваемое целое, потом медленный зум в «долину морских коньков»
      if (s.t > 4) s.scale *= Math.exp(-0.28 * dt);
      if (s.scale < 4e-5) { s.scale = S0; s.t = 0; }
      if ((s.acc += dt) >= 1 / 30) { s.acc = 0; mandel(s); }
      return;
    }
    if (s.mode === 'julia') {
      s.a += dt * 0.045;
      julia(s);
      return;
    }
    const max = MAXD[s.mode];
    s.acc += dt;
    if (s.d < max && s.acc > 1.1) {
      s.acc = 0;
      s.d++;
      this.build(s);
    } else if (s.d >= max && s.mode !== 'pythagoras' && s.acc > 3.5) {
      s.acc = 0;
      s.d = 0;
      this.build(s);
    }
    if (s.mode === 'pythagoras') {
      s.angle = Math.PI / 4 + 0.22 * Math.sin(s.t * 0.35);
      this.build(s);
    }
  },
  draw(ctx, s) {
    if (s.segs) segments(ctx, s.segs);
    if (s.pts) poly(ctx, s.pts);
  },
};

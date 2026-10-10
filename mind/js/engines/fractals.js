// 2. Фракталы: Мандельброт и Жюлиа — изолиниями, остальные — рекурсией по глубине
import { contours, segments, poly, dot, clamp, ease, TAU, DASH } from '../core/draw.js';
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

// ——— дополнительные режимы: у каждого свои create / step / draw ———

// фаза «вперёд — пауза — назад — пауза»: ph идёт 0 → n и обратно
function pingpong(s, dt, n, up, hold, down, rest = 0.8) {
  if (s.dir === 1) {
    s.ph += dt / up;
    if (s.ph >= n) { s.ph = n; s.dir = 0; s.hold = 0; }
  } else if (s.dir === 0) {
    if ((s.hold += dt) > hold) s.dir = -1;
  } else if (s.dir === -1) {
    s.ph -= dt / down;
    if (s.ph <= 0) { s.ph = 0; s.dir = 2; s.hold = 0; }
  } else if ((s.hold += dt) > rest) s.dir = 1;
}

// Ковёр Серпинского: дыры уровня d — квадраты со стороной side/3^d
function carpetHoles(maxD) {
  const lv = [];
  let cells = [[0.08, 0.08, 0.84]];
  for (let d = 1; d <= maxD; d++) {
    const holes = [], next = [];
    for (const [x, y, w] of cells) {
      const t = w / 3;
      for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) {
        if (i === 1 && j === 1) holes.push(x + t * 1.5, y + t * 1.5, t);
        else next.push([x + i * t, y + j * t, t]);
      }
    }
    lv.push(holes);
    cells = next;
  }
  return lv;
}

// Кривая Леви: каждый отрезок — гипотенуза равнобедренного прямоугольного треугольника
function levyOrders(maxN) {
  const orders = [new Float64Array([0, 0, 1, 0])];
  for (let n = 1; n <= maxN; n++) {
    const a = orders[n - 1], m = a.length / 2 - 1, b = new Float64Array((2 * m + 1) * 2);
    for (let i = 0; i < m; i++) {
      const x1 = a[2 * i], y1 = a[2 * i + 1], x2 = a[2 * i + 2], y2 = a[2 * i + 3];
      b[4 * i] = x1; b[4 * i + 1] = y1;
      b[4 * i + 2] = (x1 + x2) / 2 + (y2 - y1) / 2;
      b[4 * i + 3] = (y1 + y2) / 2 - (x2 - x1) / 2;
    }
    b[4 * m] = a[2 * m]; b[4 * m + 1] = a[2 * m + 1];
    orders.push(b);
  }
  // общий масштаб по всем порядкам: основание остаётся на месте, кривая растёт
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const o of orders) for (let i = 0; i < o.length; i += 2) {
    x0 = Math.min(x0, o[i]); x1 = Math.max(x1, o[i]);
    y0 = Math.min(y0, o[i + 1]); y1 = Math.max(y1, o[i + 1]);
  }
  const k = 0.84 / Math.max(x1 - x0, y1 - y0);
  const ox = 0.5 - ((x0 + x1) / 2) * k, oy = 0.5 - ((y0 + y1) / 2) * k;
  for (const o of orders) for (let i = 0; i < o.length; i += 2) {
    o[i] = ox + o[i] * k;
    o[i + 1] = oy + o[i + 1] * k;
  }
  return orders;
}

// Аполлониева сетка: отражение по теореме Декарта, k' = 2(k1+k2+k3) − k4 (и то же для k·z)
function apollonian(R, rmin, maxG) {
  const C = [];
  const add = (k, kx, ky, g) => {
    const c = { k, x: kx / k, y: ky / k, r: Math.abs(1 / k), g };
    C.push(c);
    return c;
  };
  const O = add(-1 / R, -0.5 / R, -0.5 / R, 0);
  const r = R / (1 + 2 / Math.sqrt(3)), d = R - r;
  const inner = [0, 1, 2].map((i) => {
    const a = -Math.PI / 2 + (i * TAU) / 3;
    return add(1 / r, (0.5 + d * Math.cos(a)) / r, (0.5 + d * Math.sin(a)) / r, 0);
  });
  const [A, B, D] = inner;
  let q = [[A, B, D, O], [O, A, B, D], [O, B, D, A], [O, A, D, B]];
  for (let g = 1; g <= maxG && q.length; g++) {
    const next = [];
    for (const [a, b, c, o] of q) {
      const k = 2 * (a.k + b.k + c.k) - o.k;
      if (1 / k < rmin) continue;
      const kx = 2 * (a.k * a.x + b.k * b.x + c.k * c.x) - o.k * o.x;
      const ky = 2 * (a.k * a.y + b.k * b.y + c.k * c.y) - o.k * o.y;
      const n = add(k, kx, ky, g);
      next.push([a, b, n, c], [a, c, n, b], [b, c, n, a]);
    }
    q = next;
  }
  for (const c of C) c.a0 = Math.atan2(c.y - 0.5, c.x - 0.5);
  return C;
}

// L-система Линденмайера (растение из «Алгоритмической красоты растений»): X → F[+X][−X]FX, F → FF
const LRULES = { X: 'F[+X][-X]FX', F: 'FF' };
const LANG = (25.7 * Math.PI) / 180;
function lsystem(maxG) {
  const gens = [];
  let str = 'X';
  for (let g = 1; g <= maxG; g++) {
    str = [...str].map((ch) => LRULES[ch] ?? ch).join('');
    const ops = new Int8Array([...str].filter((ch) => ch !== 'X').map((ch) => '+-[]F'.indexOf(ch)));
    // габариты без ветра → масштаб и сдвиг, чтобы куст стоял по центру
    const g0 = turtle(ops, 1, 0, 0, 0, Infinity, null, 0);
    const k = Math.min(0.8 / (g0.x1 - g0.x0), 0.82 / (g0.y1 - g0.y0));
    gens.push({ ops, k, ox: 0.5 - ((g0.x0 + g0.x1) / 2) * k, nF: g0.nF, h: g0.y1 - g0.y0 });
  }
  return gens;
}
// черепаха: (x, y) — в единицах шага; wind — изгиб на единицу длины
function turtle(ops, len, ox, oy, wind, limit, ctx, phase) {
  let x = 0, y = 0, a = -Math.PI / 2, nF = 0, x0 = 0, x1 = 0, y0 = 0, y1 = 0;
  const st = [];
  if (ctx) { ctx.beginPath(); ctx.moveTo(ox, oy); }
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    if (op === 4) {
      if (nF >= limit) break;
      a += wind * Math.sin(phase + st.length * 0.35);
      const nx = x + Math.cos(a), ny = y + Math.sin(a);
      if (ctx) {
        ctx.moveTo(ox + x * len, oy + y * len);
        ctx.lineTo(ox + nx * len, oy + ny * len);
      }
      x = nx; y = ny; nF++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    } else if (op === 0) a -= LANG;
    else if (op === 1) a += LANG;
    else if (op === 2) st.push(x, y, a);
    else if (op === 3) { a = st.pop(); y = st.pop(); x = st.pop(); }
  }
  if (ctx) ctx.stroke();
  return { nF, x0, x1, y0, y1 };
}

// Закон Мюррея: r³ = r₁³ + r₂³; при равных ветвях r₁ = r·2^(−1/3), оптимальный угол cos θ = 2^(−1/3)
const MQ = Math.pow(2, -1 / 3);
const MTH = Math.acos(MQ);
function murrayTree(levels) {
  const B = [];
  const rec = (x, y, a, L, r, lv, parent, side) => {
    const b = { x, y, a, L, r, lv, parent, side, kids: [] };
    b.ex = x + Math.cos(a) * L; b.ey = y + Math.sin(a) * L;
    B.push(b);
    if (parent) parent.kids.push(b);
    if (lv < levels) {
      rec(b.ex, b.ey, a - MTH, L * 0.62, r * MQ, lv + 1, b, -1);
      rec(b.ex, b.ey, a + MTH, L * 0.62, r * MQ, lv + 1, b, 1);
    }
  };
  rec(0, 0, -Math.PI / 2, 1, 0.075, 0, null, 0);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const b of B) {
    x0 = Math.min(x0, b.x, b.ex); x1 = Math.max(x1, b.x, b.ex);
    y0 = Math.min(y0, b.y, b.ey); y1 = Math.max(y1, b.y, b.ey);
  }
  const k = Math.min(0.84 / (x1 - x0), 0.84 / (y1 - y0));
  const ox = 0.5 - ((x0 + x1) / 2) * k, oy = 0.5 - ((y0 + y1) / 2) * k;
  for (const b of B) {
    b.x = ox + b.x * k; b.y = oy + b.y * k; b.ex = ox + b.ex * k; b.ey = oy + b.ey * k;
    b.L *= k; b.r *= k;
    b.dx = Math.cos(b.a); b.dy = Math.sin(b.a);
    b.nx = -b.dy; b.ny = b.dx;
  }
  return B;
}

// рамка с фаской: внешний и внутренний контур, углы соединены
function frame(ctx, cx, cy, h, rot, inner) {
  const c = Math.cos(rot), s = Math.sin(rot), hi = h * inner;
  const P = (u, v) => [cx + u * c - v * s, cy + u * s + v * c];
  const o = [P(-h, -h), P(h, -h), P(h, h), P(-h, h)];
  const n = [P(-hi, -hi), P(hi, -hi), P(hi, hi), P(-hi, hi)];
  ctx.moveTo(o[0][0], o[0][1]);
  for (let i = 1; i <= 4; i++) ctx.lineTo(o[i % 4][0], o[i % 4][1]);
  ctx.moveTo(n[0][0], n[0][1]);
  for (let i = 1; i <= 4; i++) ctx.lineTo(n[i % 4][0], n[i % 4][1]);
  for (let i = 0; i < 4; i++) { ctx.moveTo(o[i][0], o[i][1]); ctx.lineTo(n[i][0], n[i][1]); }
}

const EXTRA = {
  carpet: {
    create() { return { mode: 'carpet', t: 0, ph: 0, dir: 1, hold: 0, lv: carpetHoles(4) }; },
    step(s, dt) { s.t += dt; pingpong(s, dt, 4, 1.4, 4, 0.35, 1); },
    draw(ctx, s) {
      ctx.strokeRect(0.08, 0.08, 0.84, 0.84);
      ctx.beginPath();
      for (let d = 0; d < s.lv.length; d++) {
        const u = ease(clamp(s.ph - d, 0, 1));
        if (u <= 0) break;
        const h = s.lv[d];
        for (let i = 0; i < h.length; i += 3) {
          const w = h[i + 2] * u;
          ctx.rect(h[i] - w / 2, h[i + 1] - w / 2, w, w);
        }
      }
      ctx.stroke();
    },
  },

  levy: {
    create() { return { mode: 'levy', t: 0, ph: 0, dir: 1, hold: 0, o: levyOrders(11) }; },
    step(s, dt) { s.t += dt; pingpong(s, dt, 11, 1.1, 4, 0.22, 1); },
    draw(ctx, s) {
      const n = Math.min(Math.floor(s.ph), 10), u = ease(clamp(s.ph - n, 0, 1));
      const a = s.o[n], b = s.o[n + 1], m = a.length / 2 - 1;
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      for (let i = 0; i < m; i++) {
        const mx = (a[2 * i] + a[2 * i + 2]) / 2, my = (a[2 * i + 1] + a[2 * i + 3]) / 2;
        ctx.lineTo(mx + (b[4 * i + 2] - mx) * u, my + (b[4 * i + 3] - my) * u);
        ctx.lineTo(a[2 * i + 2], a[2 * i + 3]);
      }
      ctx.stroke();
      if (n < 3) {
        // предыдущий порядок — пунктиром, пока отрезков мало
        ctx.save(); ctx.setLineDash(DASH); poly(ctx, a); ctx.restore();
      }
    },
  },

  apollonian: {
    create() {
      const C = apollonian(0.43, 0.0045, 7);
      return { mode: 'apollonian', t: 0, ph: 0, dir: 1, hold: 0, C, G: Math.max(...C.map((c) => c.g)) + 1 };
    },
    step(s, dt) { s.t += dt; pingpong(s, dt, s.G, 1.2, 5, 0.3, 1); },
    draw(ctx, s) {
      ctx.save();
      ctx.translate(0.5, 0.5); ctx.rotate(s.t * 0.025); ctx.translate(-0.5, -0.5);
      ctx.beginPath();
      for (const c of s.C) {
        const u = c.g === 0 ? 1 : ease(clamp(s.ph - c.g + 1, 0, 1));
        if (u <= 0) continue;
        ctx.moveTo(c.x + c.r * Math.cos(c.a0), c.y + c.r * Math.sin(c.a0));
        ctx.arc(c.x, c.y, c.r, c.a0, c.a0 + TAU * u);
      }
      ctx.stroke();
      ctx.restore();
    },
  },

  fern: {
    create(p, rng) {
      const N = 9000;
      return { mode: 'fern', t: 0, n: 0, N, xs: new Float32Array(N), ys: new Float32Array(N), x: 0, y: 0, r: mulberry32((rng() * 1e9) | 0) };
    },
    step(s, dt) {
      s.t += dt;
      if (s.t > 16) { s.t = 0; s.n = 0; s.x = 0; s.y = 0; }
      const want = Math.min(s.N, Math.floor(30 + 220 * s.t + 70 * s.t * s.t));
      while (s.n < want) {
        const q = s.r(), x = s.x, y = s.y;
        if (q < 0.01) { s.x = 0; s.y = 0.16 * y; }
        else if (q < 0.86) { s.x = 0.85 * x + 0.04 * y; s.y = -0.04 * x + 0.85 * y + 1.6; }
        else if (q < 0.93) { s.x = 0.2 * x - 0.26 * y; s.y = 0.23 * x + 0.22 * y + 1.6; }
        else { s.x = -0.15 * x + 0.28 * y; s.y = 0.26 * x + 0.24 * y + 0.44; }
        s.xs[s.n] = 0.5 + (s.x - 0.24) * 0.087;
        s.ys[s.n] = 0.935 - s.y * 0.087;
        s.n++;
      }
    },
    draw(ctx, s) {
      const w = 0.0034, h = w / 2;
      ctx.beginPath();
      for (let i = 0; i < s.n; i++) ctx.rect(s.xs[i] - h, s.ys[i] - h, w, w);
      ctx.fill();
      if (s.n > 1) dot(ctx, s.xs[s.n - 1], s.ys[s.n - 1], 0.006);
    },
  },

  lsystem: {
    create() { return { mode: 'lsystem', t: 0, ph: 0, dir: 1, hold: 0, G: lsystem(6) }; },
    step(s, dt) { s.t += dt; pingpong(s, dt, 6, 1.6, 5, 0.25, 0.6); },
    draw(ctx, s) {
      // поколение g рисуется «ростом» по порядку строки; прошлое — пунктиром под ним
      const g = clamp(Math.ceil(s.ph) - 1, 0, s.G.length - 1), u = clamp(s.ph - g, 0, 1);
      const G = s.G[g];
      const len = (G.k * 1);
      const wind = (0.06 * Math.sin(s.t * 0.7)) / G.h;
      if (g > 0 && g < 4 && u < 1) {
        const P = s.G[g - 1];
        ctx.save(); ctx.setLineDash(DASH);
        turtle(P.ops, P.k, P.ox, 0.92, (0.06 * Math.sin(s.t * 0.7)) / P.h, Infinity, ctx, s.t * 0.9);
        ctx.restore();
      }
      turtle(G.ops, len, G.ox, 0.92, wind, Math.max(1, Math.ceil(G.nF * ease(u))), ctx, s.t * 0.9);
    },
  },

  murray: {
    create(p, rng) {
      const B = murrayTree(6);
      const r = mulberry32((rng() * 1e9) | 0);
      const flow = [];
      for (let i = 0; i < 14; i++) flow.push({ b: B[0], p: -r() * 3, r });
      return { mode: 'murray', t: 0, ph: 0, dir: 1, hold: 0, B, flow, LV: 7 };
    },
    step(s, dt) {
      s.t += dt;
      pingpong(s, dt, s.LV, 0.65, 14, 0.15, 0.6);
      if (s.dir !== 0) return;
      // скорость кровотока ∝ r: поток Q ∝ r³ делится на сечение ∝ r²
      const r0 = s.B[0].r;
      for (const f of s.flow) {
        f.p += (dt * 0.5 * (f.b.r / r0)) / Math.max(f.b.L, 1e-6) * s.B[0].L;
        while (f.p >= 1) {
          if (f.b.kids.length) { f.b = f.b.kids[f.r() < 0.5 ? 0 : 1]; f.p -= 1; }
          else { f.b = s.B[0]; f.p = -f.r() * 0.6; }
        }
      }
    },
    draw(ctx, s) {
      ctx.beginPath();
      const thin = 0.0038;
      for (const b of s.B) {
        const u = clamp(s.ph + 0.25 - b.lv, 0, 1);
        if (u <= 0) continue;
        const L = b.L * u;
        if (b.r < thin) {
          ctx.moveTo(b.x, b.y); ctx.lineTo(b.x + b.dx * L, b.y + b.dy * L);
          continue;
        }
        // стенки сосуда; внутренние стенки сестёр начинаются в развилке
        const t0 = b.parent ? Math.min(L, b.r / Math.tan(MTH)) : 0;
        for (const sg of [-1, 1]) {
          const ox = b.nx * b.r * sg, oy = b.ny * b.r * sg;
          const inner = b.parent && sg === -b.side;
          const ts = inner ? t0 : 0;
          if (ts >= L) continue;
          if (b.parent && !inner && b.parent.r >= thin) {
            const P = b.parent;
            ctx.moveTo(P.ex + P.nx * P.r * b.side, P.ey + P.ny * P.r * b.side);
            ctx.lineTo(b.x + ox, b.y + oy);
          } else ctx.moveTo(b.x + ox + b.dx * ts, b.y + oy + b.dy * ts);
          ctx.lineTo(b.x + ox + b.dx * L, b.y + oy + b.dy * L);
        }
      }
      ctx.stroke();
      if (s.dir !== 0) return;
      for (const f of s.flow) {
        if (f.p < 0) continue;
        dot(ctx, f.b.x + f.b.dx * f.b.L * f.p, f.b.y + f.b.dy * f.b.L * f.p, 0.006);
      }
    },
  },

  droste: {
    create() { return { mode: 'droste', t: 0 }; },
    step(s, dt) { s.t += dt; },
    draw(ctx, s) {
      // окно неподвижно; рамки внутри растут к нему, и первая, дорастая, сливается с окном
      const K = 0.74, ROT = (6 * Math.PI) / 180, H = 0.43, IN = 0.86, T = 4.5;
      const u = (s.t / T) % 1;
      ctx.beginPath();
      ctx.rect(0.5 - H, 0.5 - H, 2 * H, 2 * H);
      for (let i = 1; i < 40; i++) {
        const sc = Math.pow(K, i - u);
        if (H * sc < 0.035) break;
        const flat = i === 1 ? ease(clamp((u - 0.5) / 0.5, 0, 1)) : 0;
        frame(ctx, 0.5, 0.5, H * sc, (i - u) * ROT, IN + (1 - IN) * flat);
      }
      ctx.stroke();
    },
  },
};

const MAXD = { sierpinski: 7, koch: 5, coast: 6, pythagoras: 10, cantor: 6 };

export default {
  id: 'fractals',
  create(p, rng) {
    if (EXTRA[p.mode]) return EXTRA[p.mode].create(p, rng);
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
    if (EXTRA[s.mode]) return EXTRA[s.mode].step(s, dt);
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
    if (EXTRA[s.mode]) return EXTRA[s.mode].draw(ctx, s);
    if (s.segs) segments(ctx, s.segs);
    if (s.pts) poly(ctx, s.pts);
  },
};

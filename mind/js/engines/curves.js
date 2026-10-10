// 1. Кривые, заполняющие пространство: рисуются по порядкам
import { poly, dot, dots, circle, line, ease, clamp, TAU, DASH } from '../core/draw.js';

const M = 0.07; // поле внутри рамки

function place(raw, n, flipY = true) {
  const out = new Float32Array(raw.length);
  const k = (1 - 2 * M) / n;
  for (let i = 0; i < raw.length; i += 2) {
    out[i] = M + (raw[i] + 0.5) * k;
    out[i + 1] = flipY ? 1 - M - (raw[i + 1] + 0.5) * k : M + (raw[i + 1] + 0.5) * k;
  }
  return out;
}

function hilbert(order) {
  const n = 1 << order;
  const N = n * n;
  const raw = new Float32Array(N * 2);
  for (let d = 0; d < N; d++) {
    let t = d, x = 0, y = 0;
    for (let s = 1; s < n; s *= 2) {
      const rx = 1 & (t >> 1);
      const ry = 1 & (t ^ rx);
      if (!ry) {
        if (rx) { x = s - 1 - x; y = s - 1 - y; }
        const tmp = x; x = y; y = tmp;
      }
      x += s * rx;
      y += s * ry;
      t >>= 2;
    }
    raw[d * 2] = x;
    raw[d * 2 + 1] = y;
  }
  return place(raw, n);
}

// Формула Пеано: цифры троичной записи с дополнением k(t)=2−t по чётности сумм
function peano(order) {
  const n = 3 ** order;
  const N = n * n;
  const raw = new Float32Array(N * 2);
  const digits = new Array(order * 2);
  for (let d = 0; d < N; d++) {
    let t = d;
    for (let i = order * 2 - 1; i >= 0; i--) { digits[i] = t % 3; t = (t / 3) | 0; }
    let sx = 0, sy = 0, x = 0, y = 0;
    for (let j = 0; j < order; j++) {
      const ax = digits[2 * j];
      const ay = digits[2 * j + 1];
      const bx = sy & 1 ? 2 - ax : ax;
      sx += ax;
      const by = sx & 1 ? 2 - ay : ay;
      sy += ay;
      x = x * 3 + bx;
      y = y * 3 + by;
    }
    raw[d * 2] = x;
    raw[d * 2 + 1] = y;
  }
  return place(raw, n);
}

function morton(order) {
  const n = 1 << order;
  const N = n * n;
  const raw = new Float32Array(N * 2);
  for (let d = 0; d < N; d++) {
    let x = 0, y = 0;
    for (let b = 0; b < order; b++) {
      x |= ((d >> (2 * b)) & 1) << b;
      y |= ((d >> (2 * b + 1)) & 1) << b;
    }
    raw[d * 2] = x;
    raw[d * 2 + 1] = y;
  }
  return place(raw, n, false);
}

// Кривая дракона: последовательность поворотов из сгибания полоски бумаги
function dragon(order) {
  const N = 1 << order;
  const pts = new Float32Array((N + 1) * 2);
  let x = 0, y = 0, dir = 0;
  const dx = [1, 0, -1, 0];
  const dy = [0, 1, 0, -1];
  pts[0] = 0; pts[1] = 0;
  for (let i = 1; i <= N; i++) {
    x += dx[dir]; y += dy[dir];
    pts[i * 2] = x; pts[i * 2 + 1] = y;
    const right = (((i & -i) << 1) & i) !== 0;
    dir = (dir + (right ? 3 : 1)) & 3;
  }
  // вписываем в квадрат с сохранением пропорций
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    x0 = Math.min(x0, pts[i]); x1 = Math.max(x1, pts[i]);
    y0 = Math.min(y0, pts[i + 1]); y1 = Math.max(y1, pts[i + 1]);
  }
  const s = (1 - 2 * M - 0.06) / Math.max(x1 - x0, y1 - y0, 1);
  const ox = 0.5 - ((x1 - x0) * s) / 2;
  const oy = 0.5 - ((y1 - y0) * s) / 2;
  for (let i = 0; i < pts.length; i += 2) {
    pts[i] = ox + (pts[i] - x0) * s;
    pts[i + 1] = oy + (pts[i + 1] - y0) * s;
  }
  return pts;
}

// L-система → строка команд
function lsys(axiom, rules, n) {
  let str = axiom;
  for (let k = 0; k < n; k++) {
    let next = '';
    for (const ch of str) next += rules[ch] ?? ch;
    str = next;
  }
  return str;
}

// черепаха: draw — символы-шаги, ang — угол поворота; возвращает плоский массив вершин
function turtle(str, draw, ang) {
  const pts = [0, 0];
  let x = 0, y = 0, a = 0;
  for (const ch of str) {
    if (ch === '+') a += ang;
    else if (ch === '-') a -= ang;
    else if (draw.includes(ch)) {
      x += Math.cos(a); y += Math.sin(a);
      pts.push(Math.round(x * 1e6) / 1e6, Math.round(y * 1e6) / 1e6);
    }
  }
  return pts;
}

// Кривая Мура: замкнутая родственница кривой Гилберта, четыре копии по кругу
function moore(order) {
  const pts = turtle(lsys('LFL+F+LFL', { L: '-RF+LFL+FR-', R: '+LF-RFR-FL+' }, order - 1), 'F', Math.PI / 2);
  let x0 = Infinity, y0 = Infinity;
  for (let i = 0; i < pts.length; i += 2) { x0 = Math.min(x0, pts[i]); y0 = Math.min(y0, pts[i + 1]); }
  for (let i = 0; i < pts.length; i += 2) { pts[i] -= x0; pts[i + 1] -= y0; }
  return place(pts, 1 << order);
}

// Кривая Госпера: шестиугольная «змейка-снежинка»; все порядки приводим к одному отрезку «начало — конец»,
// поэтому они ложатся друг на друга и сходятся к одному острову
const GOSPER = { A: 'A-B--B+A++AA+B-', B: '+A-BB--B-A++A+B' };
const GMAX = 4;
function gosperRaw(order) {
  const pts = turtle(lsys('A', GOSPER, order), 'AB', Math.PI / 3);
  const ex = pts[pts.length - 2], ey = pts[pts.length - 1];
  const L = Math.hypot(ex, ey), c = ex / L, sn = ey / L;
  const out = new Float32Array(pts.length);
  for (let i = 0; i < pts.length; i += 2) {
    out[i] = (pts[i] * c + pts[i + 1] * sn) / L;
    out[i + 1] = (-pts[i] * sn + pts[i + 1] * c) / L;
  }
  return out;
}
let gosperFit = null;
function gosper(order) {
  if (!gosperFit) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const r = gosperRaw(GMAX); // младшие порядки вписаны в остров старшего
    for (let i = 0; i < r.length; i += 2) {
      x0 = Math.min(x0, r[i]); x1 = Math.max(x1, r[i]);
      y0 = Math.min(y0, r[i + 1]); y1 = Math.max(y1, r[i + 1]);
    }
    const k = 0.84 / Math.max(x1 - x0, y1 - y0);
    gosperFit = { k, ox: 0.5 - ((x0 + x1) / 2) * k, oy: 0.5 + ((y0 + y1) / 2) * k };
  }
  const { k, ox, oy } = gosperFit;
  const r = gosperRaw(order);
  for (let i = 0; i < r.length; i += 2) { r[i] = ox + r[i] * k; r[i + 1] = oy - r[i + 1] * k; }
  return r;
}

const BUILD = { hilbert, peano, morton, dragon, moore, gosper };
const MAX = { hilbert: 6, peano: 4, morton: 5, dragon: 13, moore: 5, gosper: GMAX };
const MIN = { hilbert: 1, peano: 1, morton: 1, dragon: 3, moore: 1, gosper: 1 };

// ——— режимы со своей анимацией (не по порядкам) ———
const EXTRA = {};

// Спираль Улама: числа укладываются квадратной спиралью, простые остаются точками
const UG = 45, UH = (UG - 1) / 2, UC = 0.44 / UH;
let ulamData = null;
function ulamBuild() {
  const N = UG * UG;
  const pts = new Float32Array(N * 2); // число n → вершина n − 1
  const DX = [1, 0, -1, 0], DY = [0, -1, 0, 1];
  let x = 0, y = 0, n = 1, dir = 0, leg = 1;
  pts[0] = 0.5; pts[1] = 0.5;
  while (n < N) {
    for (let rep = 0; rep < 2; rep++) {
      for (let i = 0; i < leg && n < N; i++) {
        x += DX[dir]; y += DY[dir]; n++;
        pts[(n - 1) * 2] = 0.5 + x * UC;
        pts[(n - 1) * 2 + 1] = 0.5 + y * UC;
      }
      dir = (dir + 1) & 3;
    }
    leg++;
  }
  const comp = new Uint8Array(N + 1);
  comp[0] = comp[1] = 1;
  for (let i = 2; i * i <= N; i++) if (!comp[i]) for (let j = i * i; j <= N; j += i) comp[j] = 1;
  const px = [], py = [], pc = new Uint16Array(N + 1);
  for (let k = 1; k <= N; k++) {
    if (!comp[k]) { px.push(pts[(k - 1) * 2]); py.push(pts[(k - 1) * 2 + 1]); }
    pc[k] = px.length;
  }
  return { N, pts, px, py, pc };
}
EXTRA.ulam = {
  create() { return { R: 0, hold: 0 }; },
  step(s, dt) {
    if ((2 * s.R + 1) ** 2 < UG * UG) s.R += dt / 0.42;
    else if ((s.hold += dt) > 3.5) { s.R = 0; s.hold = 0; }
  },
  draw(ctx, s) {
    const U = ulamData || (ulamData = ulamBuild());
    const n = Math.max(1, Math.min(U.N, Math.floor((2 * s.R + 1) ** 2)));
    const ring = Math.ceil((Math.sqrt(n) - 1) / 2);
    // след — только последний виток спирали
    poly(ctx, U.pts, n, false, Math.max(0, n - 1 - 8 * Math.max(ring, 1)));
    circle(ctx, 0.5, 0.5, 0.008);
    dots(ctx, U.px, U.py, 0.0052, U.pc[n]);
    dot(ctx, U.pts[(n - 1) * 2], U.pts[(n - 1) * 2 + 1], 0.006);
  },
};

// Филлотаксис по Фогелю: новое семечко рождается в центре под золотым углом и оттесняет старые
const GOLD = Math.PI * (3 - Math.sqrt(5)); // ≈ 137,5°
const PV = 230, PR = 0.405, PC = PR / Math.sqrt(PV), PS = 0.0115;
EXTRA.phyllo = {
  create() { return { n: 70 }; },
  step(s, dt) { s.n += dt * 24; },
  draw(ctx, s) {
    const top = Math.floor(s.n);
    const i0 = Math.max(0, Math.ceil(s.n - PV));
    ctx.beginPath();
    for (let i = i0; i <= top; i++) {
      const age = s.n - i;
      const r = PC * Math.sqrt(age), a = i * GOLD;
      const rs = PS * clamp(Math.min(age / 4, (PV - age) / 14), 0, 1);
      if (rs < PS * 0.3) continue;
      const x = 0.5 + r * Math.cos(a), y = 0.5 + r * Math.sin(a);
      ctx.moveTo(x + rs, y);
      ctx.arc(x, y, rs, 0, TAU);
    }
    ctx.stroke();
    // две спирали-парастихи: соседи через 13 и через 21 — числа Фибоначчи
    ctx.save();
    ctx.setLineDash(DASH);
    for (const [F, ph] of [[13, 5], [21, 11]]) {
      ctx.beginPath();
      let first = true;
      let i = top - ((((top - ph) % F) + F) % F);
      for (; i >= i0; i -= F) {
        const age = s.n - i;
        if (age < 30) continue;
        if (age > PV - 14) break;
        const r = PC * Math.sqrt(age), a = i * GOLD;
        const x = 0.5 + r * Math.cos(a), y = 0.5 + r * Math.sin(a);
        if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();
  },
};

// Случайное блуждание на решётке: след, пунктирный круг радиуса √n шагов — типичное удаление от старта
const WS = 0.02, WL = 21, WN = WL * WL;
EXTRA.walk = {
  create() { return { pts: [0.5, 0.5], x: 0, y: 0, acc: 0, hold: 0 }; },
  step(s, dt, rng) {
    const n = s.pts.length / 2 - 1;
    if (n < WN) {
      s.acc += dt * 32;
      while (s.acc >= 1 && s.pts.length / 2 - 1 < WN) {
        s.acc -= 1;
        const d = Math.floor(rng() * 4);
        let dx = d === 0 ? 1 : d === 1 ? -1 : 0, dy = d === 2 ? 1 : d === 3 ? -1 : 0;
        if (Math.abs(s.x + dx) > WL || Math.abs(s.y + dy) > WL) { dx = -dx; dy = -dy; }
        s.x += dx; s.y += dy;
        s.pts.push(0.5 + s.x * WS, 0.5 + s.y * WS);
      }
    } else if ((s.hold += dt) > 2.5) {
      s.pts = [0.5, 0.5]; s.x = 0; s.y = 0; s.acc = 0; s.hold = 0;
    }
  },
  draw(ctx, s) {
    const n = s.pts.length / 2;
    ctx.save();
    ctx.setLineDash(DASH);
    circle(ctx, 0.5, 0.5, WS * Math.sqrt(n - 1));
    ctx.restore();
    poly(ctx, s.pts);
    circle(ctx, 0.5, 0.5, 0.008);
    dot(ctx, s.pts[n * 2 - 2], s.pts[n * 2 - 1], 0.006);
  },
};

// Сворачивание белка: цепочка на квадратной решётке (HP-модель) скручивается в плотный клубок.
// Конечная форма — квадратная спираль; повороты включаются от свободного конца, цепь «скатывается»
let foldData = null;
function foldBuild() {
  const legs = [1, 1, 2, 2, 3, 3, 4, 4, 5, 5];
  const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];
  const F = [[0, 0]], dirs = [];
  let x = 0, y = 0, d = 0;
  for (const L of legs) {
    for (let i = 0; i < L; i++) { x += DX[d]; y += DY[d]; F.push([x, y]); dirs.push(d); }
    d = (d + 1) & 3;
  }
  const N = F.length;
  const turn = new Float32Array(N); // поворот в вершине j: между связями (j−1, j) и (j, j+1)
  const T = [];
  for (let j = 1; j < N - 1; j++) {
    const dd = (dirs[j] - dirs[j - 1] + 4) & 3;
    turn[j] = dd === 1 ? Math.PI / 2 : dd === 3 ? -Math.PI / 2 : 0;
    if (turn[j]) T.push(j);
  }
  // гидрофобные (H) — те, у кого в свёрнутом виде ≥ 2 несвязанных соседа: ядро клубка
  const key = (p) => p[0] * 100 + p[1];
  const at = new Map(F.map((p, i) => [key(p), i]));
  const H = new Uint8Array(N), contacts = [];
  for (let i = 0; i < N; i++) {
    let c = 0;
    for (let k = 0; k < 4; k++) {
      const j = at.get(key([F[i][0] + DX[k], F[i][1] + DY[k]]));
      if (j !== undefined && Math.abs(i - j) > 1) c++;
    }
    H[i] = c >= 2 ? 1 : 0;
  }
  for (let i = 0; i < N; i++) for (let k = 0; k < 2; k++) {
    const j = at.get(key([F[i][0] + DX[k], F[i][1] + DY[k]]));
    if (j !== undefined && Math.abs(i - j) > 1 && H[i] && H[j]) contacts.push(i, j);
  }
  return { N, turn, T, H, contacts };
}
const FG = 0.6, FSPEED = 1 / 0.85;
EXTRA.fold = {
  create() { return { t: 0, xs: null, ys: null }; },
  step(s, dt) { s.t += dt; },
  draw(ctx, s) {
    const D = foldData || (foldData = foldBuild());
    const U = FG * (D.T.length - 1) + 1, dur = U / FSPEED;
    const cyc = [1.4, dur, 2.6, dur, 0.4], P = cyc.reduce((a, b) => a + b, 0);
    let t = s.t % P, u;
    if (t < cyc[0]) u = 0;
    else if ((t -= cyc[0]) < cyc[1]) u = t * FSPEED;
    else if ((t -= cyc[1]) < cyc[2]) u = U;
    else if ((t -= cyc[2]) < cyc[3]) u = U - t * FSPEED;
    else u = 0;
    const a = new Float32Array(D.N);
    D.T.forEach((j, m) => { a[j] = ease(clamp(u - FG * m, 0, 1)); });
    // от закреплённого конца к свободному: угол связи (j−1, j) = угол (j, j+1) − a·поворот
    const N = D.N, xs = new Float32Array(N), ys = new Float32Array(N);
    let ang = 0;
    for (let j = N - 2; j >= 0; j--) {
      if (j < N - 2) ang -= a[j + 1] * D.turn[j + 1];
      xs[j] = xs[j + 1] - Math.cos(ang);
      ys[j] = ys[j + 1] - Math.sin(ang);
    }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let j = 0; j < N; j++) {
      x0 = Math.min(x0, xs[j]); x1 = Math.max(x1, xs[j]);
      y0 = Math.min(y0, ys[j]); y1 = Math.max(y1, ys[j]);
    }
    const k = Math.min(0.075, 0.82 / Math.max(x1 - x0, y1 - y0, 1));
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    for (let j = 0; j < N; j++) { xs[j] = 0.5 + (xs[j] - cx) * k; ys[j] = 0.5 - (ys[j] - cy) * k; }
    const rr = 0.0085;
    // связи — от края до края бусин
    ctx.beginPath();
    for (let j = 0; j < N - 1; j++) {
      const dx = xs[j + 1] - xs[j], dy = ys[j + 1] - ys[j], L = Math.hypot(dx, dy);
      if (L <= 2 * rr) continue;
      const ux = dx / L, uy = dy / L;
      ctx.moveTo(xs[j] + ux * rr, ys[j] + uy * rr);
      ctx.lineTo(xs[j + 1] - ux * rr, ys[j + 1] - uy * rr);
    }
    ctx.stroke();
    // P — контуры, H — точки
    ctx.beginPath();
    for (let j = 0; j < N; j++) if (!D.H[j]) { ctx.moveTo(xs[j] + rr, ys[j]); ctx.arc(xs[j], ys[j], rr, 0, TAU); }
    ctx.stroke();
    ctx.beginPath();
    for (let j = 0; j < N; j++) if (D.H[j]) { ctx.moveTo(xs[j] + rr * 0.8, ys[j]); ctx.arc(xs[j], ys[j], rr * 0.8, 0, TAU); }
    ctx.fill();
    // сложившиеся гидрофобные контакты — пунктиром
    ctx.save();
    ctx.setLineDash(DASH);
    ctx.beginPath();
    for (let c = 0; c < D.contacts.length; c += 2) {
      const i = D.contacts[c], j = D.contacts[c + 1];
      const L = Math.hypot(xs[j] - xs[i], ys[j] - ys[i]);
      if (L > k * 1.06) continue;
      const ux = (xs[j] - xs[i]) / L, uy = (ys[j] - ys[i]) / L;
      ctx.moveTo(xs[i] + ux * rr, ys[i] + uy * rr);
      ctx.lineTo(xs[j] - ux * rr, ys[j] - uy * rr);
    }
    ctx.stroke();
    ctx.restore();
  },
};

// «Водоросль» Коллатца: путь каждого числа к единице, развёрнутый от корня;
// чётный шаг поворачивает в одну сторону, нечётный — в другую. Общие участки путей срастаются в ствол
const CN = 1000, CE = 0.22, CO = -0.4, CD = 0.04; // CD — укорочение звеньев с глубиной
let collatzData = null;
function collatzBuild() {
  const id = new Map([[1, 0]]);
  const par = [-1], val = [1];
  const order = []; // порядок прорастания: узлы новой ветви от развилки к кончику
  for (let n = 2; n <= CN; n++) {
    const path = [];
    let v = n;
    while (!id.has(v)) { path.push(v); v = v % 2 ? 3 * v + 1 : v / 2; }
    for (let i = path.length - 1; i >= 0; i--) {
      const w = path[i];
      id.set(w, val.length);
      par.push(id.get(i === path.length - 1 ? v : path[i + 1]));
      val.push(w);
      order.push(val.length - 1);
    }
  }
  const M = val.length;
  const x = new Float64Array(M), y = new Float64Array(M), a = new Float64Array(M);
  const dep = new Float64Array(M);
  a[0] = -Math.PI / 2;
  for (let i = 1; i < M; i++) { // родитель всегда создан раньше
    const p = par[i], L = 1 / (1 + CD * (dep[i] = dep[p] + 1));
    a[i] = a[p] + (val[i] % 2 ? CO : CE);
    x[i] = x[p] + L * Math.cos(a[i]);
    y[i] = y[p] + L * Math.sin(a[i]);
  }
  // поворачиваем куст так, чтобы от корня он рос вверх: корень — центр масс по вертикали
  let mx = 0, my = 0;
  for (let i = 0; i < M; i++) { mx += x[i] / M; my += y[i] / M; }
  const rot = -Math.PI / 2 - Math.atan2(my, mx), rc = Math.cos(rot), rs = Math.sin(rot);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < M; i++) {
    const X = x[i] * rc - y[i] * rs, Y = x[i] * rs + y[i] * rc;
    x[i] = X; y[i] = Y;
    x0 = Math.min(x0, X); x1 = Math.max(x1, X);
    y0 = Math.min(y0, Y); y1 = Math.max(y1, Y);
  }
  const k = 0.86 / Math.max(x1 - x0, y1 - y0);
  const X = new Float32Array(M), Y = new Float32Array(M);
  for (let i = 0; i < M; i++) {
    X[i] = 0.5 + (x[i] - (x0 + x1) / 2) * k;
    Y[i] = 0.5 + (y[i] - (y0 + y1) / 2) * k;
  }
  return { X, Y, par: Int32Array.from(par), order: Int32Array.from(order) };
}
EXTRA.collatz = {
  create() { return { g: 0, hold: 0 }; },
  step(s, dt) {
    const C = collatzData || (collatzData = collatzBuild());
    if (s.g < C.order.length) s.g = Math.min(C.order.length, s.g + dt * (60 + s.g * 0.09));
    else if ((s.hold += dt) > 3.5) { s.g = 0; s.hold = 0; }
  },
  draw(ctx, s) {
    const C = collatzData || (collatzData = collatzBuild());
    const { X, Y, par, order } = C;
    const g = Math.floor(s.g);
    ctx.beginPath();
    let last = 0;
    ctx.moveTo(X[0], Y[0]);
    for (let q = 0; q < g; q++) {
      const i = order[q], p = par[i];
      if (p !== last) ctx.moveTo(X[p], Y[p]);
      ctx.lineTo(X[i], Y[i]);
      last = i;
    }
    let hx = X[last], hy = Y[last];
    if (g < order.length) { // растущий кончик
      const i = order[g], p = par[i], f = s.g - g;
      if (p !== last) ctx.moveTo(X[p], Y[p]);
      hx = X[p] + (X[i] - X[p]) * f; hy = Y[p] + (Y[i] - Y[p]) * f;
      ctx.lineTo(hx, hy);
    }
    ctx.stroke();
    circle(ctx, X[0], Y[0], 0.008);
    dot(ctx, hx, hy, 0.006);
  },
};

// Ряд Фурье: цепочка вращающихся окружностей; кончик последней обводит фигуру
const FK = 12, FM = 256, FT = 320;
function resample(poly, M) {
  const P = [...poly, poly[0]];
  const L = [0];
  for (let i = 1; i < P.length; i++) L.push(L[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
  const out = [];
  let k = 0;
  for (let j = 0; j < M; j++) {
    const d = (j / M) * L[L.length - 1];
    while (L[k + 1] < d) k++;
    const f = (d - L[k]) / (L[k + 1] - L[k] || 1);
    out.push([P[k][0] + (P[k + 1][0] - P[k][0]) * f, P[k][1] + (P[k + 1][1] - P[k][1]) * f]);
  }
  return out;
}
const FSHAPES = [
  () => [[-1, -1], [1, -1], [1, 1], [-1, 1]],
  () => [0, 1, 2].map((i) => [Math.cos(-Math.PI / 2 + (i * TAU) / 3), Math.sin(-Math.PI / 2 + (i * TAU) / 3)]),
  () => Array.from({ length: 200 }, (_, i) => {
    const t = (i / 200) * TAU, q = 1 + Math.sin(t) ** 2;
    return [(1.3 * Math.cos(t)) / q, (1.3 * Math.sin(t) * Math.cos(t)) / q];
  }),
];
let fourierData = null;
function fourierBuild() {
  return FSHAPES.map((mk) => {
    const z = resample(mk(), FM);
    const terms = [];
    for (let f = -FK; f <= FK; f++) {
      let re = 0, im = 0;
      for (let j = 0; j < FM; j++) {
        const a = (-TAU * f * j) / FM;
        re += z[j][0] * Math.cos(a) - z[j][1] * Math.sin(a);
        im += z[j][0] * Math.sin(a) + z[j][1] * Math.cos(a);
      }
      terms.push({ f, re: re / FM, im: im / FM, r: Math.hypot(re, im) / FM, ph: Math.atan2(im, re) });
    }
    const rest = terms.filter((t) => t.f !== 0).sort((a, b) => b.r - a.r);
    const S = 0.43 / rest.reduce((acc, t) => acc + t.r, 0);
    const ox = 0.5, oy = 0.5; // центр фигуры — в центре квадрата
    const trace = new Float32Array((FT + 1) * 2);
    for (let q = 0; q <= FT; q++) {
      let x = ox, y = oy;
      for (const t of rest) { const a = t.ph + (TAU * t.f * q) / FT; x += t.r * S * Math.cos(a); y += t.r * S * Math.sin(a); }
      trace[q * 2] = x; trace[q * 2 + 1] = y;
    }
    return { rest, S, ox, oy, trace };
  });
}
const FPER = 9, FHOLD = 0.3;
EXTRA.fourier = {
  create() { return { t: 0 }; },
  step(s, dt) { s.t += dt; },
  draw(ctx, s) {
    const FD = fourierData || (fourierData = fourierBuild());
    const cyc = s.t / (FPER * (1 + FHOLD));
    const sh = FD[Math.floor(cyc) % FD.length];
    const ph = (cyc % 1) * (1 + FHOLD); // 0..1 — рисуем, дальше — замкнутая фигура и обороты
    let x = sh.ox, y = sh.oy;
    const arm = [x, y];
    for (const t of sh.rest) {
      const r = t.r * sh.S;
      if (r > 0.0035) circle(ctx, x, y, r);
      const a = t.ph + TAU * t.f * ph;
      x += r * Math.cos(a); y += r * Math.sin(a);
      arm.push(x, y);
    }
    poly(ctx, arm);
    if (ph >= 1) poly(ctx, sh.trace, FT + 1);
    else {
      const c = Math.floor(ph * FT) + 1;
      poly(ctx, sh.trace, c);
      line(ctx, sh.trace[c * 2 - 2], sh.trace[c * 2 - 1], x, y);
    }
    dot(ctx, x, y, 0.006);
  },
};

export default {
  id: 'curves',
  create(p, rng) {
    const mode = p.mode || 'hilbert';
    if (EXTRA[mode]) return { mode, rng, ...EXTRA[mode].create(p, rng) };
    return { mode, max: p.maxOrder || MAX[mode], order: MIN[mode], p: 0, hold: 0, cache: {} };
  },
  get(s, order) {
    return s.cache[order] || (s.cache[order] = BUILD[s.mode](order));
  },
  step(s, dt) {
    if (EXTRA[s.mode]) { EXTRA[s.mode].step(s, dt, s.rng); return; }
    if (s.p < 1) {
      const dur = s.mode === 'dragon' ? 0.9 + s.order * 0.12 : 1.1 + s.order * 0.55;
      s.p = Math.min(1, s.p + dt / dur);
    } else if (s.order < s.max) {
      s.order++;
      s.p = 0;
    } else if ((s.hold += dt) > 3.5) {
      s.order = MIN[s.mode];
      s.p = 0;
      s.hold = 0;
    }
  },
  draw(ctx, s, env) {
    if (EXTRA[s.mode]) { EXTRA[s.mode].draw(ctx, s, env); return; }
    const cur = this.get(s, s.order);
    const n = cur.length / 2;
    if (s.order > MIN[s.mode] && s.mode !== 'dragon') {
      ctx.save();
      ctx.setLineDash(DASH);
      poly(ctx, this.get(s, s.order - 1), undefined, s.mode === 'moore');
      ctx.restore();
    }
    // дракон меняет масштаб с каждым порядком — показываем его целиком
    const count = s.mode === 'dragon' ? n : Math.max(2, Math.floor(s.p * n));
    // петля Мура замыкается, когда линия дошла до конца
    poly(ctx, cur, count, s.mode === 'moore' && count === n);
    const hx = cur[(count - 1) * 2];
    const hy = cur[(count - 1) * 2 + 1];
    dot(ctx, hx, hy, 0.006);
  },
};

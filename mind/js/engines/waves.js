// 5. Волны и осцилляции
import { contours, segments, poly, circle, line, dot, dots, ease, TAU, DASH } from '../core/draw.js';

const G = 120;

function field(fn) {
  const f = new Float32Array(G * G);
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) f[j * G + i] = fn(i / (G - 1), j / (G - 1));
  return f;
}

const CHLADNI = [[1, 2], [2, 3], [1, 4], [3, 4], [2, 5], [1, 5], [3, 5], [4, 5], [2, 7], [3, 7]];

// Дуга окружности [a0..a1], обрезанная квадратом [m..1-m]²: добавляет подпути в текущий путь
function arcBox(ctx, cx, cy, r, a0 = 0, a1 = TAU, m = 0.05) {
  if (r <= 0) return;
  const cuts = [a0, a1];
  const add = (a) => {
    const b = a0 + ((((a - a0) % TAU) + TAU) % TAU);
    if (b < a1) cuts.push(b);
  };
  for (const X of [m, 1 - m]) {
    const c = (X - cx) / r;
    if (c > -1 && c < 1) { const a = Math.acos(c); add(a); add(-a); }
  }
  for (const Y of [m, 1 - m]) {
    const c = (Y - cy) / r;
    if (c > -1 && c < 1) { const a = Math.asin(c); add(a); add(Math.PI - a); }
  }
  cuts.sort((a, b) => a - b);
  for (let i = 0; i < cuts.length - 1; i++) {
    const u = cuts[i], v = cuts[i + 1];
    if (v - u < 1e-6) continue;
    const w = (u + v) / 2, x = cx + r * Math.cos(w), y = cy + r * Math.sin(w);
    if (x < m || x > 1 - m || y < m || y > 1 - m) continue;
    ctx.moveTo(cx + r * Math.cos(u), cy + r * Math.sin(u));
    ctx.arc(cx, cy, r, u, v);
  }
}

// Окружность, обрезанная кругом (0,5; 0,5; R0): добавляет дугу в текущий путь
function arcDisc(ctx, cx, cy, r, R0) {
  const dx = 0.5 - cx, dy = 0.5 - cy, d = Math.hypot(dx, dy);
  if (r <= 0 || d >= r + R0 || r >= d + R0) return;
  if (d + r <= R0) { ctx.moveTo(cx + r, cy); ctx.arc(cx, cy, r, 0, TAU); return; }
  const phi = Math.atan2(dy, dx), al = Math.acos(Math.max(-1, Math.min(1, (r * r + d * d - R0 * R0) / (2 * r * d))));
  ctx.moveTo(cx + r * Math.cos(phi - al), cy + r * Math.sin(phi - al));
  ctx.arc(cx, cy, r, phi - al, phi + al);
}

const DOP_C = 0.1;

// подшаги: dt бывает до 0,12 с
function sub(dt, fn, h = 1 / 30) {
  const n = Math.max(1, Math.ceil(dt / h - 1e-9));
  for (let i = 0; i < n; i++) fn(dt / n);
}

// Курамото: собственные частоты и цикл силы связи
const SYNC_P = 22;
function syncK(t) {
  const u = t % SYNC_P;
  if (u < 3) return 0;
  if (u < 13) return 1.6 * ease((u - 3) / 10);
  if (u < 19) return 1.6;
  return -1.8;
}

// эхолокация: мышь слева, препятствие-круг справа; каждое вернувшееся эхо проявляет его контур
const ECHO = { C: 0.3, PER: 0.8, SPAN: 0.55, CYC: 12, SHOTS: 11 };
function echoScene(rng) {
  return { bx: 0.14, by: 0.5, ox: 0.66 + 0.06 * rng(), oy: 0.5 + 0.12 * (rng() - 0.5), R: 0.1 + 0.04 * rng() };
}

const MODES = {
  // два источника: светлые и тёмные полосы
  interference: {
    create(p) {
      const slit = p.slit;
      return {
        src: slit ? [[0.44, 0.1], [0.56, 0.1]] : p.src || [[0.36, 0.5], [0.64, 0.5]],
        k: TAU / (p.lambda || 0.07), slit, hits: [], t: 0,
      };
    },
    step(s, dt, rng) {
      s.t += dt;
      const w = TAU * 0.5;
      const [[ax, ay], [bx, by]] = s.src;
      const f = field((x, y) => {
        if (s.slit && y < 0.1) return 0;
        return Math.sin(s.k * Math.hypot(x - ax, y - ay) - w * s.t) + Math.sin(s.k * Math.hypot(x - bx, y - by) - w * s.t);
      });
      s.segs = contours(f, G, G, 1.1, []);
      if (s.slit && s.hits.length < 1400) {
        // частица на экране: вероятность ∝ cos² разности хода
        for (let tries = 0; tries < 6; tries++) {
          const x = 0.05 + rng() * 0.9, y = 0.94;
          const d = Math.hypot(x - ax, y - ay) - Math.hypot(x - bx, y - by);
          if (rng() < Math.cos((s.k * d) / 2) ** 2) { s.hits.push(x, y + (rng() - 0.5) * 0.03); break; }
        }
      }
    },
    draw(ctx, s) {
      if (s.segs) segments(ctx, s.segs);
      for (const [x, y] of s.src) dot(ctx, x, y, 0.005);
      if (s.slit) {
        line(ctx, 0.02, 0.1, 0.41, 0.1);
        line(ctx, 0.47, 0.1, 0.53, 0.1);
        line(ctx, 0.59, 0.1, 0.98, 0.1);
        const xs = [], ys = [];
        for (let i = 0; i < s.hits.length; i += 2) { xs.push(s.hits[i]); ys.push(s.hits[i + 1]); }
        dots(ctx, xs, ys, 0.0035);
      }
    },
  },

  // маятники разной длины на общей качающейся перекладине: раскачивается только «свой»
  resonance: {
    create() { return { t: 0 }; },
    step(s, dt) { s.t += dt; },
    draw(ctx, s) {
      const N = 9, w = TAU * 0.55, g = 0.22;
      const ramp = 1 - Math.exp(-s.t / 5);
      const shift = 0.012 * Math.sin(w * s.t);
      line(ctx, 0.06 + shift, 0.1, 0.94 + shift, 0.1);
      for (let i = 0; i < N; i++) {
        const w0 = w * (0.7 + (i / (N - 1)) * 0.6);
        const L = 0.37 * (w / w0) ** 2;
        const amp = (0.6 * g * w) / Math.hypot(w0 * w0 - w * w, g * w);
        const th = amp * ramp * Math.sin(w * s.t - Math.atan2(g * w, w0 * w0 - w * w));
        const px = 0.12 + i * 0.095 + shift, py = 0.1;
        const bx = px + Math.sin(th) * L, by = py + Math.cos(th) * L;
        line(ctx, px, py, bx, by);
        circle(ctx, bx, by, 0.018);
        if (i === 4) { circle(ctx, bx, by, 0.03); dot(ctx, bx, by, 0.004); }
      }
    },
  },

  // гармоники струны, закреплённой с двух концов
  standing: {
    create() { return { t: 0 }; },
    step(s, dt) { s.t += dt; },
    draw(ctx, s) {
      for (let n = 1; n <= 5; n++) {
        const y0 = 0.1 + (n - 1) * 0.2, A = 0.065;
        const ph = Math.cos(TAU * 0.35 * n * s.t);
        const pts = [], env = [], env2 = [];
        for (let i = 0; i <= 160; i++) {
          const x = i / 160, sv = Math.sin(n * Math.PI * x);
          pts.push(0.06 + x * 0.88, y0 + A * sv * ph);
          env.push(0.06 + x * 0.88, y0 + A * sv);
          env2.push(0.06 + x * 0.88, y0 - A * sv);
        }
        ctx.save();
        ctx.setLineDash(DASH);
        poly(ctx, env); poly(ctx, env2);
        ctx.restore();
        poly(ctx, pts);
        const xs = [], ys = [];
        for (let k = 0; k <= n; k++) { xs.push(0.06 + (k / n) * 0.88); ys.push(y0); }
        dots(ctx, xs, ys, 0.006);
      }
    },
  },

  lissajous: {
    create(p) { return { a: p.a || 3, b: p.b || 2, t: 0 }; },
    step(s, dt) { s.t += dt; },
    draw(ctx, s) {
      const d = s.t * 0.22, pts = [];
      for (let i = 0; i <= 900; i++) {
        const u = (i / 900) * TAU;
        pts.push(0.5 + 0.41 * Math.sin(s.a * u + d), 0.5 + 0.41 * Math.sin(s.b * u));
      }
      poly(ctx, pts);
      const u = s.t * 0.9;
      dot(ctx, 0.5 + 0.41 * Math.sin(s.a * u + d), 0.5 + 0.41 * Math.sin(s.b * u), 0.006);
    },
  },

  // фигуры Хладни: узловые линии пластины, плавный переход между модами
  chladni: {
    create(p, rng) { return { t: 0, i: Math.floor(rng() * CHLADNI.length) }; },
    step(s, dt) {
      s.t += dt;
      const P = 4.5, k = Math.floor(s.t / P);
      const u = ease(Math.max(0, Math.min(1, ((s.t % P) - (P - 1.2)) / 1.2)));
      const A = CHLADNI[(s.i + k) % CHLADNI.length], B = CHLADNI[(s.i + k + 1) % CHLADNI.length];
      const m = (n, m2, x, y, sg) => Math.cos(n * Math.PI * x) * Math.cos(m2 * Math.PI * y) + sg * Math.cos(m2 * Math.PI * x) * Math.cos(n * Math.PI * y);
      const sa = (s.i + k) % 2 ? 1 : -1, sb = -sa;
      const f = field((x, y) => (1 - u) * m(A[0], A[1], x, y, sa) + u * m(B[0], B[1], x, y, sb));
      s.segs = contours(f, G, G, 0, [], 0.04, 0.04, 0.92, 0.92);
    },
    draw(ctx, s) {
      if (s.segs) segments(ctx, s.segs);
      ctx.strokeRect(0.04, 0.04, 0.92, 0.92);
    },
  },

  // биения: две близкие частоты и их сумма
  beats: {
    create() { return { t: 0 }; },
    step(s, dt) { s.t += dt; },
    draw(ctx, s) {
      const f1 = 9, f2 = 10, w = s.t * 0.6;
      const row = (y0, A, fn) => {
        const pts = [];
        for (let i = 0; i <= 400; i++) { const x = i / 400; pts.push(0.05 + x * 0.9, y0 + A * fn(x)); }
        poly(ctx, pts);
      };
      row(0.16, 0.05, (x) => Math.sin(TAU * (f1 * x - w)));
      row(0.34, 0.05, (x) => Math.sin(TAU * (f2 * x - w * 1.1)));
      row(0.68, 0.12, (x) => (Math.sin(TAU * (f1 * x - w)) + Math.sin(TAU * (f2 * x - w * 1.1))) / 2);
      ctx.save();
      ctx.setLineDash(DASH);
      row(0.68, 0.12, (x) => Math.abs(Math.cos(Math.PI * ((f2 - f1) * x - w * 0.1))));
      row(0.68, -0.12, (x) => Math.abs(Math.cos(Math.PI * ((f2 - f1) * x - w * 0.1))));
      ctx.restore();
    },
  },

  // модель Курамото: фазы на кольце сбегаются в такт, светлячки вспыхивают вместе
  sync: {
    create(p, rng) {
      const N = 18, th = [], w = [];
      for (let i = 0; i < N; i++) { th.push(rng() * TAU); w.push(TAU * 0.3 * (1 + 0.3 * (rng() - 0.5))); }
      return { N, th, w, t: 0, R: 0, psi: 0 };
    },
    step(s, dt) {
      sub(dt, (h) => {
        const K = syncK(s.t);
        let cx = 0, cy = 0;
        for (const a of s.th) { cx += Math.cos(a); cy += Math.sin(a); }
        s.R = Math.hypot(cx, cy) / s.N; s.psi = Math.atan2(cy, cx);
        for (let i = 0; i < s.N; i++) s.th[i] += h * (s.w[i] + K * s.R * Math.sin(s.psi - s.th[i]));
        s.t += h;
      });
    },
    draw(ctx, s) {
      const c = 0.5, r0 = 0.27, r1 = 0.4;
      ctx.save(); ctx.setLineDash(DASH); circle(ctx, c, c, r0); ctx.restore();
      const xs = [], ys = [], fx = [], fy = [];
      ctx.beginPath();
      for (let i = 0; i < s.N; i++) {
        const a = s.th[i] - Math.PI / 2;
        xs.push(c + r0 * Math.cos(a)); ys.push(c + r0 * Math.sin(a));
        const b = (i / s.N) * TAU - Math.PI / 2, x = c + r1 * Math.cos(b), y = c + r1 * Math.sin(b);
        fx.push(x); fy.push(y);
        // вспышка: фаза только что прошла верхнюю точку
        const ph = ((s.th[i] % TAU) + TAU) % TAU;
        if (ph < 0.9) { const rr = 0.012 + 0.028 * Math.sin((ph / 0.9) * Math.PI); ctx.moveTo(x + rr, y); ctx.arc(x, y, rr, 0, TAU); }
      }
      ctx.stroke();
      dots(ctx, xs, ys, 0.008);
      dots(ctx, fx, fy, 0.0045);
      // параметр порядка: вектор среднего
      const ex = c + r0 * s.R * Math.cos(s.psi - Math.PI / 2), ey = c + r0 * s.R * Math.sin(s.psi - Math.PI / 2);
      line(ctx, c, c, ex, ey);
      dot(ctx, c, c, 0.004);
    },
  },

  // движущийся источник: волны впереди сгущаются, позади разрежены
  doppler: {
    create() {
      const s = { t: 0, ph: 0, rings: [], x: 0.5, y: 0.5 };
      MODES.doppler.step(s, 6);
      return s;
    },
    step(s, dt) {
      sub(dt, (h) => {
        s.t += h;
        s.x = 0.5 + 0.25 * (2 / Math.PI) * Math.asin(0.985 * Math.sin((TAU / 14) * s.t));
        s.ph += h;
        if (s.ph >= 0.8) { s.ph -= 0.8; s.rings.push(s.x, s.t - s.ph); }
      });
      while (s.rings.length && DOP_C * (s.t - s.rings[1]) > 0.95) s.rings.splice(0, 2);
    },
    draw(ctx, s) {
      ctx.beginPath();
      for (let i = 0; i < s.rings.length; i += 2) arcDisc(ctx, s.rings[i], s.y, DOP_C * (s.t - s.rings[i + 1]), 0.44);
      ctx.stroke();
      ctx.save(); ctx.setLineDash(DASH); line(ctx, 0.25, s.y, 0.75, s.y); ctx.restore();
      dot(ctx, s.x, s.y, 0.008);
    },
  },

  // каждая точка фронта — источник вторичной волны; огибающая — новый фронт
  huygens: {
    create() { return { t: 0 }; },
    step(s, dt) { s.t += dt; },
    draw(ctx, s) {
      const c = 0.5, D = 0.1, R0 = 0.14, ST = 3.2, P = 1.4 + 3 * ST + 1.6;
      const u = s.t % P;
      dot(ctx, c, c, 0.006);
      if (u < 1.4) { circle(ctx, c, c, R0 * ease(Math.min(1, u / 1.2))); return; }
      const k = Math.min(2, Math.floor((u - 1.4) / ST));
      const v = u - 1.4 - k * ST;
      const done = u >= 1.4 + 3 * ST;
      const r = done ? D : D * ease(Math.min(1, v / 2.4));
      const Rk = R0 + k * D;
      // прошлые фронты — пунктиром
      ctx.save(); ctx.setLineDash(DASH);
      for (let j = 0; j <= k; j++) circle(ctx, c, c, R0 + j * D);
      ctx.restore();
      if (done) { circle(ctx, c, c, Rk + D); return; }
      const n = Math.round((TAU * Rk) / 0.075), xs = [], ys = [];
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + k * 0.2, x = c + Rk * Math.cos(a), y = c + Rk * Math.sin(a);
        xs.push(x); ys.push(y);
        // вторичная волна: обращённая вперёд половина
        ctx.moveTo(x + r * Math.cos(a - Math.PI / 2), y + r * Math.sin(a - Math.PI / 2));
        ctx.arc(x, y, r, a - Math.PI / 2, a + Math.PI / 2);
      }
      ctx.stroke();
      dots(ctx, xs, ys, 0.0045);
      circle(ctx, c, c, Rk + r);
    },
  },

  // муар: два набора концентрических окружностей, центр второго медленно обходит первый
  moire: {
    create() { return { t: 0 }; },
    step(s, dt) { s.t += dt; },
    draw(ctx, s) {
      const R0 = 0.44, st = 0.44 / 15, e = 0.1 + 0.05 * Math.sin(s.t * 0.17), a = s.t * 0.23;
      const bx = 0.5 + e * Math.cos(a), by = 0.5 + e * Math.sin(a);
      ctx.beginPath();
      for (let r = st; r <= R0 + 1e-6; r += st) { ctx.moveTo(0.5 + r, 0.5); ctx.arc(0.5, 0.5, r, 0, TAU); }
      for (let r = st; r < R0 + e; r += st) arcDisc(ctx, bx, by, r, R0);
      ctx.stroke();
    },
  },

  // «волна» на стадионе: возбудимая среда — покой, подъём, усталость
  stadium: {
    create(p, rng) {
      const N = 60, M = 5, st = new Uint8Array(N * M), tau = new Float32Array(N * M);
      for (let m = 0; m < M; m++) {
        for (let i = 0; i < 3; i++) { st[m * N + i] = 1; tau[m * N + i] = (2 - i) * 0.2 + 0.1 * rng(); }
        for (let i = N - 10; i < N; i++) { st[m * N + i] = 2; tau[m * N + i] = (N - i) * 0.2; }
      }
      return { N, M, st, tau, t: 0 };
    },
    step(s, dt, rng) {
      const { N, M, st, tau } = s, TA = 1.6, TR = 3;
      const up = (k) => st[k] === 1 && tau[k] > 0.25;
      sub(dt, (h) => {
        const go = [];
        for (let m = 0; m < M; m++) for (let i = 0; i < N; i++) {
          const k = m * N + i;
          if (st[k] === 0) {
            let n = 0;
            for (let dm = -1; dm <= 1; dm++) {
              const mm = m + dm;
              if (mm < 0 || mm >= M) continue;
              for (let di = -1; di <= 1; di++) if (up(mm * N + ((i + di + N) % N))) n++;
            }
            if (n && rng() < 1 - Math.exp(-6 * n * h)) go.push(k);
          } else {
            tau[k] += h;
            if (st[k] === 1 && tau[k] >= TA) { st[k] = 2; tau[k] = 0; } else if (st[k] === 2 && tau[k] >= TR) { st[k] = 0; tau[k] = 0; }
          }
        }
        for (const k of go) { st[k] = 1; tau[k] = 0; }
        s.t += h;
      });
    },
    draw(ctx, s) {
      const { N, M, st, tau } = s, TA = 1.6, c = 0.5;
      ctx.save(); ctx.setLineDash(DASH);
      ctx.strokeRect(0.39, 0.43, 0.22, 0.14);
      line(ctx, 0.5, 0.43, 0.5, 0.57);
      ctx.restore();
      ctx.beginPath();
      const hx = [], hy = [];
      for (let m = 0; m < M; m++) {
        const r = 0.2 + 0.05 * m;
        for (let i = 0; i < N; i++) {
          const k = m * N + i, a = ((i + (m % 2) * 0.5) / N) * TAU - Math.PI / 2;
          const u = st[k] === 1 ? Math.sin(Math.PI * Math.min(1, tau[k] / TA)) : 0;
          const L = 0.009 + 0.029 * Math.sqrt(u), ca = Math.cos(a), sa = Math.sin(a);
          ctx.moveTo(c + r * ca, c + r * sa);
          ctx.lineTo(c + (r + L) * ca, c + (r + L) * sa);
          if (u > 0.5) { hx.push(c + (r + L) * ca); hy.push(c + (r + L) * sa); }
        }
      }
      ctx.stroke();
      if (hx.length) dots(ctx, hx, hy, 0.004);
    },
  },

  // волновой пакет и его спектр: Δx · Δk не меньше постоянной
  uncertainty: {
    create() { return { t: 0 }; },
    step(s, dt) { s.t += dt; },
    draw(ctx, s) {
      const sg = 0.022 * Math.pow(7, 0.5 - 0.5 * Math.cos(s.t * 0.42)), sk = 0.0045 / sg;
      const y0 = 0.27, A = 0.15, k0 = TAU / 0.045, ph = s.t * 2.2;
      const pts = [], up = [], dn = [];
      for (let i = 0; i <= 500; i++) {
        const x = 0.06 + (i / 500) * 0.88, g = Math.exp(-((x - 0.5) ** 2) / (2 * sg * sg));
        pts.push(x, y0 - A * g * Math.cos(k0 * (x - 0.5) - ph));
        up.push(x, y0 - A * g); dn.push(x, y0 + A * g);
      }
      poly(ctx, pts);
      ctx.save(); ctx.setLineDash(DASH);
      poly(ctx, up); poly(ctx, dn);
      // ширины: Δx и Δk
      line(ctx, 0.5 - sg, 0.48, 0.5 + sg, 0.48);
      line(ctx, 0.5 - sk, 0.9, 0.5 + sk, 0.9);
      ctx.restore();
      line(ctx, 0.5 - sg, 0.465, 0.5 - sg, 0.495); line(ctx, 0.5 + sg, 0.465, 0.5 + sg, 0.495);
      line(ctx, 0.5 - sk, 0.885, 0.5 - sk, 0.915); line(ctx, 0.5 + sk, 0.885, 0.5 + sk, 0.915);
      // спектр: столбики под гауссовой огибающей, площадь постоянна
      const yb = 0.84, H = 0.29 * Math.min(1, sg / 0.11);
      line(ctx, 0.06, yb, 0.94, yb);
      ctx.beginPath();
      const env = [];
      for (let i = 0; i <= 44; i++) {
        const x = 0.06 + (i / 44) * 0.88, g = H * Math.exp(-((x - 0.5) ** 2) / (2 * sk * sk));
        if (g > 0.002) { ctx.moveTo(x, yb); ctx.lineTo(x, yb - g); }
      }
      ctx.stroke();
      for (let i = 0; i <= 200; i++) { const x = 0.06 + (i / 200) * 0.88; env.push(x, yb - H * Math.exp(-((x - 0.5) ** 2) / (2 * sk * sk))); }
      poly(ctx, env);
    },
  },

  // мышь посылает импульсы, эхо возвращается, препятствие проступает пунктиром
  echo: {
    create(p, rng) { return { t: 0, ...echoScene(rng) }; },
    step(s, dt, rng) {
      s.t += dt;
      if (s.t >= ECHO.CYC) Object.assign(s, { t: 0 }, echoScene(rng));
    },
    draw(ctx, s) {
      const { C, PER, SPAN, SHOTS } = ECHO;
      const dir = Math.atan2(s.oy - s.by, s.ox - s.bx);
      const d0 = Math.hypot(s.ox - s.bx, s.oy - s.by) - s.R; // путь до поверхности
      const nx = s.ox - s.R * Math.cos(dir), ny = s.oy - s.R * Math.sin(dir); // ближняя точка
      let back = 0;
      ctx.beginPath();
      for (let k = 0; k < SHOTS; k++) {
        const r = C * (s.t - k * PER);
        if (r <= 0) break;
        // посылка: двойная дуга, за препятствием гаснет
        if (r < d0 + 0.02) for (const dr of [0, -0.014]) if (r + dr > 0.012) arcBox(ctx, s.bx, s.by, r + dr, dir - SPAN, dir + SPAN, 0.05);
        // эхо: от ближней точки обратно к мыши
        const rr = r - d0;
        if (rr > 0 && rr < d0) arcBox(ctx, nx, ny, rr, dir + Math.PI - 0.5, dir + Math.PI + 0.5, 0.05);
        if (rr >= d0) back++;
      }
      ctx.stroke();
      // контур препятствия: каждое вернувшееся эхо открывает новую часть
      if (back) {
        const half = Math.min(Math.PI, 0.32 * back);
        ctx.save(); ctx.setLineDash(DASH);
        ctx.beginPath();
        ctx.arc(s.ox, s.oy, s.R, dir + Math.PI - half, dir + Math.PI + half);
        ctx.stroke();
        ctx.restore();
      }
      dot(ctx, s.bx, s.by, 0.008);
    },
  },

};

export default {
  id: 'waves',
  create(p, rng) {
    const mode = p.mode || 'interference';
    return { mode, rng, ...MODES[mode].create(p, rng) };
  },
  step(s, dt) { MODES[s.mode].step(s, dt, s.rng); },
  draw(ctx, s) { MODES[s.mode].draw(ctx, s); },
};

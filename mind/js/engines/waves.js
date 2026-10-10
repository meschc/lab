// 5. Волны и осцилляции
import { contours, segments, poly, circle, line, dot, dots, ease, TAU, DASH } from '../core/draw.js';

const G = 120;

function field(fn) {
  const f = new Float32Array(G * G);
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) f[j * G + i] = fn(i / (G - 1), j / (G - 1));
  return f;
}

const CHLADNI = [[1, 2], [2, 3], [1, 4], [3, 4], [2, 5], [1, 5], [3, 5], [4, 5], [2, 7], [3, 7]];

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

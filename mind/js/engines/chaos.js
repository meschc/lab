// 6. Маятники и хаос
import { poly, circle, line, dot, DASH } from '../core/draw.js';

function rk4(f, y, h) {
  const k1 = f(y);
  const k2 = f(y.map((v, i) => v + (h / 2) * k1[i]));
  const k3 = f(y.map((v, i) => v + (h / 2) * k2[i]));
  const k4 = f(y.map((v, i) => v + h * k3[i]));
  return y.map((v, i) => v + (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
}

const lorenzF = ([x, y, z]) => [10 * (y - x), x * (28 - z) - y, x * y - (8 / 3) * z];

function project(x, y, z, phi) {
  const X = x * Math.cos(phi) - y * Math.sin(phi);
  return [0.5 + X / 66, 0.88 - z * 0.0152];
}

const MODES = {
  double: {
    create(p, rng) {
      return { y: [Math.PI * (0.55 + rng() * 0.2), Math.PI * (0.8 + rng() * 0.3), 0, 0], trail: [] };
    },
    step(s, dt) {
      const g = 9.81;
      const f = ([a1, a2, w1, w2]) => {
        const d = a1 - a2, den = 3 - Math.cos(2 * d);
        const al1 = (-3 * g * Math.sin(a1) - g * Math.sin(a1 - 2 * a2) - 2 * Math.sin(d) * (w2 * w2 + w1 * w1 * Math.cos(d))) / den;
        const al2 = (2 * Math.sin(d) * (w1 * w1 * 2 + g * 2 * Math.cos(a1) + w2 * w2 * Math.cos(d))) / den;
        return [w1, w2, al1, al2];
      };
      const n = 8;
      for (let i = 0; i < n; i++) s.y = rk4(f, s.y, Math.min(dt, 0.04) / n);
      const [x2, y2] = this.pos(s).slice(2);
      s.trail.push(x2, y2);
      if (s.trail.length > 2400) s.trail.splice(0, 2);
    },
    pos(s) {
      const L = 0.21, ox = 0.5, oy = 0.5;
      const x1 = ox + L * Math.sin(s.y[0]), y1 = oy + L * Math.cos(s.y[0]);
      return [x1, y1, x1 + L * Math.sin(s.y[1]), y1 + L * Math.cos(s.y[1])];
    },
    draw(ctx, s) {
      ctx.save();
      ctx.setLineDash(DASH);
      poly(ctx, s.trail);
      ctx.restore();
      const [x1, y1, x2, y2] = this.pos(s);
      line(ctx, 0.5, 0.5, x1, y1);
      line(ctx, x1, y1, x2, y2);
      circle(ctx, x1, y1, 0.022);
      circle(ctx, x2, y2, 0.022);
      circle(ctx, x2, y2, 0.012);
    },
  },

  lorenz: {
    create(p, rng) {
      const two = !!p.two;
      const a = [1 + rng(), 1, 20];
      return { two, a, b: [a[0] + 1e-5, a[1], a[2]], A: [], B: [], phi: 0 };
    },
    step(s, dt) {
      s.phi += dt * 0.08;
      for (let i = 0; i < 4; i++) {
        s.a = rk4(lorenzF, s.a, 0.006);
        s.A.push(...s.a);
        if (s.two) { s.b = rk4(lorenzF, s.b, 0.006); s.B.push(...s.b); }
      }
      const max = s.two ? 3 * 1800 : 3 * 5000;
      if (s.A.length > max) { s.A.splice(0, s.A.length - max); if (s.two) s.B.splice(0, s.B.length - max); }
    },
    path(ctx, arr, phi) {
      ctx.beginPath();
      for (let i = 0; i < arr.length; i += 3) {
        const [u, v] = project(arr[i], arr[i + 1], arr[i + 2], phi);
        i ? ctx.lineTo(u, v) : ctx.moveTo(u, v);
      }
      ctx.stroke();
    },
    draw(ctx, s) {
      this.path(ctx, s.A, s.phi);
      const n = s.A.length;
      if (n) dot(ctx, ...project(s.A[n - 3], s.A[n - 2], s.A[n - 1], s.phi), 0.006);
      if (s.two && s.B.length) {
        ctx.save();
        ctx.setLineDash([0.008, 0.008]);
        this.path(ctx, s.B, s.phi);
        ctx.restore();
        const m = s.B.length;
        const [u, v] = project(s.B[m - 3], s.B[m - 2], s.B[m - 1], s.phi);
        circle(ctx, u, v, 0.014);
      }
    },
  },

  // бифуркационная диаграмма x → r·x·(1−x)
  logistic: {
    create() {
      const COLS = 340, PTS = 90, pts = new Float32Array(COLS * PTS * 2);
      for (let c = 0; c < COLS; c++) {
        const r = 2.6 + (1.4 * c) / (COLS - 1);
        let x = 0.5;
        for (let i = 0; i < 300; i++) x = r * x * (1 - x);
        for (let k = 0; k < PTS; k++) {
          x = r * x * (1 - x);
          const o = (c * PTS + k) * 2;
          pts[o] = 0.06 + (0.88 * c) / (COLS - 1);
          pts[o + 1] = 0.94 - 0.88 * x;
        }
      }
      return { pts, COLS, PTS, t: 0 };
    },
    step(s, dt) { s.t = (s.t + dt) % 13; },
    draw(ctx, s) {
      const shown = Math.min(s.COLS, Math.floor((s.t / 9) * s.COLS));
      const d = 0.0018;
      ctx.beginPath();
      for (let i = 0; i < shown * s.PTS; i++) ctx.rect(s.pts[i * 2] - d / 2, s.pts[i * 2 + 1] - d / 2, d, d);
      ctx.fill();
      if (shown < s.COLS) {
        const x = 0.06 + (0.88 * shown) / (s.COLS - 1);
        ctx.save();
        ctx.setLineDash(DASH);
        line(ctx, x, 0.04, x, 0.96);
        ctx.restore();
      }
    },
  },

  // Лотка — Вольтерра: хищники и жертвы бегут по замкнутым орбитам
  lotka: {
    create() {
      const f = ([x, y]) => [x * (1 - 0.5 * y), y * (-0.75 + 0.25 * x)];
      const orbits = [0.5, 1, 1.6, 2.3].map((y0) => {
        let st = [3, y0];
        const pts = [];
        for (let i = 0; i < 1600; i++) { st = rk4(f, st, 0.01); pts.push(...this.map(st)); }
        return pts;
      });
      return { f, orbits, st: [3, 1.6], trail: [] };
    },
    map([x, y]) { return [0.08 + x * 0.088, 0.92 - y * 0.16]; },
    step(s, dt) {
      for (let i = 0; i < 6; i++) s.st = rk4(s.f, s.st, dt * 0.35);
      s.trail.push(...this.map(s.st));
      if (s.trail.length > 600) s.trail.splice(0, 2);
    },
    draw(ctx, s) {
      ctx.save();
      ctx.setLineDash(DASH);
      for (const o of s.orbits) poly(ctx, o);
      ctx.restore();
      poly(ctx, s.trail);
      dot(ctx, ...this.map(s.st), 0.006);
      line(ctx, 0.06, 0.96, 0.94, 0.96);
      line(ctx, 0.06, 0.96, 0.06, 0.06);
    },
  },
};

export default {
  id: 'chaos',
  create(p, rng) {
    const mode = p.mode === 'butterfly' ? 'lorenz' : p.mode || 'lorenz';
    const params = p.mode === 'butterfly' ? { ...p, two: true } : p;
    return { mode, ...MODES[mode].create(params, rng) };
  },
  step(s, dt) { MODES[s.mode].step(s, dt); },
  draw(ctx, s) { MODES[s.mode].draw(ctx, s); },
};

// 6. Маятники и хаос
import { poly, circle, line, dot, DASH, TAU, clamp, ease } from '../core/draw.js';
import { gauss } from '../core/rng.js';

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

  // Задача трёх тел: восьмёрка Шенсине — Монтгомери с малым возмущением,
  // распад в хаос, мягкая стенка держит тела в кадре, затем новый запуск
  threebody: {
    S: 0.33,
    create(p, rng) {
      const s = { rng, p: [], v: [], a: [], trails: [[], [], []], t: 0, broke: -1, sub: 0 };
      this.reset(s);
      return s;
    },
    reset(s) {
      const g = () => gauss(s.rng);
      s.p = [0.97000436, -0.24308753, -0.97000436, 0.24308753, 0, 0];
      s.v = [0.46620368, 0.43236573, 0.46620368, 0.43236573, -0.93240737, -0.86473146];
      for (let i = 0; i < 6; i++) s.v[i] += 0.08 * g();
      // нулевой импульс и центр масс в начале координат
      for (let c = 0; c < 2; c++) {
        const mv = (s.v[c] + s.v[c + 2] + s.v[c + 4]) / 3, mp = (s.p[c] + s.p[c + 2] + s.p[c + 4]) / 3;
        for (let i = 0; i < 3; i++) { s.v[2 * i + c] -= mv; s.p[2 * i + c] -= mp; }
      }
      // случайный поворот всей конфигурации
      const th = s.rng() * TAU, co = Math.cos(th), si = Math.sin(th);
      for (const arr of [s.p, s.v]) {
        for (let i = 0; i < 3; i++) {
          const x = arr[2 * i], y = arr[2 * i + 1];
          arr[2 * i] = x * co - y * si; arr[2 * i + 1] = x * si + y * co;
        }
      }
      s.a = this.acc(s.p);
      s.trails = [[], [], []];
      s.t = 0; s.broke = -1;
    },
    acc(p) {
      const a = [0, 0, 0, 0, 0, 0], e2 = 0.06 * 0.06;
      for (let i = 0; i < 3; i++) {
        for (let j = i + 1; j < 3; j++) {
          const dx = p[2 * j] - p[2 * i], dy = p[2 * j + 1] - p[2 * i + 1];
          const d2 = dx * dx + dy * dy + e2, inv = 1 / (d2 * Math.sqrt(d2));
          a[2 * i] += dx * inv; a[2 * i + 1] += dy * inv;
          a[2 * j] -= dx * inv; a[2 * j + 1] -= dy * inv;
        }
        // мягкая стенка: за радиусом 1.12 тело тянет назад пружиной
        const x = p[2 * i], y = p[2 * i + 1], r = Math.hypot(x, y);
        if (r > 1.12) { const k = (-14 * (r - 1.12)) / r; a[2 * i] += k * x; a[2 * i + 1] += k * y; }
      }
      return a;
    },
    step(s, dt) {
      const T = Math.min(dt, 0.12) * 1.6, n = Math.ceil(T / 0.0025), h = T / n;
      for (let k = 0; k < n; k++) {
        for (let i = 0; i < 6; i++) { s.v[i] += (h / 2) * s.a[i]; s.p[i] += h * s.v[i]; }
        s.a = this.acc(s.p);
        for (let i = 0; i < 6; i++) s.v[i] += (h / 2) * s.a[i];
        if (++s.sub % 4 === 0) {
          for (let b = 0; b < 3; b++) {
            const tr = s.trails[b];
            tr.push(s.p[2 * b], s.p[2 * b + 1]);
            if (tr.length > 900) tr.splice(0, 2);
          }
        }
      }
      s.t += dt;
      const R = Math.max(Math.hypot(s.p[0], s.p[1]), Math.hypot(s.p[2], s.p[3]), Math.hypot(s.p[4], s.p[5]));
      if (s.broke < 0 && R > 1.25) s.broke = s.t;
      if (!Number.isFinite(R) || (s.broke >= 0 && s.t - s.broke > 16) || s.t > 55) this.reset(s);
    },
    xy(x, y) { return [clamp(0.5 + x * this.S, 0.05, 0.95), clamp(0.5 - y * this.S, 0.05, 0.95)]; },
    path(ctx, tr, from, to) {
      if (to - from < 2) return;
      ctx.beginPath();
      for (let i = from; i < to; i++) {
        const [u, v] = this.xy(tr[2 * i], tr[2 * i + 1]);
        i === from ? ctx.moveTo(u, v) : ctx.lineTo(u, v);
      }
      ctx.stroke();
    },
    draw(ctx, s) {
      for (const tr of s.trails) {
        const n = tr.length / 2, cut = Math.max(0, n - 260);
        ctx.save();
        ctx.setLineDash(DASH);
        this.path(ctx, tr, 0, cut + 1);
        ctx.restore();
        this.path(ctx, tr, cut, n);
      }
      for (let b = 0; b < 3; b++) {
        const [u, v] = this.xy(s.p[2 * b], s.p[2 * b + 1]);
        dot(ctx, u, v, 0.006);
        circle(ctx, u, v, 0.016);
      }
    },
  },

  // Аттрактор Рёсслера: одна петля спирали и редкий выброс вверх, вид медленно поворачивается
  rossler: {
    f: ([x, y, z]) => [-y - z, x + 0.2 * y, 0.2 + z * (x - 5.7)],
    create(p, rng) {
      let a = [1 + rng() * 2, rng() * 2 - 1, 0];
      for (let i = 0; i < 1500; i++) a = rk4(this.f, a, 0.025);
      return { a, A: [], phi: rng() * TAU };
    },
    step(s, dt) {
      s.phi += dt * 0.1;
      const n = Math.max(1, Math.round(Math.min(dt, 0.12) * 150));
      for (let i = 0; i < n; i++) {
        s.a = rk4(this.f, s.a, 0.025);
        s.A.push(s.a[0], s.a[1], s.a[2]);
      }
      if (s.A.length > 3 * 4200) s.A.splice(0, s.A.length - 3 * 4200);
    },
    proj(x, y, z, c, sn) {
      const X = (x - 1) * c - (y + 1.5) * sn, Y = (x - 1) * sn + (y + 1.5) * c;
      return [0.5 + X * 0.038, 0.677 + Y * 0.016 - z * 0.019];
    },
    draw(ctx, s) {
      const c = Math.cos(s.phi), sn = Math.sin(s.phi), A = s.A;
      if (A.length < 6) return;
      ctx.beginPath();
      for (let i = 0; i < A.length; i += 3) {
        const [u, v] = this.proj(A[i], A[i + 1], A[i + 2], c, sn);
        i ? ctx.lineTo(u, v) : ctx.moveTo(u, v);
      }
      ctx.stroke();
      const n = A.length;
      dot(ctx, ...this.proj(A[n - 3], A[n - 2], A[n - 1], c, sn), 0.006);
    },
  },

  // Отображение Хенона: точки проявляют аттрактор, затем зум в его слои
  henon: {
    create() { return { t: 0, L: henonLevels() }; },
    step(s, dt) { s.t += dt; },
    scale(s) {
      const { SK } = s.L, t = s.t;
      if (t < 6) return 1;
      const c = (t - 6) % 26;
      const z = (u) => Math.pow(SK, ease(clamp(u, 0, 1)));
      if (c < 2) return 1;
      if (c < 11) return z((c - 2) / 9);
      if (c < 15) return SK;
      if (c < 24) return z(1 - (c - 15) / 9);
      return 1;
    },
    draw(ctx, s) {
      const L = s.L, sc = this.scale(s);
      const x0 = L.cx + (-L.HX - L.cx) * sc, x1 = L.cx + (L.HX - L.cx) * sc;
      const y0 = L.cy + (-L.HY - L.cy) * sc, y1 = L.cy + (L.HY - L.cy) * sc;
      const kx = 0.88 / (x1 - x0), ky = 0.88 / (y1 - y0);
      // уровень: самая мелкая коробка, ещё содержащая вид; число точек держит плотность постоянной
      const k = Math.min(L.K, Math.max(0, Math.floor(Math.log(sc) / Math.log(L.r) + 1e-9)));
      const f = (sc / Math.pow(L.r, k)) ** 2;
      let n = Math.min(L.M, Math.round((L.M * L.r * L.r) / f));
      if (s.t < 6) n = Math.round(n * Math.min(1, 0.04 + s.t / 6));
      const P = L.lv[k], d = 0.003;
      n = Math.min(n, P.length / 2);
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const x = P[2 * i], y = P[2 * i + 1];
        if (x < x0 || x > x1 || y < y0 || y > y1) continue;
        ctx.rect(0.06 + (x - x0) * kx - d / 2, 0.94 - (y - y0) * ky - d / 2, d, d);
      }
      ctx.fill();
      // рамка будущего увеличения — пунктиром
      const bx0 = L.cx + (-L.HX - L.cx) * L.SK, bx1 = L.cx + (L.HX - L.cx) * L.SK;
      const by0 = L.cy + (-L.HY - L.cy) * L.SK, by1 = L.cy + (L.HY - L.cy) * L.SK;
      const u0 = clamp(0.06 + (bx0 - x0) * kx, 0.06, 0.94), u1 = clamp(0.06 + (bx1 - x0) * kx, 0.06, 0.94);
      const v0 = clamp(0.94 - (by1 - y0) * ky, 0.06, 0.94), v1 = clamp(0.94 - (by0 - y0) * ky, 0.06, 0.94);
      ctx.save();
      ctx.setLineDash(DASH);
      ctx.strokeRect(u0, v0, u1 - u0, v1 - v0);
      ctx.restore();
    },
  },

  // Бильярд Бунимовича: два шара из почти одной точки в «стадионе»
  stadium: {
    R: 0.2, A: 0.2,
    create(p, rng) {
      const s = { rng, balls: [], t: 0 };
      this.reset(s);
      return s;
    },
    reset(s) {
      const th = s.rng() * TAU, x = 0.5 + (s.rng() - 0.5) * 0.3, y = 0.5 + (s.rng() - 0.5) * 0.2;
      s.balls = [0, 1e-5].map((e) => ({ x, y, dx: Math.cos(th + e), dy: Math.sin(th + e), tr: [x, y] }));
      s.t = 0;
    },
    hit(b) {
      const { R, A } = this;
      let best = Infinity, nx = 0, ny = 0;
      // прямые стенки
      for (const [wy, n] of [[0.5 - R, 1], [0.5 + R, -1]]) {
        if (b.dy * n >= 0) continue;
        const t = (wy - b.y) / b.dy, hx = b.x + t * b.dx;
        if (t > 1e-9 && t < best && hx >= 0.5 - A && hx <= 0.5 + A) { best = t; nx = 0; ny = n; }
      }
      // полукруглые торцы
      for (const sg of [-1, 1]) {
        const cx = 0.5 + sg * A, px = b.x - cx, py = b.y - 0.5;
        const B = px * b.dx + py * b.dy, C = px * px + py * py - R * R, D = B * B - C;
        if (D < 0) continue;
        const t = -B + Math.sqrt(D), hx = b.x + t * b.dx, hy = b.y + t * b.dy;
        if (t > 1e-9 && t < best && (hx - cx) * sg >= 0) { best = t; nx = (cx - hx) / R; ny = (0.5 - hy) / R; }
      }
      return [best, nx, ny];
    },
    step(s, dt) {
      const dist = Math.min(dt, 0.12) * 0.42;
      for (const b of s.balls) billiardMove(b, dist, this, 14);
      s.t += dt;
      if (s.t > 30) this.reset(s);
    },
    draw(ctx, s) {
      const { R, A } = this;
      ctx.beginPath();
      ctx.arc(0.5 + A, 0.5, R, -Math.PI / 2, Math.PI / 2);
      ctx.arc(0.5 - A, 0.5, R, Math.PI / 2, (3 * Math.PI) / 2);
      ctx.closePath();
      ctx.stroke();
      const [a, b] = s.balls;
      poly(ctx, [...a.tr, a.x, a.y]);
      ctx.save();
      ctx.setLineDash(DASH);
      poly(ctx, [...b.tr, b.x, b.y]);
      ctx.restore();
      dot(ctx, a.x, a.y, 0.006);
      circle(ctx, b.x, b.y, 0.012);
    },
  },

  // Магнитный маятник над тремя магнитами: каждый запуск кончается у одного из них
  magnet: {
    S: 0.25, K: 0.5, C: 0.13, H: 0.28,
    M: [0, 1, 2].map((k) => [Math.cos(-Math.PI / 2 + (k * TAU) / 3), Math.sin(-Math.PI / 2 + (k * TAU) / 3)]),
    create(p, rng) {
      const s = { rng, y: null, tr: [], prev: [], rest: -1, t: 0, sub: 0 };
      this.launch(s);
      return s;
    },
    launch(s) {
      const ang = s.rng() * TAU, rad = 1.3 + 0.4 * s.rng();
      s.prev = s.tr;
      s.y = [rad * Math.cos(ang), rad * Math.sin(ang), 0, 0];
      s.tr = [...this.xy(s.y[0], s.y[1])];
      s.rest = -1; s.t = 0; s.trap = false;
    },
    energy([x, z, vx, vz]) {
      let e = 0.5 * (vx * vx + vz * vz) + 0.5 * this.K * (x * x + z * z);
      for (const [mx, mz] of this.M) e -= 1 / Math.sqrt((mx - x) ** 2 + (mz - z) ** 2 + this.H * this.H);
      return e;
    },
    f(y, C) {
      const [x, z, vx, vz] = y, { K, H } = this;
      let ax = -K * x - C * vx, az = -K * z - C * vz;
      for (const [mx, mz] of this.M) {
        const dx = mx - x, dz = mz - z, d2 = dx * dx + dz * dz + H * H, inv = 1 / (d2 * Math.sqrt(d2));
        ax += dx * inv; az += dz * inv;
      }
      return [vx, vz, ax, az];
    },
    xy(x, z) { return [clamp(0.5 + x * this.S, 0.05, 0.95), clamp(0.5 + z * this.S, 0.05, 0.95)]; },
    step(s, dt) {
      dt = Math.min(dt, 0.12);
      if (s.rest >= 0) {
        s.rest += dt;
        if (s.rest > 1.6) this.launch(s);
        return;
      }
      // пойман в яму одного магнита (энергия ниже седла ≈ −2,89) — дотухает быстрее
      const C = s.trap ? 0.9 : this.C;
      const f = (y) => this.f(y, C), n = Math.ceil((dt * 3) / 0.01), h = (dt * 3) / n;
      for (let i = 0; i < n; i++) {
        s.y = rk4(f, s.y, h);
        if (++s.sub % 3 === 0) s.tr.push(...this.xy(s.y[0], s.y[1]));
      }
      if (s.tr.length > 5000) s.tr.splice(0, s.tr.length - 5000);
      s.t += dt * 3;
      const [x, z, vx, vz] = s.y;
      if (!s.trap && this.energy(s.y) < -2.97) s.trap = true;
      const near = this.M.some(([mx, mz]) => Math.hypot(mx - x, mz - z) < 0.12);
      if (!Number.isFinite(x) || Math.hypot(x, z) > 2.1 || s.t > 90) this.launch(s);
      else if (s.t > 3 && near && Math.hypot(vx, vz) < 0.04) s.rest = 0;
    },
    draw(ctx, s) {
      for (const [mx, mz] of this.M) {
        const [u, v] = this.xy(mx, mz);
        circle(ctx, u, v, 0.02);
        circle(ctx, u, v, 0.034);
      }
      ctx.save();
      ctx.setLineDash(DASH);
      poly(ctx, s.prev);
      const [u, v] = this.xy(s.y[0], s.y[1]);
      line(ctx, 0.5, 0.5, u, v);
      ctx.restore();
      circle(ctx, 0.5, 0.5, 0.008);
      poly(ctx, [...s.tr, u, v]);
      dot(ctx, u, v, 0.006);
    },
  },

  // Паутинная модель: цена прыгает между кривыми спроса и предложения;
  // отношение наклонов медленно меняется — паутина то сходится, то расходится
  cobweb: {
    create(p, rng) { return { t: rng() * 40 }; },
    step(s, dt) { s.t += Math.min(dt, 0.12); },
    web(rho) {
      // отклонения от равновесия: спрос q = −P, предложение q = ρ·P(прошлая)
      const N = 9, A = 0.29, S = 1;
      let P = A * Math.min(1, Math.pow(rho, -N));
      const X = (q) => 0.5 + q * S, Y = (pp) => 0.5 - pp * S;
      const pts = [X(rho * P), Y(P)];
      for (let i = 0; i < N + 1; i++) {
        const q = rho * P;
        P = -q;
        pts.push(X(q), Y(P));
        pts.push(X(rho * P), Y(P));
      }
      return pts;
    },
    draw(ctx, s) {
      const rho = 1 + 0.28 * Math.sin((s.t * TAU) / 34);
      // оси и пунктирные проекции равновесия
      line(ctx, 0.06, 0.94, 0.94, 0.94);
      line(ctx, 0.06, 0.94, 0.06, 0.06);
      ctx.save();
      ctx.setLineDash(DASH);
      line(ctx, 0.06, 0.5, 0.5, 0.5);
      line(ctx, 0.5, 0.5, 0.5, 0.94);
      ctx.restore();
      // спрос (вниз) и предложение (вверх) через точку равновесия
      const L = 0.4, sx = L / Math.max(rho, 1);
      line(ctx, 0.5 - L, 0.5 - L, 0.5 + L, 0.5 + L);
      line(ctx, 0.5 - sx * rho, 0.5 + sx, 0.5 + sx * rho, 0.5 - sx);
      // паутина рисуется пером, весь цикл виден пунктиром
      const pts = clipPath(this.web(rho), 0.1, 0.9);
      const n = pts.length / 2, cyc = s.t % 8;
      const k = Math.min(n - 1, (cyc / 6) * (n - 1)), ki = Math.floor(k), fr = k - ki;
      ctx.save();
      ctx.setLineDash(DASH);
      poly(ctx, pts, n, false, ki);
      ctx.restore();
      const tx = pts[2 * ki] + (pts[2 * Math.min(ki + 1, n - 1)] - pts[2 * ki]) * fr;
      const ty = pts[2 * ki + 1] + (pts[2 * Math.min(ki + 1, n - 1) + 1] - pts[2 * ki + 1]) * fr;
      poly(ctx, [...pts.slice(0, 2 * ki + 2), tx, ty]);
      dot(ctx, tx, ty, 0.006);
    },
  },

  // Демон Лапласа: шар в бильярде Синая и его «предсказание» с ошибкой 1e−9
  laplace: {
    W0: 0.08, W1: 0.92, CR: 0.15,
    create(p, rng) {
      const s = { rng, balls: [], t: 0, split: null };
      this.reset(s);
      return s;
    },
    reset(s) {
      let x, y;
      do { x = 0.15 + 0.7 * s.rng(); y = 0.15 + 0.7 * s.rng(); } while (Math.hypot(x - 0.5, y - 0.5) < this.CR + 0.05);
      const th = s.rng() * TAU;
      s.balls = [0, 1e-9].map((e) => ({ x: x + e, y, dx: Math.cos(th), dy: Math.sin(th), tr: [x + e, y] }));
      s.t = 0; s.split = null;
    },
    hit(b) {
      const { W0, W1, CR } = this;
      let best = Infinity, nx = 0, ny = 0;
      if (b.dx < 0) { const t = (W0 - b.x) / b.dx; if (t < best) { best = t; nx = 1; ny = 0; } }
      if (b.dx > 0) { const t = (W1 - b.x) / b.dx; if (t < best) { best = t; nx = -1; ny = 0; } }
      if (b.dy < 0) { const t = (W0 - b.y) / b.dy; if (t < best) { best = t; nx = 0; ny = 1; } }
      if (b.dy > 0) { const t = (W1 - b.y) / b.dy; if (t < best) { best = t; nx = 0; ny = -1; } }
      const px = b.x - 0.5, py = b.y - 0.5, B = px * b.dx + py * b.dy, C = px * px + py * py - CR * CR, D = B * B - C;
      if (B < 0 && D > 0) {
        const t = -B - Math.sqrt(D);
        if (t > 1e-12 && t < best) { best = t; nx = (px + t * b.dx) / CR; ny = (py + t * b.dy) / CR; }
      }
      return [Math.max(best, 0), nx, ny];
    },
    step(s, dt) {
      const dist = Math.min(dt, 0.12) * 0.75;
      for (const b of s.balls) billiardMove(b, dist, this, 11);
      s.t += dt;
      const [a, b] = s.balls;
      if (!s.split && Math.hypot(a.x - b.x, a.y - b.y) > 0.012) s.split = [a.x, a.y, s.t];
      if (s.t > 45 || (s.split && s.t - s.split[2] > 12)) this.reset(s);
    },
    draw(ctx, s) {
      const { W0, W1, CR } = this;
      ctx.strokeRect(W0, W0, W1 - W0, W1 - W0);
      circle(ctx, 0.5, 0.5, CR);
      circle(ctx, 0.5, 0.5, CR * 0.62);
      circle(ctx, 0.5, 0.5, CR * 0.26);
      const [a, b] = s.balls;
      poly(ctx, [...a.tr, a.x, a.y]);
      ctx.save();
      ctx.setLineDash(DASH);
      poly(ctx, [...b.tr, b.x, b.y]);
      ctx.restore();
      dot(ctx, a.x, a.y, 0.006);
      circle(ctx, b.x, b.y, 0.012);
      if (s.split) circle(ctx, s.split[0], s.split[1], 0.02);
    },
  },
};

// Обрезает ломаную на первом выходе из квадрата [lo..hi]²
function clipPath(pts, lo, hi) {
  const out = [pts[0], pts[1]];
  const inside = (x, y) => x >= lo && x <= hi && y >= lo && y <= hi;
  for (let i = 2; i < pts.length; i += 2) {
    const x0 = out[out.length - 2], y0 = out[out.length - 1], x1 = pts[i], y1 = pts[i + 1];
    if (inside(x1, y1)) { out.push(x1, y1); continue; }
    let t = 1;
    if (x1 > hi) t = Math.min(t, (hi - x0) / (x1 - x0));
    if (x1 < lo) t = Math.min(t, (lo - x0) / (x1 - x0));
    if (y1 > hi) t = Math.min(t, (hi - y0) / (y1 - y0));
    if (y1 < lo) t = Math.min(t, (lo - y0) / (y1 - y0));
    out.push(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
    break;
  }
  return out;
}

// Шар в бильярде: летит на dist, отражаясь от стенок; хранит последние maxB точек отскока
function billiardMove(b, dist, table, maxB) {
  for (let guard = 0; guard < 50 && dist > 0; guard++) {
    const [t, nx, ny] = table.hit(b);
    if (t > dist) { b.x += b.dx * dist; b.y += b.dy * dist; break; }
    b.x += b.dx * t; b.y += b.dy * t; dist -= t;
    const dn = b.dx * nx + b.dy * ny;
    b.dx -= 2 * dn * nx; b.dy -= 2 * dn * ny;
    b.tr.push(b.x, b.y);
    if (b.tr.length > maxB * 2) b.tr.splice(0, 2);
  }
}

// Уровни зума для Хенона: точки одной длинной орбиты, попавшие во вложенные коробки
let HENON = null;
function henonLevels() {
  if (HENON) return HENON;
  const K = 6, SK = 1 / 30, r = Math.pow(SK, 1 / K), M = 15000, HX = 1.36, HY = 0.42;
  const cx = 0.6314, cy = 0.1890;
  const lv = Array.from({ length: K + 1 }, () => new Float32Array(M * 2));
  const cnt = new Array(K + 1).fill(0);
  const hx = [], hy = [];
  for (let k = 0; k <= K; k++) {
    const sc = Math.pow(r, k);
    hx.push([cx + (-HX - cx) * sc, cx + (HX - cx) * sc]);
    hy.push([cy + (-HY - cy) * sc, cy + (HY - cy) * sc]);
  }
  let x = 0.1, y = 0.1, full = 0;
  for (let i = 0; i < 6e6 && full <= K; i++) {
    const nx = 1 - 1.4 * x * x + y;
    y = 0.3 * x; x = nx;
    if (i < 100) continue;
    for (let k = 0; k <= K; k++) {
      if (x < hx[k][0] || x > hx[k][1] || y < hy[k][0] || y > hy[k][1]) break;
      if (cnt[k] < M) {
        lv[k][2 * cnt[k]] = x; lv[k][2 * cnt[k] + 1] = y;
        if (++cnt[k] === M) full++;
      }
    }
  }
  HENON = { K, SK, r, M, HX, HY, cx, cy, lv: lv.map((a, k) => a.subarray(0, cnt[k] * 2)) };
  return HENON;
}

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

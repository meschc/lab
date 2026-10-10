// 4. Частицы: энтропия, броуновское движение, демон Максвелла, стая, доска Гальтона, стигмергия,
// ДОА, хемотаксис, коллективный иммунитет, эхо-камера, неравенство богатства, храповик Фейнмана, трагедия общин
import { dots, circle, line, poly, dot, contours, segments, ease, TAU, DASH } from '../core/draw.js';
import { gauss } from '../core/rng.js';

const W0 = 0.04, W1 = 0.96; // стенки

function makeGas(n, rng, place, speed) {
  const s = { n, x: new Float32Array(n), y: new Float32Array(n), vx: new Float32Array(n), vy: new Float32Array(n) };
  for (let i = 0; i < n; i++) {
    const [x, y] = place(i);
    s.x[i] = x;
    s.y[i] = y;
    const a = rng() * TAU, v = speed * (0.4 + Math.abs(gauss(rng)) * 0.6);
    s.vx[i] = Math.cos(a) * v;
    s.vy[i] = Math.sin(a) * v;
  }
  return s;
}

function moveGas(g, dt, jitter, rng) {
  for (let i = 0; i < g.n; i++) {
    if (jitter) {
      g.vx[i] += gauss(rng) * jitter * dt;
      g.vy[i] += gauss(rng) * jitter * dt;
    }
    g.x[i] += g.vx[i] * dt;
    g.y[i] += g.vy[i] * dt;
    if (g.x[i] < W0) { g.x[i] = W0; g.vx[i] = Math.abs(g.vx[i]); }
    if (g.x[i] > W1) { g.x[i] = W1; g.vx[i] = -Math.abs(g.vx[i]); }
    if (g.y[i] < W0) { g.y[i] = W0; g.vy[i] = Math.abs(g.vy[i]); }
    if (g.y[i] > W1) { g.y[i] = W1; g.vy[i] = -Math.abs(g.vy[i]); }
  }
}

const MODES = {
  // всё начинается в углу и расползается по коробке
  entropy: {
    create(p, rng) {
      const clusters = p.clusters || 1;
      const centers = Array.from({ length: clusters }, (_, k) =>
        clusters === 1 ? [0.2, 0.2] : [0.18 + rng() * 0.64, 0.18 + rng() * 0.64]);
      const size = clusters === 1 ? 0.14 : 0.05;
      const g = makeGas(p.n || 420, rng, (i) => {
        const [cx, cy] = centers[i % clusters];
        return [cx + (rng() - 0.5) * size * 2, cy + (rng() - 0.5) * size * 2];
      }, p.speed || 0.12);
      return { ...g, rng, t: 0, life: p.life || 24, p };
    },
    step(s, dt) {
      moveGas(s, dt, 0.25, s.rng);
      if ((s.t += dt) > s.life) Object.assign(s, MODES.entropy.create(s.p, s.rng));
    },
    draw(ctx, s) {
      // стенки исходной коробки видны первые секунды, пунктиром
      if (!s.p.clusters && s.t < 2.5) {
        ctx.save();
        ctx.setLineDash(DASH);
        ctx.strokeRect(0.05, 0.05, 0.3, 0.3);
        ctx.restore();
      }
      dots(ctx, s.x, s.y, 0.0045);
    },
  },

  // крупная частица получает удары от мелких и оставляет след
  brownian: {
    create(p, rng) {
      const g = makeGas(260, rng, () => [W0 + rng() * 0.92, W0 + rng() * 0.92], 0.35);
      return { ...g, rng, bx: 0.5, by: 0.5, bvx: 0, bvy: 0, R: 0.035, trail: [0.5, 0.5] };
    },
    step(s, dt) {
      moveGas(s, dt, 0, s.rng);
      const M = 30;
      for (let i = 0; i < s.n; i++) {
        const dx = s.x[i] - s.bx, dy = s.y[i] - s.by;
        const d = Math.hypot(dx, dy);
        if (d < s.R && d > 0) {
          const nx = dx / d, ny = dy / d;
          const un = (s.vx[i] - s.bvx) * nx + (s.vy[i] - s.bvy) * ny;
          if (un < 0) {
            const j = (-2 * un) / (1 + 1 / M);
            s.vx[i] += j * nx; s.vy[i] += j * ny;
            s.bvx -= (j / M) * nx; s.bvy -= (j / M) * ny;
          }
        }
      }
      s.bx += s.bvx * dt; s.by += s.bvy * dt;
      const lo = W0 + s.R, hi = W1 - s.R;
      if (s.bx < lo || s.bx > hi) { s.bvx *= -1; s.bx = Math.min(hi, Math.max(lo, s.bx)); }
      if (s.by < lo || s.by > hi) { s.bvy *= -1; s.by = Math.min(hi, Math.max(lo, s.by)); }
      s.trail.push(s.bx, s.by);
      if (s.trail.length > 5000) s.trail.splice(0, 2);
    },
    draw(ctx, s) {
      poly(ctx, s.trail);
      dots(ctx, s.x, s.y, 0.0035);
      ctx.fillStyle = ctx.strokeStyle;
      circle(ctx, s.bx, s.by, s.R);
      circle(ctx, s.bx, s.by, s.R * 0.62);
      dot(ctx, s.bx, s.by, s.R * 0.25);
    },
  },

  // демон пропускает быстрых направо, медленных налево
  maxwell: {
    create(p, rng) {
      const g = makeGas(240, rng, () => [W0 + rng() * 0.92, W0 + rng() * 0.92], 0.16);
      const sp = Array.from(g.vx, (vx, i) => Math.hypot(vx, g.vy[i])).sort((a, b) => a - b);
      return { ...g, rng, median: sp[(sp.length / 2) | 0], t: 0, p };
    },
    step(s, dt) {
      const D0 = 0.42, D1 = 0.58;
      for (let i = 0; i < s.n; i++) {
        const px = s.x[i];
        s.x[i] += s.vx[i] * dt;
        s.y[i] += s.vy[i] * dt;
        if ((px - 0.5) * (s.x[i] - 0.5) < 0) {
          const inDoor = s.y[i] > D0 && s.y[i] < D1;
          const fast = Math.hypot(s.vx[i], s.vy[i]) > s.median;
          const ok = inDoor && ((s.vx[i] > 0 && fast) || (s.vx[i] < 0 && !fast));
          if (!ok) { s.x[i] = px; s.vx[i] *= -1; }
        }
      }
      moveGas(s, 0, 0, s.rng);
      if ((s.t += dt) > 45) Object.assign(s, MODES.maxwell.create(s.p, s.rng));
    },
    draw(ctx, s) {
      line(ctx, 0.5, W0, 0.5, 0.42);
      line(ctx, 0.5, 0.58, 0.5, W1);
      dot(ctx, 0.5, 0.5, 0.007);
      const fx = [], fy = [];
      ctx.beginPath();
      for (let i = 0; i < s.n; i++) {
        if (Math.hypot(s.vx[i], s.vy[i]) > s.median) { fx.push(s.x[i]); fy.push(s.y[i]); }
        else { ctx.moveTo(s.x[i] + 0.006, s.y[i]); ctx.arc(s.x[i], s.y[i], 0.006, 0, TAU); }
      }
      ctx.stroke();
      dots(ctx, fx, fy, 0.005);
    },
  },

  // стая: разделение, выравнивание, сплочённость
  boids: {
    create(p, rng) {
      const n = p.n || 110;
      const g = makeGas(n, rng, () => [rng(), rng()], 0.18);
      return { ...g, rng };
    },
    step(s, dt) {
      const R = 0.09, SEP = 0.03, V = 0.2;
      for (let i = 0; i < s.n; i++) {
        let ax = 0, ay = 0, cx = 0, cy = 0, sx = 0, sy = 0, k = 0;
        for (let j = 0; j < s.n; j++) {
          if (i === j) continue;
          let dx = s.x[j] - s.x[i], dy = s.y[j] - s.y[i];
          if (dx > 0.5) dx -= 1; if (dx < -0.5) dx += 1;
          if (dy > 0.5) dy -= 1; if (dy < -0.5) dy += 1;
          const d = Math.hypot(dx, dy);
          if (d < R) {
            k++; ax += s.vx[j]; ay += s.vy[j]; cx += dx; cy += dy;
            if (d < SEP) { sx -= dx / (d + 1e-4); sy -= dy / (d + 1e-4); }
          }
        }
        if (k) {
          s.vx[i] += ((ax / k - s.vx[i]) * 1.6 + (cx / k) * 1.2 + sx * 0.03) * dt;
          s.vy[i] += ((ay / k - s.vy[i]) * 1.6 + (cy / k) * 1.2 + sy * 0.03) * dt;
        }
        const v = Math.hypot(s.vx[i], s.vy[i]) || 1;
        s.vx[i] = (s.vx[i] / v) * V;
        s.vy[i] = (s.vy[i] / v) * V;
      }
      for (let i = 0; i < s.n; i++) {
        s.x[i] = (s.x[i] + s.vx[i] * dt + 1) % 1;
        s.y[i] = (s.y[i] + s.vy[i] * dt + 1) % 1;
      }
    },
    draw(ctx, s) {
      // стая живёт в торе 0..1, а рисуется с полями, чтобы не вылезать за квадрат
      ctx.save();
      ctx.translate(0.05, 0.05);
      ctx.scale(0.9, 0.9);
      ctx.beginPath();
      for (let i = 0; i < s.n; i++) {
        const v = Math.hypot(s.vx[i], s.vy[i]) || 1;
        const ux = s.vx[i] / v, uy = s.vy[i] / v, L = 0.016;
        ctx.moveTo(s.x[i] - ux * L - uy * L * 0.5, s.y[i] - uy * L + ux * L * 0.5);
        ctx.lineTo(s.x[i], s.y[i]);
        ctx.lineTo(s.x[i] - ux * L + uy * L * 0.5, s.y[i] - uy * L - ux * L * 0.5);
      }
      ctx.stroke();
      ctx.restore();
    },
  },

  // доска Гальтона: случайные отскоки складываются в колокол
  galton: {
    create(p, rng) {
      return { rng, R: 12, balls: [], bins: new Array(13).fill(0), acc: 0, total: 0, hold: 0 };
    },
    step(s, dt) {
      const DX = 0.05;
      s.acc += dt;
      if (s.total < 320 && s.acc > 0.07) { s.acc = 0; s.total++; s.balls.push({ r: 0, c: 0, t: 0, rnd: s.rng() < 0.5 ? 0 : 1 }); }
      for (const b of s.balls) {
        b.t += dt * 6;
        if (b.t >= 1) { b.t = 0; b.r++; b.c += b.rnd; b.rnd = s.rng() < 0.5 ? 0 : 1; }
      }
      s.balls = s.balls.filter((b) => {
        if (b.r >= s.R) { s.bins[b.c]++; return false; }
        return true;
      });
      if (s.total >= 320 && !s.balls.length && (s.hold += dt) > 3) Object.assign(s, MODES.galton.create({}, s.rng));
      s.DX = DX;
    },
    draw(ctx, s) {
      const DX = 0.05, DY = 0.034, TOP = 0.08;
      const px = [], py = [];
      for (let r = 0; r < s.R; r++) for (let c = 0; c <= r; c++) { px.push(0.5 + (c - r / 2) * DX); py.push(TOP + r * DY + 0.02); }
      dots(ctx, px, py, 0.004);
      ctx.beginPath();
      for (const b of s.balls) {
        const c = b.c + b.rnd * b.t;
        const x = 0.5 + (c - (b.r + b.t) / 2) * DX;
        const y = TOP + (b.r + b.t) * DY;
        ctx.moveTo(x + 0.008, y); ctx.arc(x, y, 0.008, 0, TAU);
      }
      ctx.stroke();
      const bottom = 0.955, d = 0.0145;
      ctx.beginPath();
      for (let c = 0; c <= s.R; c++) {
        const cx = 0.5 + (c - s.R / 2) * DX;
        for (let k = 0; k < s.bins[c]; k++) {
          const col = k % 3, row = (k / 3) | 0;
          const x = cx + (col - 1) * d, y = bottom - row * d - d / 2;
          ctx.moveTo(x + d * 0.42, y); ctx.arc(x, y, d * 0.42, 0, TAU);
        }
      }
      ctx.stroke();
      ctx.beginPath();
      for (let c = 0; c <= s.R + 1; c++) {
        const x = 0.5 + (c - 0.5 - s.R / 2) * DX;
        ctx.moveTo(x, 0.6); ctx.lineTo(x, bottom + 0.005);
      }
      ctx.moveTo(0.5 - (s.R / 2 + 0.5) * DX, bottom + 0.005); ctx.lineTo(0.5 + (s.R / 2 + 0.5) * DX, bottom + 0.005);
      ctx.stroke();
    },
  },

  // стигмергия: агенты следуют за следом, который сами оставляют (модель Physarum)
  stigmergy: {
    create(p, rng) {
      const G = 100, n = 1600;
      const s = { rng, G, trail: new Float32Array(G * G), tmp: new Float32Array(G * G), n,
        x: new Float32Array(n), y: new Float32Array(n), h: new Float32Array(n), t: 0, p };
      for (let i = 0; i < n; i++) {
        const a = rng() * TAU, r = Math.sqrt(rng()) * 0.3;
        s.x[i] = 0.5 + Math.cos(a) * r; s.y[i] = 0.5 + Math.sin(a) * r; s.h[i] = rng() * TAU;
      }
      return s;
    },
    step(s, dt) {
      const { G, trail } = s;
      // классические параметры Physarum (Jones, 2010): угол датчиков 22,5°, поворот 45°, датчик в 9 клетках
      const SA = 0.39, SO = 0.09, RA = 0.785, V = 0.01;
      const at = (x, y) => {
        const i = Math.floor(x * G), j = Math.floor(y * G);
        return i < 0 || j < 0 || i >= G || j >= G ? -1 : trail[j * G + i];
      };
      for (let k = 0; k < s.n; k++) {
        const x = s.x[k], y = s.y[k], h = s.h[k];
        const f = at(x + Math.cos(h) * SO, y + Math.sin(h) * SO);
        const l = at(x + Math.cos(h - SA) * SO, y + Math.sin(h - SA) * SO);
        const r = at(x + Math.cos(h + SA) * SO, y + Math.sin(h + SA) * SO);
        if (f > l && f > r) { /* след впереди — идём прямо */ }
        else if (f < l && f < r) s.h[k] += s.rng() < 0.5 ? RA : -RA;
        else if (l > r) s.h[k] -= RA;
        else if (r > l) s.h[k] += RA;
        let nx = x + Math.cos(s.h[k]) * V, ny = y + Math.sin(s.h[k]) * V;
        if (nx < 0.03 || nx > 0.97 || ny < 0.03 || ny > 0.97) { s.h[k] += Math.PI; nx = x; ny = y; }
        s.x[k] = nx; s.y[k] = ny;
        const i = Math.floor(nx * G), j = Math.floor(ny * G);
        trail[j * G + i] += 1;
      }
      // диффузия и испарение
      const tmp = s.tmp;
      for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
        let sum = 0;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          const ii = Math.min(G - 1, Math.max(0, i + di)), jj = Math.min(G - 1, Math.max(0, j + dj));
          sum += trail[jj * G + ii];
        }
        tmp[j * G + i] = (trail[j * G + i] * 0.4 + (sum / 9) * 0.6) * 0.9;
      }
      s.trail = tmp; s.tmp = trail;
      let mean = 0;
      for (let i = 0; i < s.trail.length; i++) mean += s.trail[i];
      mean /= s.trail.length;
      s.segs = contours(s.trail, G, G, mean * 1.6, []);
      contours(s.trail, G, G, mean * 4, s.segs);
      if ((s.t += dt) > 40) Object.assign(s, MODES.stigmergy.create(s.p, s.rng));
    },
    draw(ctx, s) {
      if (s.segs) segments(ctx, s.segs);
    },
  },

  // ——— дополнительные режимы ———

  // ДОА: блуждающие частицы прилипают к растущему кораллу, ветви — линии «родитель → ребёнок»
  dla: {
    create(p, rng) {
      const A = 0.008, G = Math.ceil(1 / A) + 2, MAX = 2600, NW = p.walkers || 90;
      const s = { rng, p, A, G, MAX, NW, head: new Int32Array(G * G).fill(-1), next: new Int32Array(MAX),
        px: new Float32Array(MAX), py: new Float32Array(MAX), par: new Int32Array(MAX), n: 0, rmax: 0,
        wx: new Float32Array(NW), wy: new Float32Array(NW), hold: 0 };
      dlaAdd(s, 0.5, 0.5, -1);
      for (let i = 0; i < NW; i++) dlaLaunch(s, i);
      return s;
    },
    step(s, dt) {
      if (s.rmax > 0.385 || s.n >= s.MAX) {
        if ((s.hold += dt) > 3.5) Object.assign(s, MODES.dla.create(s.p, s.rng));
        return;
      }
      const { A, G, rng } = s, A2 = A * A, L = A * 0.8;
      const sub = Math.max(1, Math.round(dt * 30 * (2 + s.rmax * 22)));
      for (let k = 0; k < sub; k++) {
        const kill = Math.min(s.rmax + 0.12, 0.46);
        for (let i = 0; i < s.NW; i++) {
          // вдали от коралла шаг крупнее: там всё равно не за что зацепиться
          const a = rng() * TAU, gap = Math.hypot(s.wx[i] - 0.5, s.wy[i] - 0.5) - s.rmax - 2 * A;
          const st = gap > L ? Math.min(gap, 0.025) : L;
          const x = s.wx[i] + Math.cos(a) * st, y = s.wy[i] + Math.sin(a) * st;
          if (Math.hypot(x - 0.5, y - 0.5) > kill) { dlaLaunch(s, i); continue; }
          s.wx[i] = x; s.wy[i] = y;
          const cx = (x / A) | 0, cy = (y / A) | 0;
          let hit = -1;
          for (let jy = cy - 1; jy <= cy + 1 && hit < 0; jy++) {
            for (let jx = cx - 1; jx <= cx + 1 && hit < 0; jx++) {
              for (let q = s.head[jy * G + jx]; q >= 0; q = s.next[q]) {
                const ex = x - s.px[q], ey = y - s.py[q];
                if (ex * ex + ey * ey < A2) { hit = q; break; }
              }
            }
          }
          if (hit >= 0) {
            const ex = x - s.px[hit], ey = y - s.py[hit], e = Math.hypot(ex, ey) || 1;
            dlaAdd(s, s.px[hit] + (ex / e) * A, s.py[hit] + (ey / e) * A, hit);
            dlaLaunch(s, i);
            if (s.n >= s.MAX) return;
          }
        }
      }
    },
    draw(ctx, s) {
      ctx.beginPath();
      for (let i = 1; i < s.n; i++) {
        const q = s.par[i];
        ctx.moveTo(s.px[q], s.py[q]);
        ctx.lineTo(s.px[i], s.py[i]);
      }
      ctx.stroke();
      circle(ctx, 0.5, 0.5, 0.009);
      if (!s.hold) dots(ctx, s.wx, s.wy, 0.0035);
      dashed(ctx, () => circle(ctx, 0.5, 0.5, dlaR(s)));
    },
  },

  // хемотаксис: «бег и кувырок» — кувыркаться реже, когда становится вкуснее
  chemotaxis: {
    create(p, rng) {
      const n = p.n || 38, T = 9;
      const s = { rng, p, n, T, x: new Float32Array(n), y: new Float32Array(n), h: new Float32Array(n),
        c: new Float32Array(n), tr: new Float32Array(n * T * 2), ti: 0, tacc: 0, t: 0, mt: 1,
        sx: 0.36 + rng() * 0.28, sy: 0.36 + rng() * 0.28, ax: 0, ay: 0, bx: 0, by: 0 };
      for (let i = 0; i < n; i++) {
        s.x[i] = 0.08 + rng() * 0.84; s.y[i] = 0.08 + rng() * 0.84; s.h[i] = rng() * TAU;
        s.c[i] = -Math.hypot(s.x[i] - s.sx, s.y[i] - s.sy);
        for (let k = 0; k < T; k++) { s.tr[(i * T + k) * 2] = s.x[i]; s.tr[(i * T + k) * 2 + 1] = s.y[i]; }
      }
      return s;
    },
    step(s, dt) {
      const { rng } = s;
      // источник переезжает раз в 14 секунд
      if ((s.t += dt) > 14) {
        s.t = 0; s.mt = 0; s.ax = s.sx; s.ay = s.sy;
        do { s.bx = 0.3 + rng() * 0.4; s.by = 0.3 + rng() * 0.4; } while (Math.hypot(s.bx - s.ax, s.by - s.ay) < 0.22);
      }
      if (s.mt < 1) {
        s.mt = Math.min(1, s.mt + dt / 2.5);
        const e = ease(s.mt);
        s.sx = s.ax + (s.bx - s.ax) * e; s.sy = s.ay + (s.by - s.ay) * e;
      }
      const V = 0.085, B0 = 0.07, B1 = 0.93;
      for (let i = 0; i < s.n; i++) {
        let x = s.x[i] + Math.cos(s.h[i]) * V * dt, y = s.y[i] + Math.sin(s.h[i]) * V * dt;
        if (x < B0 || x > B1) { s.h[i] = Math.PI - s.h[i]; x = Math.min(B1, Math.max(B0, x)); }
        if (y < B0 || y > B1) { s.h[i] = -s.h[i]; y = Math.min(B1, Math.max(B0, y)); }
        s.x[i] = x; s.y[i] = y;
        const c = -Math.hypot(x - s.sx, y - s.sy);
        const rate = c > s.c[i] ? 0.25 : 3; // по градиенту — бежим дольше
        s.c[i] = c;
        if (rng() < rate * dt) s.h[i] += (rng() - 0.5) * 4.4;
      }
      if ((s.tacc += dt) > 0.08) {
        s.tacc = 0; s.ti = (s.ti + 1) % s.T;
        for (let i = 0; i < s.n; i++) { s.tr[(i * s.T + s.ti) * 2] = s.x[i]; s.tr[(i * s.T + s.ti) * 2 + 1] = s.y[i]; }
      }
    },
    draw(ctx, s) {
      dashed(ctx, () => { for (let k = 1; k <= 4; k++) circle(ctx, s.sx, s.sy, 0.045 * k); });
      circle(ctx, s.sx, s.sy, 0.012);
      dot(ctx, s.sx, s.sy, 0.005);
      ctx.beginPath();
      for (let i = 0; i < s.n; i++) {
        for (let k = 1; k <= s.T; k++) {
          const q = (i * s.T + ((s.ti + k) % s.T)) * 2;
          k === 1 ? ctx.moveTo(s.tr[q], s.tr[q + 1]) : ctx.lineTo(s.tr[q], s.tr[q + 1]);
        }
        ctx.lineTo(s.x[i], s.y[i]);
      }
      ctx.stroke();
      dots(ctx, s.x, s.y, 0.0048);
    },
  },

  // коллективный иммунитет: SIR среди точек, привитые (+) рвут цепочки, волна гаснет
  herd: {
    create(p, rng) {
      const n = p.n || 240;
      const s = { rng, p, n, x: new Float32Array(n), y: new Float32Array(n), vx: new Float32Array(n), vy: new Float32Array(n),
        st: new Uint8Array(n), it: new Float32Array(n), hold: 0, t: 0 };
      const vacc = p.vacc ?? 0.55;
      for (let i = 0; i < n; i++) {
        s.x[i] = 0.08 + rng() * 0.84; s.y[i] = 0.08 + rng() * 0.84;
        const a = rng() * TAU; s.vx[i] = Math.cos(a) * 0.03; s.vy[i] = Math.sin(a) * 0.03;
        s.st[i] = rng() < vacc ? 3 : 0; // 0 — восприимчив, 1 — болен, 2 — переболел, 3 — привит
      }
      // первые случаи — ближайшие к центру восприимчивые
      const S = [];
      for (let i = 0; i < n; i++) if (!s.st[i]) S.push(i);
      S.sort((a, b) => Math.hypot(s.x[a] - 0.5, s.y[a] - 0.5) - Math.hypot(s.x[b] - 0.5, s.y[b] - 0.5));
      for (let k = 0; k < Math.min(3, S.length); k++) s.st[S[k]] = 1;
      return s;
    },
    step(s, dt) {
      const { rng, n } = s, B0 = 0.07, B1 = 0.93, R2 = 0.04 * 0.04, BETA = (s.p.beta ?? 2.6), TI = 4;
      for (let i = 0; i < n; i++) {
        s.vx[i] += gauss(rng) * 0.04 * dt; s.vy[i] += gauss(rng) * 0.04 * dt;
        const v = Math.hypot(s.vx[i], s.vy[i]) || 1;
        s.vx[i] *= 0.03 / v; s.vy[i] *= 0.03 / v;
        s.x[i] += s.vx[i] * dt; s.y[i] += s.vy[i] * dt;
        if (s.x[i] < B0) { s.x[i] = B0; s.vx[i] = Math.abs(s.vx[i]); }
        if (s.x[i] > B1) { s.x[i] = B1; s.vx[i] = -Math.abs(s.vx[i]); }
        if (s.y[i] < B0) { s.y[i] = B0; s.vy[i] = Math.abs(s.vy[i]); }
        if (s.y[i] > B1) { s.y[i] = B1; s.vy[i] = -Math.abs(s.vy[i]); }
      }
      let sick = 0;
      for (let i = 0; i < n; i++) {
        if (s.st[i] !== 1) continue;
        if ((s.it[i] += dt) > TI) { s.st[i] = 2; continue; }
        sick++;
        for (let j = 0; j < n; j++) {
          if (s.st[j]) continue;
          const dx = s.x[j] - s.x[i], dy = s.y[j] - s.y[i];
          if (dx * dx + dy * dy < R2 && rng() < BETA * dt) { s.st[j] = 4; s.it[j] = 0; }
        }
      }
      for (let i = 0; i < n; i++) if (s.st[i] === 4) { s.st[i] = 1; sick++; }
      s.t += dt;
      if ((!sick && (s.hold += dt) > 3.5) || s.t > 60) Object.assign(s, MODES.herd.create(s.p, rng));
    },
    draw(ctx, s) {
      const sx = [], sy = [];
      ctx.beginPath();
      for (let i = 0; i < s.n; i++) {
        const st = s.st[i], x = s.x[i], y = s.y[i];
        if (st === 0) { sx.push(x); sy.push(y); }
        else if (st === 1) { ringPath(ctx, x, y, 0.0065); ringPath(ctx, x, y, 0.016); }
        else if (st === 2) ringPath(ctx, x, y, 0.0045);
        else crossPath(ctx, x, y, 0.005, true);
      }
      ctx.stroke();
      dots(ctx, sx, sy, 0.0042);
    },
  },

  // эхо-камера: модель ограниченного доверия Дефюана — Вайсбуха
  echo: {
    create(p, rng) {
      const n = p.n || 90;
      const s = { rng, p, n, o: new Float32Array(n), y: new Float32Array(n), eps: p.eps || 0.15, mu: 0.3, links: [], t: 0 };
      for (let i = 0; i < n; i++) { s.o[i] = rng(); s.y[i] = 0.1 + ((i + rng()) / n) * 0.8; }
      return s;
    },
    step(s, dt) {
      const { rng, n, o } = s;
      const tries = Math.round(dt * 300);
      for (let k = 0; k < tries; k++) {
        const i = (rng() * n) | 0, j = (rng() * n) | 0;
        const d = o[j] - o[i];
        if (i === j || Math.abs(d) >= s.eps) continue;
        o[i] += s.mu * d; o[j] -= s.mu * d;
        if (rng() < 0.5) s.links.push(i, j, 0);
      }
      const L = s.links;
      let w = 0;
      for (let k = 0; k < L.length; k += 3) {
        const a = L[k + 2] + dt;
        if (a < 0.4) { L[w] = L[k]; L[w + 1] = L[k + 1]; L[w + 2] = a; w += 3; }
      }
      L.length = w;
      if ((s.t += dt) > 25) Object.assign(s, MODES.echo.create(s.p, rng));
    },
    draw(ctx, s) {
      const X = (v) => 0.08 + v * 0.84;
      const L = s.links;
      ctx.beginPath();
      for (let k = 0; k < L.length; k += 3) {
        const i = L[k], j = L[k + 1];
        ctx.moveTo(X(s.o[i]), s.y[i]); ctx.lineTo(X(s.o[j]), s.y[j]);
      }
      ctx.stroke();
      const xs = Array.from(s.o, X);
      dots(ctx, xs, s.y, 0.0045);
      // одно мнение и его окно доверия ±ε
      const x0 = xs[0], y0 = s.y[0];
      const a = Math.max(0.06, X(s.o[0] - s.eps)), b = Math.min(0.94, X(s.o[0] + s.eps));
      circle(ctx, x0, y0, 0.013);
      dashed(ctx, () => line(ctx, a, y0, b, y0));
      line(ctx, a, y0 - 0.012, a, y0 + 0.012);
      line(ctx, b, y0 - 0.012, b, y0 + 0.012);
    },
  },

  // неравенство богатства: честные случайные обмены дают экспоненту (Драгулеску — Яковенко)
  wealth: {
    create(p, rng) {
      const n = p.n || 160;
      const s = { rng, p, n, x: new Float32Array(n), y: new Float32Array(n), vx: new Float32Array(n), vy: new Float32Array(n),
        m: new Float32Array(n).fill(1), cd: new Float32Array(n), links: [], bins: new Float32Array(WB), sc: 0, t: 0 };
      for (let i = 0; i < n; i++) {
        s.x[i] = 0.08 + rng() * 0.84; s.y[i] = 0.08 + rng() * 0.4;
        const a = rng() * TAU, v = 0.1 + rng() * 0.06;
        s.vx[i] = Math.cos(a) * v; s.vy[i] = Math.sin(a) * v;
      }
      wealthHist(s, 1);
      return s;
    },
    step(s, dt) {
      const { rng, n } = s, X0 = 0.07, X1 = 0.93, Y0 = 0.07, Y1 = 0.5, R = 0.024;
      for (let i = 0; i < n; i++) {
        s.x[i] += s.vx[i] * dt; s.y[i] += s.vy[i] * dt;
        if (s.x[i] < X0) { s.x[i] = X0; s.vx[i] = Math.abs(s.vx[i]); }
        if (s.x[i] > X1) { s.x[i] = X1; s.vx[i] = -Math.abs(s.vx[i]); }
        if (s.y[i] < Y0) { s.y[i] = Y0; s.vy[i] = Math.abs(s.vy[i]); }
        if (s.y[i] > Y1) { s.y[i] = Y1; s.vy[i] = -Math.abs(s.vy[i]); }
        s.cd[i] -= dt;
      }
      for (let i = 0; i < n; i++) {
        if (s.cd[i] > 0) continue;
        for (let j = i + 1; j < n; j++) {
          if (s.cd[j] > 0) continue;
          const dx = s.x[j] - s.x[i];
          if (dx > R || dx < -R) continue;
          const dy = s.y[j] - s.y[i];
          if (dx * dx + dy * dy > R * R) continue;
          // честный обмен: общая сумма делится случайно
          const pool = s.m[i] + s.m[j], e = rng();
          s.m[i] = pool * e; s.m[j] = pool - s.m[i];
          s.cd[i] = s.cd[j] = 0.6;
          s.links.push(i, j, 0);
          break;
        }
      }
      const L = s.links;
      let w = 0;
      for (let k = 0; k < L.length; k += 3) {
        const a = L[k + 2] + dt;
        if (a < 0.25) { L[w] = L[k]; L[w + 1] = L[k + 1]; L[w + 2] = a; w += 3; }
      }
      L.length = w;
      wealthHist(s, Math.min(1, dt * 1.5));
      if ((s.t += dt) > 34) Object.assign(s, MODES.wealth.create(s.p, rng));
    },
    draw(ctx, s) {
      const L = s.links;
      ctx.beginPath();
      for (let k = 0; k < L.length; k += 3) { const i = L[k], j = L[k + 1]; ctx.moveTo(s.x[i], s.y[i]); ctx.lineTo(s.x[j], s.y[j]); }
      for (let i = 0; i < s.n; i++) if (s.m[i] > 1.8) ringPath(ctx, s.x[i], s.y[i], 0.0045 * Math.sqrt(s.m[i]));
      ctx.stroke();
      const px = [], py = [];
      for (let i = 0; i < s.n; i++) if (s.m[i] <= 1.8) { px.push(s.x[i]); py.push(s.y[i]); }
      dots(ctx, px, py, 0.0035);
      // гистограмма-лестница и пунктиром — экспонента
      const BX0 = 0.08, BW = 0.84 / WB, base = 0.93;
      ctx.beginPath();
      ctx.moveTo(BX0, base);
      for (let k = 0; k < WB; k++) {
        const h = s.bins[k] * s.sc;
        ctx.lineTo(BX0 + k * BW, base - h); ctx.lineTo(BX0 + (k + 1) * BW, base - h);
      }
      ctx.lineTo(BX0 + 0.84, base);
      ctx.moveTo(BX0, base); ctx.lineTo(BX0 + 0.84, base);
      const m1 = BX0 + (1 / WM) * 0.84;
      ctx.moveTo(m1, base); ctx.lineTo(m1, base + 0.014);
      ctx.stroke();
      const q = s.n * (1 - Math.exp(-WM / WB)) * s.sc;
      dashed(ctx, () => {
        ctx.beginPath();
        for (let k = 0; k <= 40; k++) {
          const mm = WM / WB / 2 + (k / 40) * (WM - WM / WB / 2);
          const x = BX0 + (mm / WM) * 0.84, y = base - q * Math.exp(-(mm - WM / WB / 2));
          k ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        }
        ctx.stroke();
      });
    },
  },

  // броуновский храповик Фейнмана: при равной температуре колесо только дрожит
  ratchet: {
    create(p, rng) {
      const L = makeGas(p.n || 90, rng, () => [RL[0] + 0.01 + rng() * 0.38, RL[1] + 0.01 + rng() * 0.46], 0.3);
      const Rg = makeGas(70, rng, () => {
        let x, y;
        do { x = RR[0] + 0.01 + rng() * 0.38; y = RR[1] + 0.01 + rng() * 0.46; } while (Math.hypot(x - GC[0], y - GC[1]) < GT + 0.01);
        return [x, y];
      }, 0.3);
      return { rng, p, L, Rg, phi: 0, om: 0, up: 0, lh: 0, hist: new Float32Array(HN), hn: 0, hi: 0 };
    },
    step(s, dt) {
      const { rng } = s, a = TAU / NT, sec = TAU / NP, I = 0.4;
      // собачка сама дрожит в газе той же температуры и иногда подскакивает
      if (s.up > 0) s.up -= dt;
      else if (rng() < LIFT * dt) s.up = 0.25 + rng() * 0.25;
      s.lh += ((s.up > 0 ? 1 : 0) - s.lh) * Math.min(1, dt * 14);
      const down = s.up <= 0;
      let om = s.om;
      if (down) om += (KAP / I) * dt; // пружина давит собачкой на скос зуба
      const phi0 = s.phi;
      let phi = phi0 + om * dt;
      if (down) {
        const step = PC - Math.floor((PC - phi0) / a) * a; // ближайшая ступенька в сторону роста φ
        if (phi > step - 1e-4) { phi = step - 1e-4; om = -om * 0.3; }
      }
      // удары молекул о лопасти
      const g = s.L;
      for (let i = 0; i < g.n; i++) {
        const ox = g.x[i], oy = g.y[i];
        let x = ox + g.vx[i] * dt, y = oy + g.vy[i] * dt;
        if (x < RL[0]) { x = RL[0]; g.vx[i] = Math.abs(g.vx[i]); }
        if (x > RL[2]) { x = RL[2]; g.vx[i] = -Math.abs(g.vx[i]); }
        if (y < RL[1]) { y = RL[1]; g.vy[i] = Math.abs(g.vy[i]); }
        if (y > RL[3]) { y = RL[3]; g.vy[i] = -Math.abs(g.vy[i]); }
        const dx = x - VC[0], dy = y - VC[1], r = Math.hypot(dx, dy);
        const odx = ox - VC[0], ody = oy - VC[1], or = Math.hypot(odx, ody);
        if (r < VR && or < VR && r > 0.02 && or > 0.02) {
          const kb = Math.floor(mod(Math.atan2(ody, odx) - phi0, TAU) / sec);
          const ka = Math.floor(mod(Math.atan2(dy, dx) - phi, TAU) / sec);
          if (ka !== kb) {
            const th = Math.atan2(ody, odx), tx = -Math.sin(th), ty = Math.cos(th);
            const ut = g.vx[i] * tx + g.vy[i] * ty, V = om * or, M = I / (or * or);
            const u2 = ((1 - M) * ut + 2 * M * V) / (1 + M), V2 = ((M - 1) * V + 2 * ut) / (1 + M);
            g.vx[i] += (u2 - ut) * tx; g.vy[i] += (u2 - ut) * ty;
            om = V2 / or;
            x = ox; y = oy;
          }
        }
        g.x[i] = x; g.y[i] = y;
      }
      s.phi = phi; s.om = om;
      // газ у храповика: та же температура, отражается от колеса
      const h = s.Rg;
      for (let i = 0; i < h.n; i++) {
        let x = h.x[i] + h.vx[i] * dt, y = h.y[i] + h.vy[i] * dt;
        if (x < RR[0]) { x = RR[0]; h.vx[i] = Math.abs(h.vx[i]); }
        if (x > RR[2]) { x = RR[2]; h.vx[i] = -Math.abs(h.vx[i]); }
        if (y < RR[1]) { y = RR[1]; h.vy[i] = Math.abs(h.vy[i]); }
        if (y > RR[3]) { y = RR[3]; h.vy[i] = -Math.abs(h.vy[i]); }
        const dx = x - GC[0], dy = y - GC[1], r = Math.hypot(dx, dy);
        if (r < GT + 0.006) {
          const nx = dx / (r || 1), ny = dy / (r || 1), vn = h.vx[i] * nx + h.vy[i] * ny;
          if (vn < 0) { h.vx[i] -= 2 * vn * nx; h.vy[i] -= 2 * vn * ny; }
          x = GC[0] + nx * (GT + 0.006); y = GC[1] + ny * (GT + 0.006);
        }
        h.x[i] = x; h.y[i] = y;
      }
      s.hist[s.hi] = s.phi; s.hi = (s.hi + 1) % HN; s.hn = Math.min(HN, s.hn + 1);
    },
    draw(ctx, s) {
      const a = TAU / NT;
      ctx.strokeRect(RL[0] - 0.006, RL[1] - 0.006, RL[2] - RL[0] + 0.012, RL[3] - RL[1] + 0.012);
      ctx.strokeRect(RR[0] - 0.006, RR[1] - 0.006, RR[2] - RR[0] + 0.012, RR[3] - RR[1] + 0.012);
      line(ctx, VC[0] + 0.018, VC[1], GC[0] - 0.018, GC[1]);
      // лопасти
      ctx.beginPath();
      for (let k = 0; k < NP; k++) {
        const t = s.phi + (k * TAU) / NP, c = Math.cos(t), sn = Math.sin(t);
        ctx.moveTo(VC[0] + c * 0.018, VC[1] + sn * 0.018); ctx.lineTo(VC[0] + c * VR, VC[1] + sn * VR);
      }
      ringPath(ctx, VC[0], VC[1], 0.018);
      ctx.stroke();
      dashed(ctx, () => circle(ctx, VC[0], VC[1], VR));
      ctx.beginPath();
      // зубчатое колесо: пологий скос и отвесная ступенька
      for (let k = 0; k < NT; k++) {
        for (let q = 0; q <= 4; q++) {
          const t = s.phi + (k + q / 4) * a, r = GR + (GT - GR) * (q / 4);
          const x = GC[0] + Math.cos(t) * r, y = GC[1] + Math.sin(t) * r;
          k === 0 && q === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        const t = s.phi + (k + 1) * a;
        ctx.lineTo(GC[0] + Math.cos(t) * GR, GC[1] + Math.sin(t) * GR);
      }
      ctx.closePath();
      ringPath(ctx, GC[0], GC[1], 0.018);
      // собачка на пружине
      const u = mod((PC - s.phi) / a, 1);
      const rc = GR + (GT - GR) * u + s.lh * 0.03;
      const tx = GC[0] + Math.cos(PC) * rc, ty = GC[1] + Math.sin(PC) * rc;
      ctx.moveTo(PV[0], PV[1]); ctx.lineTo(tx, ty);
      ringPath(ctx, PV[0], PV[1], 0.008);
      const mx = (PV[0] + tx) / 2, my = (PV[1] + ty) / 2, top = RR[1] - 0.006, zz = 6;
      ctx.moveTo(mx, my);
      for (let k = 1; k < zz; k++) ctx.lineTo(mx + (k % 2 ? 0.012 : -0.012), my + ((top - my) * k) / zz);
      ctx.lineTo(mx, top);
      ctx.stroke();
      dots(ctx, s.L.x, s.L.y, 0.0035);
      dots(ctx, s.Rg.x, s.Rg.y, 0.0035);
      // след угла: дрожь без направленного дрейфа
      const TX0 = 0.08, TW = 0.84, TY = 0.78;
      dashed(ctx, () => line(ctx, TX0, TY, TX0 + TW, TY));
      if (s.hn > 1) {
        let mean = 0;
        for (let k = 0; k < s.hn; k++) mean += s.hist[k];
        mean /= s.hn;
        ctx.beginPath();
        let lx = 0, ly = 0;
        for (let k = 0; k < s.hn; k++) {
          const v = s.hist[(s.hi - s.hn + k + HN) % HN];
          lx = TX0 + (k / (HN - 1)) * TW;
          ly = TY + Math.max(-0.1, Math.min(0.1, ((v - mean) / a) * 0.07));
          k ? ctx.lineTo(lx, ly) : ctx.moveTo(lx, ly);
        }
        ctx.stroke();
        dot(ctx, lx, ly, 0.006);
      }
    },
  },

  // трагедия общин: каждый пастух добавляет овцу, луг выедается быстрее, чем отрастает
  commons: {
    create(p, rng) {
      const G = CG, g = new Float32Array(G * G);
      for (let i = 0; i < g.length; i++) g[i] = 0.82 + rng() * 0.18;
      return { rng, p, g, sx: [], sy: [], sh: [], tm: [0.3, 0.9, 1.5, 2.1], phase: 0, hold: 0, mean: 1 };
    },
    step(s, dt) {
      const { rng, g } = s, cs = (C1 - C0) / CG;
      const grow = s.phase === 2 ? 1.6 : 0.13;
      let sum = 0;
      for (let i = 0; i < g.length; i++) {
        g[i] = Math.min(1, g[i] + (grow * g[i] * (1 - g[i]) + 0.004) * dt);
        sum += g[i];
      }
      s.mean = sum / g.length;
      if (s.phase === 0) {
        // каждый пастух рассуждает одинаково: ещё одна овца — моя выгода, а убыток делим на всех
        for (let k = 0; k < 4; k++) {
          if ((s.tm[k] -= dt) > 0) continue;
          s.tm[k] = 2.4;
          const [hx, hy] = HERD[k];
          s.sx.push(0.5 + (hx - 0.5) * 0.78); s.sy.push(0.5 + (hy - 0.5) * 0.78);
          s.sh.push(Math.atan2(0.5 - hy, 0.5 - hx) + (rng() - 0.5));
        }
        if (s.mean < 0.07) s.phase = 1;
      } else if (s.phase === 1) {
        if ((s.hold += dt) > 2.5) { s.phase = 2; s.sx = []; s.sy = []; s.sh = []; }
      } else if (s.mean > 0.9) Object.assign(s, MODES.commons.create(s.p, rng));
      const V = 0.06, lo = C0 + 0.012, hi = C1 - 0.012;
      for (let k = 0; k < s.sx.length; k++) {
        const ci = Math.min(CG - 1, Math.max(0, ((s.sx[k] - C0) / cs) | 0));
        const cj = Math.min(CG - 1, Math.max(0, ((s.sy[k] - C0) / cs) | 0));
        const c = cj * CG + ci;
        const bite = Math.min(g[c], 0.9 * dt);
        g[c] -= bite;
        if (g[c] < 0.3) {
          // здесь выедено — к самой зелёной соседней клетке
          let best = -1, bx = 0, by = 0;
          for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
            const ii = ci + di, jj = cj + dj;
            if (ii < 0 || jj < 0 || ii >= CG || jj >= CG || (!di && !dj)) continue;
            const v = g[jj * CG + ii] + rng() * 0.05;
            if (v > best) { best = v; bx = C0 + (ii + 0.5) * cs; by = C0 + (jj + 0.5) * cs; }
          }
          if (best > g[c] + 0.05) s.sh[k] = Math.atan2(by - s.sy[k], bx - s.sx[k]) + gauss(rng) * 0.3;
          else s.sh[k] += gauss(rng) * 2 * dt;
        } else s.sh[k] += gauss(rng) * 1.2 * dt;
        const sp = g[c] < 0.3 ? V : V * 0.25;
        let x = s.sx[k] + Math.cos(s.sh[k]) * sp * dt, y = s.sy[k] + Math.sin(s.sh[k]) * sp * dt;
        if (x < lo || x > hi) { s.sh[k] = Math.PI - s.sh[k]; x = Math.min(hi, Math.max(lo, x)); }
        if (y < lo || y > hi) { s.sh[k] = -s.sh[k]; y = Math.min(hi, Math.max(lo, y)); }
        s.sx[k] = x; s.sy[k] = y;
      }
    },
    draw(ctx, s) {
      const cs = (C1 - C0) / CG, gap = 0.035;
      ctx.beginPath();
      // ограда с четырьмя калитками
      const side = (x0, y0, x1, y1) => {
        const mx = (x0 + x1) / 2, my = (y0 + y1) / 2, ux = x1 > x0 ? gap : 0, uy = y1 > y0 ? gap : 0;
        ctx.moveTo(x0, y0); ctx.lineTo(mx - ux, my - uy);
        ctx.moveTo(mx + ux, my + uy); ctx.lineTo(x1, y1);
      };
      side(C0, C0, C1, C0); side(C1, C0, C1, C1); side(C0, C1, C1, C1); side(C0, C0, C0, C1);
      // трава: по два стебля в клетке, высота — запас
      for (let j = 0; j < CG; j++) for (let i = 0; i < CG; i++) {
        const v = s.g[j * CG + i];
        if (v < 0.08) continue;
        // пучок из трёх стеблей от одного корня
        const h = ((i * 7 + j * 13) % 5) / 5 - 0.4;
        const cx = C0 + (i + 0.5) * cs + h * 0.012, by = C0 + (j + 0.5) * cs + 0.012, L = 0.03 * v;
        ctx.moveTo(cx, by); ctx.lineTo(cx + L * h * 0.3, by - L);
        ctx.moveTo(cx, by); ctx.lineTo(cx - L * 0.45, by - L * 0.7);
        ctx.moveTo(cx, by); ctx.lineTo(cx + L * 0.45, by - L * 0.7);
      }
      for (const [hx, hy] of HERD) ringPath(ctx, hx, hy, 0.014);
      ctx.stroke();
      dots(ctx, s.sx, s.sy, 0.0065);
    },
  },
};

// ——— помощники дополнительных режимов ———
const mod = (a, m) => ((a % m) + m) % m;

function dashed(ctx, fn) {
  ctx.save();
  ctx.setLineDash(DASH);
  fn();
  ctx.setLineDash([]);
  ctx.restore();
}

// добавляют фигуру в текущий путь
function ringPath(ctx, x, y, r) { ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, TAU); }
function crossPath(ctx, x, y, r, diag) {
  if (diag) {
    ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r);
    ctx.moveTo(x - r, y + r); ctx.lineTo(x + r, y - r);
  } else {
    ctx.moveTo(x - r, y); ctx.lineTo(x + r, y);
    ctx.moveTo(x, y - r); ctx.lineTo(x, y + r);
  }
}

// ДОА: частицы коралла в сетке-хеше, блуждающие стартуют с окружности чуть шире коралла
const dlaR = (s) => Math.min(s.rmax + 0.05, 0.44);
function dlaAdd(s, x, y, parent) {
  const i = s.n++;
  s.px[i] = x; s.py[i] = y; s.par[i] = parent;
  const c = ((y / s.A) | 0) * s.G + ((x / s.A) | 0);
  s.next[i] = s.head[c]; s.head[c] = i;
  s.rmax = Math.max(s.rmax, Math.hypot(x - 0.5, y - 0.5));
}
function dlaLaunch(s, i) {
  const a = s.rng() * TAU, r = dlaR(s);
  s.wx[i] = 0.5 + Math.cos(a) * r; s.wy[i] = 0.5 + Math.sin(a) * r;
}

// богатство: гистограмма по WB корзинам на [0, WM) и плавный масштаб высоты
const WB = 15, WM = 6;
function wealthHist(s, k) {
  s.bins.fill(0);
  for (let i = 0; i < s.n; i++) s.bins[Math.min(WB - 1, ((s.m[i] / WM) * WB) | 0)]++;
  const target = 0.3 / Math.max(...s.bins, s.n * (1 - Math.exp(-WM / WB)));
  s.sc = s.sc ? s.sc + (target - s.sc) * k : target;
}

// храповик: камера с лопастями слева, колесо с собачкой справа, общий вал
const RL = [0.08, 0.14, 0.44, 0.58], RR = [0.56, 0.14, 0.92, 0.58];
const VC = [0.26, 0.36], VR = 0.15, NP = 4;
const GC = [0.74, 0.36], GR = 0.085, GT = 0.115, NT = 12;
const PC = -Math.PI / 2, PV = [0.88, 0.21];
const LIFT = 0.7, KAP = 0.12, HN = 300;

// общий луг: CG×CG клеток травы, четыре пастуха у калиток
const CG = 12, C0 = 0.14, C1 = 0.86;
const HERD = [[0.5, 0.075], [0.925, 0.5], [0.5, 0.925], [0.075, 0.5]];

export default {
  id: 'particles',
  create(p, rng) {
    const mode = p.mode || 'entropy';
    return { mode, ...MODES[mode].create(p, rng) };
  },
  step(s, dt) { MODES[s.mode].step(s, dt); },
  draw(ctx, s) { MODES[s.mode].draw(ctx, s); },
};

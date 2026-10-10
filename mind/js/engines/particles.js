// 4. Частицы: энтропия, броуновское движение, демон Максвелла, стая, доска Гальтона, стигмергия
import { dots, circle, line, poly, star, contours, segments, TAU, DASH } from '../core/draw.js';
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
      star(ctx, s.bx, s.by, s.R * 0.4);
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
      star(ctx, 0.5, 0.5, 0.018);
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
      ctx.beginPath();
      for (let i = 0; i < s.n; i++) {
        const v = Math.hypot(s.vx[i], s.vy[i]) || 1;
        const ux = s.vx[i] / v, uy = s.vy[i] / v, L = 0.016;
        ctx.moveTo(s.x[i] - ux * L - uy * L * 0.5, s.y[i] - uy * L + ux * L * 0.5);
        ctx.lineTo(s.x[i], s.y[i]);
        ctx.lineTo(s.x[i] - ux * L + uy * L * 0.5, s.y[i] - uy * L - ux * L * 0.5);
      }
      ctx.stroke();
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
};

export default {
  id: 'particles',
  create(p, rng) {
    const mode = p.mode || 'entropy';
    return { mode, ...MODES[mode].create(p, rng) };
  },
  step(s, dt) { MODES[s.mode].step(s, dt); },
  draw(ctx, s) { MODES[s.mode].draw(ctx, s); },
};

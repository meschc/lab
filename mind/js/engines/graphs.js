// 7. Графы и сети
import { circle, line, star, dots, text, FONTS, TAU, DASH } from '../core/draw.js';

function rings(ctx, x, y, r, n, gap) {
  for (let k = 0; k < n; k++) circle(ctx, x, y, r - k * gap);
}

function arrow(ctx, x1, y1, x2, y2, r1, r2) {
  const d = Math.hypot(x2 - x1, y2 - y1) || 1, ux = (x2 - x1) / d, uy = (y2 - y1) / d;
  const ax = x1 + ux * r1, ay = y1 + uy * r1, bx = x2 - ux * r2, by = y2 - uy * r2;
  ctx.beginPath();
  ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
  const h = 0.014;
  ctx.moveTo(bx - ux * h - uy * h * 0.5, by - uy * h + ux * h * 0.5);
  ctx.lineTo(bx, by);
  ctx.lineTo(bx - ux * h + uy * h * 0.5, by - uy * h - ux * h * 0.5);
  ctx.stroke();
}

// силовая раскладка в квадрате
function relax(pos, edges, iters, k = 0.18) {
  const n = pos.length / 2;
  for (let it = 0; it < iters; it++) {
    const fx = new Float32Array(n), fy = new Float32Array(n);
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const dx = pos[i * 2] - pos[j * 2], dy = pos[i * 2 + 1] - pos[j * 2 + 1];
      const d2 = dx * dx + dy * dy + 1e-4, f = (k * k) / d2 * 0.02;
      fx[i] += dx * f; fy[i] += dy * f; fx[j] -= dx * f; fy[j] -= dy * f;
    }
    for (const [a, b] of edges) {
      const dx = pos[b * 2] - pos[a * 2], dy = pos[b * 2 + 1] - pos[a * 2 + 1];
      const d = Math.hypot(dx, dy) || 1e-3, f = (d - k * 0.6) * 0.1;
      fx[a] += (dx / d) * f; fy[a] += (dy / d) * f; fx[b] -= (dx / d) * f; fy[b] -= (dy / d) * f;
    }
    for (let i = 0; i < n; i++) {
      fx[i] += (0.5 - pos[i * 2]) * 0.01; fy[i] += (0.5 - pos[i * 2 + 1]) * 0.01;
      pos[i * 2] += Math.max(-0.02, Math.min(0.02, fx[i]));
      pos[i * 2 + 1] += Math.max(-0.02, Math.min(0.02, fy[i]));
    }
  }
}

// вписать облако точек в квадрат [m, 1-m]
function fit(pos, m = 0.12) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < pos.length; i += 2) {
    x0 = Math.min(x0, pos[i]); x1 = Math.max(x1, pos[i]); y0 = Math.min(y0, pos[i + 1]); y1 = Math.max(y1, pos[i + 1]);
  }
  const s = (1 - 2 * m) / Math.max(x1 - x0, y1 - y0, 0.2);
  const ox = 0.5 - ((x1 - x0) * s) / 2, oy = 0.5 - ((y1 - y0) * s) / 2;
  return (i) => [ox + (pos[i * 2] - x0) * s, oy + (pos[i * 2 + 1] - y0) * s];
}

const MODES = {
  // Уоттс — Строгац: кольцо соседей, рёбра по одному перекидываются в случайные узлы
  smallworld: {
    create(p, rng) {
      const N = 30, edges = [];
      for (let i = 0; i < N; i++) for (let k = 1; k <= 2; k++) edges.push([i, (i + k) % N, false]);
      return { rng, N, edges, acc: 0, done: 0 };
    },
    step(s, dt) {
      s.acc += dt;
      if (s.acc < 0.55) return;
      s.acc = 0;
      if (s.done >= 14) {
        if (s.done++ > 22) Object.assign(s, MODES.smallworld.create({}, s.rng));
        return;
      }
      const cand = s.edges.filter((e) => !e[2]);
      const e = cand[Math.floor(s.rng() * cand.length)];
      let b;
      do b = Math.floor(s.rng() * s.N); while (b === e[0] || s.edges.some((f) => (f[0] === e[0] && f[1] === b) || (f[1] === e[0] && f[0] === b)));
      e[1] = b; e[2] = true; s.done++;
    },
    draw(ctx, s) {
      const P = (i) => [0.5 + 0.42 * Math.cos((i / s.N) * TAU - Math.PI / 2), 0.5 + 0.42 * Math.sin((i / s.N) * TAU - Math.PI / 2)];
      ctx.beginPath();
      for (const [a, b] of s.edges) { const A = P(a), B = P(b); ctx.moveTo(...A); ctx.lineTo(...B); }
      ctx.stroke();
      ctx.fillStyle = ctx.strokeStyle;
      for (let i = 0; i < s.N; i++) {
        const [x, y] = P(i);
        ctx.save(); ctx.fillStyle = s.paper; ctx.beginPath(); ctx.arc(x, y, 0.014, 0, TAU); ctx.fill(); ctx.restore();
        circle(ctx, x, y, 0.014);
      }
    },
  },

  // Кёнигсберг: 4 берега, 7 мостов — обойти по разу нельзя
  konigsberg: {
    create(p, rng) {
      const V = [[0.5, 0.15], [0.5, 0.85], [0.34, 0.5], [0.8, 0.5]];
      const E = [[0, 2, -0.09], [0, 2, 0.09], [2, 1, -0.09], [2, 1, 0.09], [0, 3, 0], [1, 3, 0], [2, 3, 0]];
      return { rng, V, E, used: new Array(7).fill(false), at: Math.floor(rng() * 4), edge: -1, t: 0, stuck: 0 };
    },
    ctrl(s, i) {
      const [a, b, o] = s.E[i], [ax, ay] = s.V[a], [bx, by] = s.V[b];
      const mx = (ax + bx) / 2, my = (ay + by) / 2, dx = bx - ax, dy = by - ay, d = Math.hypot(dx, dy);
      return [ax, ay, mx - (dy / d) * o * 1.6, my + (dx / d) * o * 1.6, bx, by];
    },
    step(s, dt) {
      if (s.stuck) {
        if ((s.stuck += dt) > 2.2) Object.assign(s, MODES.konigsberg.create({}, s.rng));
        return;
      }
      if (s.edge < 0) {
        const opts = s.E.map((e, i) => i).filter((i) => !s.used[i] && (s.E[i][0] === s.at || s.E[i][1] === s.at));
        if (!opts.length) { s.stuck = 1e-3; return; }
        s.edge = opts[Math.floor(s.rng() * opts.length)];
        s.from = s.at;
        s.t = 0;
      }
      s.t += dt / 0.9;
      if (s.t >= 1) {
        s.used[s.edge] = true;
        const [a, b] = s.E[s.edge];
        s.at = a === s.from ? b : a;
        s.edge = -1;
      }
    },
    draw(ctx, s) {
      ctx.save();
      ctx.setLineDash(DASH);
      ctx.beginPath();
      ctx.moveTo(0.02, 0.36); ctx.bezierCurveTo(0.3, 0.3, 0.6, 0.42, 0.98, 0.36);
      ctx.moveTo(0.02, 0.64); ctx.bezierCurveTo(0.3, 0.7, 0.6, 0.58, 0.98, 0.64);
      ctx.stroke();
      ctx.restore();
      s.E.forEach((e, i) => {
        const [ax, ay, cx, cy, bx, by] = this.ctrl(s, i);
        ctx.save();
        if (s.used[i]) ctx.lineWidth *= 3;
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.quadraticCurveTo(cx, cy, bx, by); ctx.stroke();
        ctx.restore();
      });
      s.V.forEach(([x, y]) => {
        ctx.save(); ctx.fillStyle = s.paper; ctx.beginPath(); ctx.arc(x, y, 0.05, 0, TAU); ctx.fill(); ctx.restore();
        rings(ctx, x, y, 0.05, 3, 0.015);
      });
      let px, py;
      if (s.edge >= 0) {
        const [ax, ay, cx, cy, bx, by] = this.ctrl(s, s.edge);
        const t = s.E[s.edge][0] === s.from ? s.t : 1 - s.t;
        px = (1 - t) ** 2 * ax + 2 * (1 - t) * t * cx + t * t * bx;
        py = (1 - t) ** 2 * ay + 2 * (1 - t) * t * cy + t * t * by;
      } else [px, py] = s.V[s.at];
      star(ctx, px, py, s.stuck ? 0.02 + 0.006 * Math.sin(s.stuck * 12) : 0.018);
    },
  },

  // PageRank: вес узла перетекает по ссылкам, итерация за итерацией
  pagerank: {
    create(p, rng) {
      const N = 12, edges = [];
      for (let i = 0; i < N; i++) {
        const k = 1 + Math.floor(rng() * 3);
        for (let j = 0; j < k; j++) {
          const t = rng() < 0.45 ? Math.floor(rng() * 3) : Math.floor(rng() * N);
          if (t !== i && !edges.some(([a, b]) => a === i && b === t)) edges.push([i, t]);
        }
      }
      const pos = new Float32Array(N * 2);
      for (let i = 0; i < N; i++) { pos[i * 2] = 0.5 + 0.3 * Math.cos((i / N) * TAU); pos[i * 2 + 1] = 0.5 + 0.3 * Math.sin((i / N) * TAU); }
      relax(pos, edges, 400, 0.3);
      const pr = new Float32Array(N).fill(1 / N);
      return { rng, N, edges, pos, pr, shown: Float32Array.from(pr), acc: 0, it: 0 };
    },
    step(s, dt) {
      s.acc += dt;
      if (s.acc > 0.7) {
        s.acc = 0;
        if (s.it++ > 26) { Object.assign(s, MODES.pagerank.create({}, s.rng)); return; }
        const out = new Array(s.N).fill(0);
        for (const [a] of s.edges) out[a]++;
        const next = new Float32Array(s.N).fill(0.15 / s.N);
        for (const [a, b] of s.edges) next[b] += (0.85 * s.pr[a]) / out[a];
        for (let i = 0; i < s.N; i++) if (!out[i]) for (let j = 0; j < s.N; j++) next[j] += (0.85 * s.pr[i]) / s.N;
        s.pr = next;
      }
      for (let i = 0; i < s.N; i++) s.shown[i] += (s.pr[i] - s.shown[i]) * Math.min(1, dt * 4);
    },
    draw(ctx, s) {
      const P = fit(s.pos, 0.14);
      const R = (i) => 0.014 + 0.12 * Math.sqrt(s.shown[i] / 1.2);
      for (const [a, b] of s.edges) arrow(ctx, ...P(a), ...P(b), R(a) + 0.006, R(b) + 0.006);
      for (let i = 0; i < s.N; i++) {
        const [x, y] = P(i);
        rings(ctx, x, y, R(i), 1 + Math.floor(s.shown[i] * s.N * 1.2), 0.008);
      }
    },
  },

  // платёжная матрица 2×2 и динамика лучших ответов до равновесия
  matrix: {
    create(p, rng) {
      const m = { rows: p.rows || ['молчать', 'предать'], cols: p.cols || p.rows || ['молчать', 'предать'], pay: p.pay || [[[3, 3], [0, 5]], [[5, 0], [1, 1]]] };
      return { ...m, rng, cell: [Math.floor(rng() * 2), Math.floor(rng() * 2)], prev: null, turn: 0, acc: 0, hold: 0, t: 0 };
    },
    isNash(s, [i, j]) {
      return s.pay[i][j][0] >= s.pay[1 - i][j][0] && s.pay[i][j][1] >= s.pay[i][1 - j][1];
    },
    step(s, dt) {
      s.t += dt;
      s.acc += dt;
      if (s.acc < 1.1) return;
      s.acc = 0;
      if (this.isNash(s, s.cell)) {
        if ((s.hold += 1) > 3) { s.hold = 0; s.prev = null; s.cell = [Math.floor(s.rng() * 2), Math.floor(s.rng() * 2)]; }
        return;
      }
      const [i, j] = s.cell;
      s.prev = [i, j];
      if (s.turn++ % 2 === 0) s.cell = [s.pay[0][j][0] >= s.pay[1][j][0] ? 0 : 1, j];
      else s.cell = [i, s.pay[i][0][1] >= s.pay[i][1][1] ? 0 : 1];
    },
    draw(ctx, s) {
      const X0 = 0.24, Y0 = 0.24, C = 0.33;
      ctx.beginPath();
      for (let k = 0; k <= 2; k++) {
        ctx.moveTo(X0 + k * C, Y0); ctx.lineTo(X0 + k * C, Y0 + 2 * C);
        ctx.moveTo(X0, Y0 + k * C); ctx.lineTo(X0 + 2 * C, Y0 + k * C);
      }
      ctx.stroke();
      ctx.fillStyle = ctx.strokeStyle;
      for (let k = 0; k < 2; k++) {
        text(ctx, s.cols[k], X0 + (k + 0.5) * C, Y0 - 0.04, 0.032, { family: FONTS.text });
        ctx.save();
        ctx.translate(X0 - 0.04, Y0 + (k + 0.5) * C);
        ctx.rotate(-Math.PI / 2);
        text(ctx, s.rows[k], 0, 0, 0.032, { family: FONTS.text });
        ctx.restore();
      }
      for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
        const cx = X0 + (j + 0.5) * C, cy = Y0 + (i + 0.5) * C;
        text(ctx, `${s.pay[i][j][0]} · ${s.pay[i][j][1]}`, cx, cy, 0.06, { family: FONTS.display });
        if (this.isNash(s, [i, j]) && this.isNash(s, s.cell) && s.cell[0] === i && s.cell[1] === j) {
          for (let k = 1; k <= 3; k++) { const m = 0.012 * k; ctx.strokeRect(cx - C / 2 + m, cy - C / 2 + m, C - 2 * m, C - 2 * m); }
        }
      }
      const [i, j] = s.cell;
      const cx = X0 + (j + 0.5) * C, cy = Y0 + (i + 0.5) * C + 0.075;
      if (s.prev) {
        const px = X0 + (s.prev[1] + 0.5) * C, py = Y0 + (s.prev[0] + 0.5) * C + 0.075;
        ctx.save(); ctx.setLineDash([0.008, 0.008]); line(ctx, px, py, cx, cy); ctx.restore();
      }
      star(ctx, cx, cy, 0.02);
    },
  },

  // предпочтительное присоединение: богатые узлы богатеют
  preferential: {
    create(p, rng) {
      const pos = [0.5, 0.45, 0.45, 0.55, 0.55, 0.55];
      return { rng, pos, edges: [[0, 1], [1, 2], [2, 0]], deg: [2, 2, 2], acc: 0, hold: 0 };
    },
    step(s, dt) {
      s.acc += dt;
      const n = s.deg.length;
      if (n < 90 && s.acc > 0.3) {
        s.acc = 0;
        const total = s.deg.reduce((a, b) => a + b, 0);
        const pickOne = () => { let r = s.rng() * total; for (let i = 0; i < n; i++) if ((r -= s.deg[i]) < 0) return i; return n - 1; };
        const targets = new Set([pickOne()]);
        if (s.rng() < 0.3) targets.add(pickOne());
        const t0 = [...targets][0];
        s.pos.push(s.pos[t0 * 2] + (s.rng() - 0.5) * 0.05, s.pos[t0 * 2 + 1] + (s.rng() - 0.5) * 0.05);
        s.deg.push(0);
        for (const t of targets) { s.edges.push([n, t]); s.deg[t]++; s.deg[n]++; }
      } else if (n >= 90 && (s.hold += dt) > 4) Object.assign(s, MODES.preferential.create({}, s.rng));
      relax(s.pos, s.edges, 2, 0.12);
    },
    draw(ctx, s) {
      const P = fit(s.pos, 0.1);
      ctx.beginPath();
      for (const [a, b] of s.edges) { ctx.moveTo(...P(a)); ctx.lineTo(...P(b)); }
      ctx.stroke();
      s.deg.forEach((d, i) => {
        const [x, y] = P(i), r = 0.006 + 0.0045 * Math.sqrt(d) * 2;
        ctx.save(); ctx.fillStyle = s.paper; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); ctx.restore();
        rings(ctx, x, y, r, d > 8 ? 3 : d > 4 ? 2 : 1, 0.007);
      });
    },
  },

  // круги Данбара: 5 · 15 · 50 · 150
  dunbar: {
    create() { return { t: 0 }; },
    step(s, dt) { s.t += dt; },
    draw(ctx, s) {
      const R = [0.08, 0.17, 0.29, 0.44], C = [5, 15, 50, 150], V = [0.25, 0.12, 0.06, 0.03];
      ctx.save(); ctx.setLineDash(DASH); R.forEach((r) => circle(ctx, 0.5, 0.5, r)); ctx.restore();
      R.forEach((r, k) => {
        const xs = [], ys = [];
        for (let i = 0; i < C[k]; i++) {
          const a = (i / C[k]) * TAU + s.t * V[k] * (k % 2 ? -1 : 1);
          xs.push(0.5 + r * Math.cos(a)); ys.push(0.5 + r * Math.sin(a));
          if (k === 0) line(ctx, 0.5, 0.5, xs[i], ys[i]);
        }
        if (k < 2) {
          ctx.save(); ctx.fillStyle = s.paper; dots(ctx, xs, ys, k ? 0.012 : 0.02); ctx.restore();
          dots(ctx, xs, ys, k ? 0.012 : 0.02, xs.length, 'stroke');
        } else dots(ctx, xs, ys, k === 2 ? 0.006 : 0.004);
      });
    },
  },

  // коммивояжёр: случайный маршрут распутывается ходами 2-opt
  tsp: {
    create(p, rng) {
      const N = 34, P = [];
      for (let i = 0; i < N; i++) P.push([0.08 + rng() * 0.84, 0.08 + rng() * 0.84]);
      const tour = P.map((_, i) => i).sort(() => rng() - 0.5);
      return { rng, P, tour, acc: 0, hold: 0 };
    },
    step(s, dt) {
      s.acc += dt;
      if (s.acc < 0.09) return;
      s.acc = 0;
      const { P, tour } = s, n = tour.length;
      const D = (a, b) => Math.hypot(P[a][0] - P[b][0], P[a][1] - P[b][1]);
      const start = Math.floor(s.rng() * n);
      for (let ii = 0; ii < n; ii++) {
        const i = (start + ii) % n;
        for (let j = i + 2; j < n; j++) {
          const a = tour[i], b = tour[(i + 1) % n], c = tour[j], d = tour[(j + 1) % n];
          if (a === d) continue;
          if (D(a, c) + D(b, d) < D(a, b) + D(c, d) - 1e-9) {
            const seg = tour.slice(i + 1, j + 1).reverse();
            tour.splice(i + 1, seg.length, ...seg);
            return;
          }
        }
      }
      if ((s.hold += 0.09) > 3) Object.assign(s, MODES.tsp.create({}, s.rng));
    },
    draw(ctx, s) {
      ctx.beginPath();
      s.tour.forEach((k, i) => (i ? ctx.lineTo(...s.P[k]) : ctx.moveTo(...s.P[k])));
      ctx.closePath();
      ctx.stroke();
      const xs = s.P.map((p) => p[0]), ys = s.P.map((p) => p[1]);
      dots(ctx, xs, ys, 0.008);
      star(ctx, ...s.P[s.tour[0]], 0.018);
    },
  },
};

export default {
  id: 'graphs',
  create(p, rng) {
    const mode = p.mode || 'smallworld';
    return { mode, ...MODES[mode].create(p, rng) };
  },
  step(s, dt) { MODES[s.mode].step(s, dt); },
  draw(ctx, s, env) {
    s.paper = env.paper;
    MODES[s.mode].draw(ctx, s);
  },
};

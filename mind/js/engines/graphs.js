// 7. Графы и сети
import { circle, line, dot, dots, segments, text, FONTS, TAU, DASH, ease } from '../core/draw.js';

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

// ——— помощники для новых режимов ———

// кружок, залитый бумагой (чтобы линии под ним не просвечивали)
function blank(ctx, s, x, y, r) {
  ctx.save(); ctx.fillStyle = s.paper; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); ctx.restore();
}

// наконечник стрелки в точке (x, y), направление (ux, uy)
function head(ctx, x, y, ux, uy, h) {
  ctx.beginPath();
  ctx.moveTo(x - ux * h - uy * h * 0.55, y - uy * h + ux * h * 0.55);
  ctx.lineTo(x, y);
  ctx.lineTo(x - ux * h + uy * h * 0.55, y - uy * h - ux * h * 0.55);
  ctx.stroke();
}

// прямоугольник, залитый бумагой
function blank0(ctx, s, x, y, w, h) {
  ctx.save(); ctx.fillStyle = s.paper; ctx.fillRect(x, y, w, h); ctx.restore();
}

// отрезок, проведённый на долю u от (x1, y1) к (x2, y2)
function partial(ctx, x1, y1, x2, y2, u) {
  if (u <= 0) return;
  line(ctx, x1, y1, x1 + (x2 - x1) * Math.min(1, u), y1 + (y2 - y1) * Math.min(1, u));
}

// отрезок между кружками радиусов r1 и r2
function trim(x1, y1, x2, y2, r1, r2) {
  const d = Math.hypot(x2 - x1, y2 - y1) || 1, ux = (x2 - x1) / d, uy = (y2 - y1) / d;
  return [x1 + ux * r1, y1 + uy * r1, x2 - ux * r2, y2 - uy * r2];
}

function shuffle(rng, a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// Сазерленд — Ходжман для полуплоскости n·p ≤ c; у вершины [x, y, метка ребра, идущего из неё]
function clipHalf(poly, nx, ny, c, label) {
  const out = [];
  for (let k = 0; k < poly.length; k++) {
    const P = poly[k], Q = poly[(k + 1) % poly.length];
    const dp = nx * P[0] + ny * P[1] - c, dq = nx * Q[0] + ny * Q[1] - c;
    if (dp <= 0) out.push(P);
    if ((dp <= 0) !== (dq <= 0)) {
      const t = dp / (dp - dq);
      out.push([P[0] + (Q[0] - P[0]) * t, P[1] + (Q[1] - P[1]) * t, dp <= 0 ? label : P[2]]);
    }
  }
  return out;
}

function centroid(poly) {
  let a = 0, cx = 0, cy = 0;
  for (let k = 0; k < poly.length; k++) {
    const [x0, y0] = poly[k], [x1, y1] = poly[(k + 1) % poly.length], c = x0 * y1 - x1 * y0;
    a += c; cx += (x0 + x1) * c; cy += (y0 + y1) * c;
  }
  return Math.abs(a) < 1e-12 ? poly[0].slice(0, 2) : [cx / (3 * a), cy / (3 * a)];
}

// ячейки Вороного внутри многоугольника-границы
function voronoi(sites, border) {
  return sites.map(([x, y], i) => {
    let poly = border;
    sites.forEach(([u, v], j) => {
      if (j === i) return;
      const nx = u - x, ny = v - y;
      poly = clipHalf(poly, nx, ny, nx * (x + u) / 2 + ny * (y + v) / 2, j);
    });
    return poly;
  });
}

// внутренние нормали выпуклого многоугольника: [px, py, nx, ny]
function inwardEdges(poly) {
  const [cx, cy] = centroid(poly);
  return poly.map((P, k) => {
    const Q = poly[(k + 1) % poly.length];
    let nx = -(Q[1] - P[1]), ny = Q[0] - P[0];
    const d = Math.hypot(nx, ny) || 1;
    nx /= d; ny /= d;
    if (nx * (cx - P[0]) + ny * (cy - P[1]) < 0) { nx = -nx; ny = -ny; }
    return [P[0], P[1], nx, ny];
  });
}

// отсечение прямой A + tD выпуклым многоугольником (с отступом inset)
function clipLine(edges, ax, ay, dx, dy, inset, out) {
  let t0 = -Infinity, t1 = Infinity;
  for (const [px, py, nx, ny] of edges) {
    const num = nx * (ax - px) + ny * (ay - py) - inset, den = nx * dx + ny * dy;
    if (Math.abs(den) < 1e-12) { if (num < 0) return; continue; }
    const t = -num / den;
    if (den > 0) t0 = Math.max(t0, t); else t1 = Math.min(t1, t);
    if (t0 >= t1) return;
  }
  out.push(ax + dx * t0, ay + dy * t0, ax + dx * t1, ay + dy * t1);
}

function insideBy(edges, x, y, inset) {
  for (const [px, py, nx, ny] of edges) if (nx * (x - px) + ny * (y - py) < inset) return false;
  return true;
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
      dot(ctx, px, py, s.stuck ? 0.007 + 0.002 * Math.sin(s.stuck * 12) : 0.007);
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
      dot(ctx, cx, cy, 0.007);
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
      dot(ctx, ...s.P[s.tour[0]], 0.007);
    },
  },

  // четыре краски: карта Вороного раскрашивается перебором с возвратами
  fourcolor: {
    create(p, rng) {
      const C = 0.5, R = 0.42, border = [];
      for (let k = 0; k < 72; k++) { const a = (k / 72) * TAU; border.push([C + R * Math.cos(a), C + R * Math.sin(a), -1]); }
      const n = 13 + Math.floor(rng() * 4);
      let sites = [];
      while (sites.length < n) {
        const a = rng() * TAU, r = R * 0.92 * Math.sqrt(rng());
        sites.push([C + r * Math.cos(a), C + r * Math.sin(a)]);
      }
      let cells;
      for (let it = 0; it < 4; it++) { cells = voronoi(sites, border); sites = cells.map(centroid); }
      cells = voronoi(sites, border);
      const adj = cells.map((poly, i) => {
        const set = new Set();
        poly.forEach((P, k) => {
          const Q = poly[(k + 1) % poly.length];
          if (P[2] >= 0 && Math.hypot(Q[0] - P[0], Q[1] - P[1]) > 0.008) set.add(P[2]);
        });
        return set;
      });
      adj.forEach((set, i) => set.forEach((j) => adj[j].add(i)));
      // узоры-«краски»: 0 — пусто, 1 — точки, 2 — штриховка, 3 — мелкая сетка
      const pats = cells.map((poly) => {
        const E = inwardEdges(poly), dx = [], dy = [], hatch = [], grid = [];
        for (let j = 0; j * 0.021 < 1; j++) for (let i = 0; i * 0.024 < 1; i++) {
          const x = i * 0.024 + (j % 2) * 0.012, y = j * 0.021;
          if (insideBy(E, x, y, 0.009)) { dx.push(x); dy.push(y); }
        }
        for (let c = -1; c < 1; c += 0.019) clipLine(E, c, 0, 1, 1, 0.004, hatch);
        for (let c = 0; c < 1; c += 0.017) { clipLine(E, 0, c, 1, 0, 0.004, grid); clipLine(E, c, 0, 0, 1, 0.004, grid); }
        return { dx, dy, hatch, grid };
      });
      // обход от центра; порядок красок подбираем так, чтобы были возвраты, но немного
      const order = sites.map((_, i) => i).sort((a, b) => Math.hypot(sites[a][0] - C, sites[a][1] - C) - Math.hypot(sites[b][0] - C, sites[b][1] - C));
      let events = null;
      for (let tries = 0; tries < 40; tries++) {
        const perm = sites.map(() => shuffle(rng, [0, 1, 2, 3]));
        const col = new Array(n).fill(-1), ev = [];
        let back = 0;
        const go = (k) => {
          if (k === n) return true;
          const i = order[k];
          for (const c of perm[i]) {
            if ([...adj[i]].some((j) => col[j] === c)) continue;
            col[i] = c; ev.push([i, c]);
            if (go(k + 1) || ev.length > 400) return true;
            col[i] = -1; ev.push([i, -1]); back++;
          }
          return false;
        };
        go(0);
        events = ev;
        if (back >= 2 && back <= 10) break;
      }
      return { rng, sites, cells, pats, events, k: 0, acc: 0, hold: 0, col: new Array(n).fill(-1) };
    },
    step(s, dt) {
      s.acc += dt;
      while (s.k < s.events.length && s.acc > 0.26) {
        s.acc -= 0.26;
        const [i, c] = s.events[s.k++];
        s.col[i] = c;
      }
      if (s.k >= s.events.length && (s.hold += dt) > 3.5) Object.assign(s, MODES.fourcolor.create({}, s.rng));
    },
    draw(ctx, s) {
      ctx.beginPath();
      for (const poly of s.cells) {
        poly.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.closePath();
      }
      ctx.stroke();
      const segs = [];
      s.cells.forEach((poly, i) => {
        const c = s.col[i], P = s.pats[i];
        if (c === 1) dots(ctx, P.dx, P.dy, 0.0032);
        else if (c === 2) segs.push(P.hatch);
        else if (c === 3) segs.push(P.grid);
      });
      ctx.beginPath();
      for (const a of segs) for (let k = 0; k < a.length; k += 4) { ctx.moveTo(a[k], a[k + 1]); ctx.lineTo(a[k + 2], a[k + 3]); }
      ctx.stroke();
      // ещё не раскрашенные области — пустой кружок в центре; текущая — точка
      const last = s.k > 0 && s.k < s.events.length ? s.events[s.k - 1] : null;
      s.sites.forEach(([x, y], i) => {
        if (s.col[i] >= 0) return;
        blank(ctx, s, x, y, 0.009);
        circle(ctx, x, y, 0.009);
      });
      if (last) {
        const [x, y] = s.sites[last[0]];
        blank(ctx, s, x, y, 0.012);
        if (last[1] < 0) { ctx.save(); ctx.setLineDash(DASH); circle(ctx, x, y, 0.016); ctx.restore(); circle(ctx, x, y, 0.009); }
        else dot(ctx, x, y, 0.008);
      }
    },
  },

  // парадокс дружбы: у друзей в среднем больше друзей, чем у тебя
  friendship: {
    create(p, rng) {
      const N = 18, edges = [[0, 1]], deg = [1, 1];
      for (let i = 2; i < N; i++) {
        deg.push(0);
        const pickOne = () => {
          let tot = 0; for (let j = 0; j < i; j++) tot += deg[j];
          let r = rng() * tot; for (let j = 0; j < i; j++) if ((r -= deg[j]) < 0) return j; return i - 1;
        };
        const a = pickOne();
        edges.push([i, a]); deg[a]++; deg[i]++;
        if (rng() < 0.28) { const b = pickOne(); if (b !== a) { edges.push([i, b]); deg[b]++; deg[i]++; } }
      }
      const pos = new Float32Array(N * 2);
      for (let i = 0; i < N * 2; i++) pos[i] = 0.3 + rng() * 0.4;
      relax(pos, edges, 500, 0.3);
      const F = fit(pos, 0.13), xy = Array.from({ length: N }, (_, i) => F(i));
      const nb = Array.from({ length: N }, () => []);
      for (const [a, b] of edges) { nb[a].push(b); nb[b].push(a); }
      const low = shuffle(rng, deg.map((d, i) => i).filter((i) => deg[i] <= 2 && nb[i].some((j) => deg[j] > deg[i])));
      return { rng, N, edges, deg, xy, nb, focus: low.slice(0, 5), f: 0, t: 0 };
    },
    R(d) { return 0.007 + 0.0135 * Math.sqrt(d); },
    step(s, dt) {
      s.t += dt;
      if (s.t > 2.6) { s.t = 0; if (++s.f >= s.focus.length) Object.assign(s, MODES.friendship.create({}, s.rng)); }
    },
    draw(ctx, s) {
      const R = this.R, me = s.focus[s.f], fr = new Set(me == null ? [] : s.nb[me]);
      ctx.beginPath();
      for (const [a, b] of s.edges) {
        if (a === me || b === me) continue;
        const [x1, y1, x2, y2] = trim(...s.xy[a], ...s.xy[b], R(s.deg[a]), R(s.deg[b]));
        ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
      }
      ctx.stroke();
      if (me != null) {
        ctx.save(); ctx.lineWidth *= 2;
        const u = ease(Math.min(1, s.t / 0.6));
        for (const j of fr) {
          const [x1, y1, x2, y2] = trim(...s.xy[me], ...s.xy[j], R(s.deg[me]), R(s.deg[j]) + 0.009);
          partial(ctx, x1, y1, x2, y2, u);
        }
        ctx.restore();
      }
      s.xy.forEach(([x, y], i) => {
        const r = R(s.deg[i]);
        blank(ctx, s, x, y, r);
        rings(ctx, x, y, r, s.deg[i] > 6 ? 3 : s.deg[i] > 3 ? 2 : 1, 0.0065);
        if (fr.has(i)) circle(ctx, x, y, r + 0.009);
      });
      if (me != null) {
        const [x, y] = s.xy[me];
        const mean = [...fr].reduce((a, j) => a + s.deg[j], 0) / fr.size;
        const g = ease(Math.min(1, Math.max(0, (s.t - 0.5) / 0.9)));
        const r0 = R(s.deg[me]);
        ctx.save(); ctx.setLineDash(DASH); circle(ctx, x, y, r0 + (R(mean) + 0.012 - r0) * g); ctx.restore();
        dot(ctx, x, y, 0.006);
      }
    },
  },

  // информационный каскад: каждый видит выбор предыдущих и идёт за толпой
  cascade: {
    create(p, rng) {
      const N = 11;
      let best = null;
      for (let tries = 0; tries < 30; tries++) {
        const truth = rng() < 0.5 ? 0 : 1, sig = [], ch = [];
        let d = 0, over = 0;
        for (let i = 0; i < N; i++) {
          const sg = rng() < 0.66 ? truth : 1 - truth;
          const c = d >= 2 ? 0 : d <= -2 ? 1 : sg;
          sig.push(sg); ch.push(c); d += c === 0 ? 1 : -1;
          if (c !== sg) over++;
        }
        best = { truth, sig, ch };
        if (over >= 1 && over <= 5) break;
      }
      return { rng, N, ...best, t: 0 };
    },
    step(s, dt) {
      s.t += dt;
      if (s.t > 0.5 + s.N * 0.7 + 3.2) Object.assign(s, MODES.cascade.create({}, s.rng), { t: 0 });
    },
    draw(ctx, s) {
      const DX = [0.31, 0.69], BASE = 0.4, TOPC = 0.27, W = 0.085, AY = 0.8;
      line(ctx, 0.12, BASE, 0.88, BASE);
      for (const x of DX) {
        ctx.beginPath(); ctx.moveTo(x - W, BASE); ctx.lineTo(x - W, TOPC); ctx.arc(x, TOPC, W, Math.PI, TAU); ctx.lineTo(x + W, BASE); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x - W + 0.018, BASE); ctx.lineTo(x - W + 0.018, TOPC); ctx.arc(x, TOPC, W - 0.018, Math.PI, TAU); ctx.lineTo(x + W - 0.018, BASE); ctx.stroke();
      }
      dot(ctx, DX[s.truth], TOPC + 0.02, 0.008);
      const AX = (i) => 0.1 + (i / (s.N - 1)) * 0.8;
      for (let i = 0; i < s.N; i++) {
        const x = AX(i), u = (s.t - 0.5 - i * 0.7) / 0.5;
        // частный сигнал — галочка под агентом в сторону «своей» двери
        const dir = s.sig[i] === 0 ? -1 : 1, cy = AY + 0.05;
        ctx.beginPath(); ctx.moveTo(x - dir * 0.008, cy - 0.011); ctx.lineTo(x + dir * 0.008, cy); ctx.lineTo(x - dir * 0.008, cy + 0.011); ctx.stroke();
        if (u > 0) {
          const tx = DX[s.ch[i]], ty = BASE;
          partial(ctx, x, AY - 0.012, tx, ty, ease(Math.min(1, u)));
        }
        if (u > 1 && s.ch[i] !== s.sig[i]) { blank(ctx, s, x, AY, 0.009); circle(ctx, x, AY, 0.009); }
        else if (u > 0) dot(ctx, x, AY, 0.008);
        else { blank(ctx, s, x, AY, 0.006); circle(ctx, x, AY, 0.006); }
      }
    },
  },

  // ханойская башня: рекурсивные перекладывания по аркам
  hanoi: {
    create(p, rng) {
      const n = 6;
      return { rng, n, pegs: [[5, 4, 3, 2, 1, 0], [], []], from: 0, moves: this.plan(n, 0, 2), k: 0, t: 0, hold: 0 };
    },
    plan(n, a, b) {
      const out = [], c = 3 - a - b;
      const go = (m, x, y, z) => { if (!m) return; go(m - 1, x, z, y); out.push([x, y]); go(m - 1, z, y, x); };
      go(n, a, b, c);
      return out;
    },
    X: [0.2, 0.5, 0.8], BASE: 0.78, H: 0.058, LIFT: 0.36, ARC: 0.1, DUR: 0.36,
    W(d) { return 0.09 + d * 0.037; },
    step(s, dt) {
      if (s.k >= s.moves.length) {
        if ((s.hold += dt) > 1.6) {
          const a = s.moves[s.moves.length - 1][1], b = (a + 1 + Math.floor(s.rng() * 2)) % 3;
          s.moves = this.plan(s.n, a, b); s.k = 0; s.t = 0; s.hold = 0;
        }
        return;
      }
      s.t += dt / this.DUR;
      while (s.t >= 1 && s.k < s.moves.length) {
        const [a, b] = s.moves[s.k++];
        s.pegs[b].push(s.pegs[a].pop());
        s.t -= 1;
      }
      if (s.k >= s.moves.length) s.t = 0;
    },
    draw(ctx, s) {
      const { X, BASE, H, LIFT, ARC } = this;
      line(ctx, 0.06, BASE, 0.94, BASE);
      for (const x of X) line(ctx, x, BASE, x, LIFT + 0.03);
      const disk = (d, cx, yb) => { const w = this.W(d); blank0(ctx, s, cx - w / 2, yb - H, w, H); ctx.strokeRect(cx - w / 2, yb - H, w, H); };
      const moving = s.k < s.moves.length ? s.moves[s.k] : null;
      s.pegs.forEach((stack, pi) => stack.forEach((d, h) => {
        if (moving && pi === moving[0] && h === stack.length - 1) return;
        disk(d, X[pi], BASE - h * H);
      }));
      if (!moving) return;
      const [a, b] = moving, d = s.pegs[a][s.pegs[a].length - 1];
      const y0 = BASE - (s.pegs[a].length - 1) * H, y1 = BASE - s.pegs[b].length * H;
      const l0 = y0 - LIFT, l2 = y1 - LIFT, l1 = ARC * Math.PI * 0.5 + Math.abs(X[b] - X[a]) * 0.5;
      const L = l0 + l1 + l2, u = ease(Math.min(1, s.t)) * L;
      let cx, cy;
      if (u < l0) { cx = X[a]; cy = y0 - u; }
      else if (u < l0 + l1) {
        const v = (u - l0) / l1;
        cx = X[a] + (X[b] - X[a]) * (1 - Math.cos(Math.PI * v)) / 2; cy = LIFT - ARC * Math.sin(Math.PI * v);
      } else { cx = X[b]; cy = LIFT + (u - l0 - l1); }
      // траектория — пунктирная арка
      ctx.save(); ctx.setLineDash(DASH);
      ctx.beginPath(); ctx.ellipse((X[a] + X[b]) / 2, LIFT - H / 2, Math.abs(X[b] - X[a]) / 2, ARC, 0, Math.PI, TAU); ctx.stroke();
      ctx.restore();
      disk(d, cx, cy);
      dot(ctx, cx, cy - H / 2, 0.006);
    },
  },

  // минимакс: оценки поднимаются от листьев к корню
  minimax: {
    create(p, rng) {
      const leaves = Array.from({ length: 8 }, () => 1 + Math.floor(rng() * 9));
      const val = [], best = [];
      // узлы уровня L: индексы 0..2^L-1; L=3 — листья
      for (let L = 0; L <= 3; L++) { val.push(new Array(1 << L).fill(null)); best.push(new Array(1 << L).fill(-1)); }
      val[3] = leaves.slice();
      const order = [];
      const post = (L, i) => { if (L === 3) return; post(L + 1, i * 2); post(L + 1, i * 2 + 1); order.push([L, i]); };
      post(0, 0);
      return { rng, leaves, val, best, order, k: 0, t: 0, done: 0 };
    },
    step(s, dt) {
      s.t += dt;
      if (s.k < s.order.length) {
        if (s.t > 0.6) {
          s.t = 0;
          const [L, i] = s.order[s.k++], a = s.val[L + 1][i * 2], b = s.val[L + 1][i * 2 + 1];
          const pickA = L % 2 === 0 ? a >= b : a <= b;
          s.val[L][i] = pickA ? a : b; s.best[L][i] = pickA ? i * 2 : i * 2 + 1;
        }
      } else if ((s.done += dt) > 4.6) Object.assign(s, MODES.minimax.create({}, s.rng));
    },
    pos(L, i) {
      const lx = (j) => 0.11 + (j / 7) * 0.78;
      const span = 1 << (3 - L);
      return [(lx(i * span) + lx(i * span + span - 1)) / 2, 0.15 + L * 0.225];
    },
    draw(ctx, s) {
      const r = 0.04, sq = 0.066;
      const path = new Set();
      if (s.done > 0) {
        let i = 0;
        for (let L = 0; L < 3 && s.done > L * 0.35; L++) { path.add(`${L}:${i}`); i = s.best[L][i]; }
      }
      for (let L = 0; L < 3; L++) for (let i = 0; i < 1 << L; i++) {
        const [x, y] = this.pos(L, i);
        for (const c of [i * 2, i * 2 + 1]) {
          const [cx, cy] = this.pos(L + 1, c);
          const [x1, y1, x2, y2] = trim(x, y, cx, cy, r, L === 2 ? sq * 0.62 : r);
          const chosen = s.best[L][i] === c;
          ctx.save();
          if (!chosen) ctx.setLineDash(DASH);
          if (chosen && path.has(`${L}:${i}`)) ctx.lineWidth *= 2;
          line(ctx, x1, y1, x2, y2);
          ctx.restore();
        }
      }
      ctx.fillStyle = ctx.strokeStyle;
      const cur = s.k < s.order.length ? s.order[s.k] : null;
      for (let L = 0; L <= 3; L++) for (let i = 0; i < 1 << L; i++) {
        const [x, y] = this.pos(L, i), v = s.val[L][i];
        if (L === 3) ctx.strokeRect(x - sq / 2, y - sq / 2, sq, sq);
        else {
          circle(ctx, x, y, r);
          if (L % 2 === 0) circle(ctx, x, y, r - 0.008);
          if (cur && cur[0] === L && cur[1] === i) { ctx.save(); ctx.setLineDash(DASH); circle(ctx, x, y, r + 0.014); ctx.restore(); }
        }
        if (v != null) text(ctx, String(v), x, y + 0.003, 0.04, { family: FONTS.text });
      }
    },
  },

  // Гейл — Шепли: предложения, помолвки и разрывы до стабильного паросочетания
  stablemarriage: {
    create(p, rng) {
      const N = 5;
      let ev, tries = 0;
      do {
        const pref = Array.from({ length: N }, () => shuffle(rng, [...Array(N).keys()]));
        const rank = Array.from({ length: N }, () => { const o = shuffle(rng, [...Array(N).keys()]), r = []; o.forEach((m, k) => (r[m] = k)); return r; });
        const next = new Array(N).fill(0), acc = new Array(N).fill(-1), free = [...Array(N).keys()];
        ev = [];
        while (free.length) {
          const m = free.shift(), w = pref[m][next[m]++], cur = acc[w];
          if (cur < 0) { acc[w] = m; ev.push([m, w, 1, -1]); }
          else if (rank[w][m] < rank[w][cur]) { acc[w] = m; ev.push([m, w, 1, cur]); free.unshift(cur); }
          else { ev.push([m, w, 0, -1]); free.unshift(m); }
        }
      } while (ev.length < 9 && ++tries < 30);
      return { rng, N, ev, k: 0, t: 0, pairs: new Array(N).fill(-1), hold: 0 };
    },
    D: 1.05,
    step(s, dt) {
      if (s.k >= s.ev.length) {
        if ((s.hold += dt) > 3.4) Object.assign(s, MODES.stablemarriage.create({}, s.rng));
        return;
      }
      s.t += dt / this.D;
      if (s.t >= 1) {
        const [m, w, ok, old] = s.ev[s.k++];
        if (ok) { s.pairs[w] = m; }
        s.t = 0;
      }
    },
    draw(ctx, s) {
      const r = 0.032, X = (i) => 0.14 + (i / (s.N - 1)) * 0.72, YT = 0.25, YB = 0.75;
      const e = s.k < s.ev.length ? s.ev[s.k] : null, t = s.t;
      const seg = (m, w) => trim(X(m), YT, X(w), YB, r + 0.004, r + 0.004);
      // помолвки
      s.pairs.forEach((m, w) => {
        if (m < 0) return;
        const [x1, y1, x2, y2] = seg(m, w);
        if (e && e[2] && e[1] === w && t > 0.5) {
          // разрыв: линия расходится от середины и исчезает
          const g = (t - 0.5) / 0.3;
          if (g < 1) { const mx = (x1 + x2) / 2, my = (y1 + y2) / 2; partial(ctx, x1, y1, mx, my, 1 - g); partial(ctx, x2, y2, mx, my, 1 - g); }
          return;
        }
        line(ctx, x1, y1, x2, y2);
      });
      if (e) {
        const [m, w, ok] = e, [x1, y1, x2, y2] = seg(m, w);
        if (ok && t > 0.5) line(ctx, x1, y1, x2, y2);
        else {
          const u = t < 0.45 ? ease(t / 0.45) : ok ? 1 : 1 - ease(Math.min(1, (t - 0.5) / 0.35));
          ctx.save(); ctx.setLineDash(DASH); partial(ctx, x1, y1, x2, y2, u); ctx.restore();
        }
      }
      const engagedM = new Set(s.pairs.filter((m) => m >= 0));
      for (let i = 0; i < s.N; i++) {
        for (const [y, on] of [[YT, engagedM.has(i)], [YB, s.pairs[i] >= 0]]) {
          blank(ctx, s, X(i), y, r);
          circle(ctx, X(i), y, r);
          if (on) circle(ctx, X(i), y, r - 0.01);
        }
      }
      if (e) dot(ctx, X(e[0]), YT, 0.007);
    },
  },

  // парадокс Браеса: новая перемычка замедляет всех
  braess: {
    create(p, rng) {
      // прогрев: дороги уже заполнены машинами
      const s = { rng, t: 0, cars: [], spawn: 0, n: 0 };
      for (let k = 0; k < 150; k++) MODES.braess.step(s, 1 / 30);
      return s;
    },
    V: { S: [0.1, 0.45], A: [0.5, 0.15], E: [0.9, 0.45], B: [0.5, 0.75] },
    CYCLE: 19, OPEN: 9,
    routes(open) {
      const c = open ? 2.6 : 1.3, f = 2.9;
      return open ? [[['S', 'A', c], ['A', 'B', 0.35], ['B', 'E', c]]] : [[['S', 'A', c], ['A', 'E', f]], [['S', 'B', f], ['B', 'E', c]]];
    },
    isOpen(t) { const ph = t % this.CYCLE; return ph >= this.OPEN; },
    step(s, dt) {
      s.t += dt; s.spawn += dt;
      while (s.spawn > 1 / 7) {
        s.spawn -= 1 / 7;
        const R = this.routes(this.isOpen(s.t)), route = R[s.n++ % R.length];
        s.cars.push({ t0: s.t - s.spawn, route, total: route.reduce((a, e) => a + e[2], 0), j: (s.n % 3) - 1 });
      }
      s.cars = s.cars.filter((c) => s.t - c.t0 < c.total);
    },
    draw(ctx, s) {
      const V = this.V, rN = 0.034;
      const road = (a, b, wide) => {
        const [x1, y1, x2, y2] = trim(...V[a], ...V[b], rN, rN);
        if (!wide) { line(ctx, x1, y1, x2, y2); return; }
        const d = Math.hypot(x2 - x1, y2 - y1), nx = -(y2 - y1) / d * 0.009, ny = (x2 - x1) / d * 0.009;
        line(ctx, x1 + nx, y1 + ny, x2 + nx, y2 + ny); line(ctx, x1 - nx, y1 - ny, x2 - nx, y2 - ny);
      };
      road('S', 'A', false); road('B', 'E', false); road('A', 'E', true); road('S', 'B', true);
      // перемычка видна, пока по ней едут последние машины (≈3 с после закрытия)
      const ph = s.t % this.CYCLE, open = ph >= this.OPEN || (ph < 3 && s.t > this.CYCLE);
      const grow = ph >= this.OPEN ? ease(Math.min(1, (ph - this.OPEN) / 0.7)) : 1;
      if (open) {
        const [x1, y1, x2, y2] = trim(...V.A, ...V.B, rN, rN);
        const d = 0.009;
        partial(ctx, x1 + d, y1, x2 + d, y2, grow); partial(ctx, x1 - d, y1, x2 - d, y2, grow);
      } else {
        const [x1, y1, x2, y2] = trim(...V.A, ...V.B, rN, rN);
        ctx.save(); ctx.setLineDash(DASH); line(ctx, x1, y1, x2, y2); ctx.restore();
      }
      const xs = [], ys = [];
      for (const c of s.cars) {
        let e = s.t - c.t0;
        for (const [a, b, T] of c.route) {
          if (e <= T) {
            const u = e / T, [x1, y1, x2, y2] = trim(...V[a], ...V[b], rN, rN);
            const d = Math.hypot(x2 - x1, y2 - y1);
            xs.push(x1 + (x2 - x1) * u - (y2 - y1) / d * c.j * 0.004); ys.push(y1 + (y2 - y1) * u + (x2 - x1) / d * c.j * 0.004);
            break;
          }
          e -= T;
        }
      }
      dots(ctx, xs, ys, 0.0055);
      for (const k of 'SAEB') {
        const [x, y] = V[k];
        blank(ctx, s, x, y, rN);
        rings(ctx, x, y, rN, k === 'S' || k === 'E' ? 2 : 1, 0.01);
      }
      ctx.fillStyle = ctx.strokeStyle;
      text(ctx, this.isOpen(s.t) ? '80 мин' : '65 мин', 0.5, 0.89, 0.032, { family: FONTS.text });
    },
  },

  // парадокс Кондорсе: большинство ходит по кругу
  condorcet: {
    create(p, rng) { return { rng, t: 0, dir: p.dir || 1 }; },
    C: [0.5, 0.52], R: 0.34,
    ang(s, k) { return -Math.PI / 2 + s.dir * (k % 3) * (TAU / 3); },
    vtx(s, k) { const a = this.ang(s, k); return [this.C[0] + this.R * Math.cos(a), this.C[1] + this.R * Math.sin(a)]; },
    step(s, dt) {
      s.t += dt;
      if (s.t > 3 * 2.2 + 2 * 2.6 + 0.8) { s.t = 0; s.dir = -s.dir; }
    },
    arc(ctx, s, k, u) {
      const g = 0.18, a0 = this.ang(s, k) + s.dir * g, a1 = a0 + s.dir * (TAU / 3 - 2 * g) * u;
      ctx.beginPath(); ctx.arc(this.C[0], this.C[1], this.R, Math.min(a0, a1), Math.max(a0, a1)); ctx.stroke();
      if (u >= 1) {
        const x = this.C[0] + this.R * Math.cos(a1), y = this.C[1] + this.R * Math.sin(a1);
        head(ctx, x, y, -Math.sin(a1) * s.dir, Math.cos(a1) * s.dir, 0.028);
      }
    },
    draw(ctx, s) {
      const rV = 0.048, T = s.t, contest = Math.min(3, Math.floor(T / 2.2)), ph = T - contest * 2.2;
      // группы избирателей: группа g ставит кандидата g первым, g+1 вторым, g+2 третьим
      const G = [0, 1, 2].map((g) => { const a = this.ang(s, g); return [this.C[0] + 0.11 * Math.cos(a), this.C[1] + 0.11 * Math.sin(a)]; });
      for (let k = 0; k < 3; k++) {
        if (k < contest) this.arc(ctx, s, k, 1);
        else if (k === contest) this.arc(ctx, s, k, ease(Math.min(1, Math.max(0, (ph - 0.9) / 1)) ));
      }
      if (contest < 3 && ph < 2.0) {
        // попарное голосование: k против k+1; группа выбирает того, кто у неё выше
        const u = ease(Math.min(1, ph / 0.8));
        for (let g = 0; g < 3; g++) {
          const rk = (c) => (c - g + 3) % 3, pick = rk(contest) < rk(contest + 1) ? contest : (contest + 1) % 3;
          const [x1, y1, x2, y2] = trim(...G[g], ...this.vtx(s, pick), 0.03, rV + 0.006);
          ctx.save(); ctx.setLineDash(DASH); partial(ctx, x1, y1, x2, y2, u); ctx.restore();
        }
      }
      for (let k = 0; k < 3; k++) {
        const [x, y] = this.vtx(s, k);
        blank(ctx, s, x, y, rV);
        rings(ctx, x, y, rV, 3, 0.013);
        if (contest < 3 && (k === contest || k === (contest + 1) % 3)) { ctx.save(); ctx.setLineDash(DASH); circle(ctx, x, y, rV + 0.016); ctx.restore(); }
      }
      G.forEach(([x, y], g) => {
        const xs = [], ys = [];
        for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU + this.ang(s, g); xs.push(x + 0.017 * Math.cos(a)); ys.push(y + 0.017 * Math.sin(a)); }
        blank(ctx, s, x, y, 0.026);
        dots(ctx, xs, ys, 0.0045);
        dot(ctx, x, y, 0.0045);
      });
      if (contest >= 3) {
        // точка бежит по кругу предпочтений — победителя нет
        const v = (T - 6.6) / 2.6, a = this.ang(s, 0) + s.dir * v * TAU;
        dot(ctx, this.C[0] + this.R * Math.cos(a), this.C[1] + this.R * Math.sin(a), 0.008);
      }
    },
  },

  // митохондриальная Ева: материнские линии сходятся к одной прародительнице
  mitoeve: {
    create(p, rng) {
      const G = 8, N = 9;
      let par, mrca = -1, tries = 0;
      while (tries++ < 400) {
        par = [null];
        for (let g = 1; g < G; g++) {
          const w = Array.from({ length: N }, () => rng() ** 2.2), tot = w.reduce((a, b) => a + b, 0);
          par.push(Array.from({ length: N }, () => { let r = rng() * tot; for (let j = 0; j < N; j++) if ((r -= w[j]) < 0) return j; return N - 1; }));
        }
        let set = new Set([...Array(N).keys()]);
        mrca = -1;
        for (let g = G - 1; g > 0; g--) { set = new Set([...set].map((i) => par[g][i])); if (set.size === 1 && mrca < 0) mrca = g - 1; }
        if (mrca >= 1 && mrca <= 2) break;
      }
      // кто из каждого ряда — предок ныне живущих
      const live = [];
      live[G - 1] = new Set([...Array(N).keys()]);
      for (let g = G - 1; g > 0; g--) live[g - 1] = new Set([...live[g]].map((i) => par[g][i]));
      let eve = 0;
      if (mrca >= 0) eve = [...live[mrca]][0];
      // раскладка без пересечений: дети встают под матерями, по порядку матерей
      // верхний ряд: прародительница всех ныне живущих — в середине
      const top = [...live[0]][0], slot = shuffle(rng, [...Array(N).keys()].filter((k) => k !== (N >> 1)));
      const gap = 0.088, X = [Array.from({ length: N }, (_, i) => 0.5 + ((i === top ? N >> 1 : slot.pop()) - (N - 1) / 2) * gap)];
      for (let g = 1; g < G; g++) {
        const up = X[g - 1], ord = [...Array(N).keys()].sort((a, b) => up[par[g][a]] - up[par[g][b]] || a - b);
        const cnt = new Array(N).fill(0), seen = new Array(N).fill(0);
        for (const i of ord) cnt[par[g][i]]++;
        const want = ord.map((i) => { const m = par[g][i]; return up[m] + (seen[m]++ - (cnt[m] - 1) / 2) * gap; });
        const xs = want.slice();
        for (let k = 1; k < N; k++) xs[k] = Math.max(xs[k], xs[k - 1] + gap);
        let shift = 0; for (let k = 0; k < N; k++) shift += want[k] - xs[k];
        shift /= N;
        const w = xs[N - 1] - xs[0], sc = w > 0.82 ? 0.82 / w : 1;
        let x0 = xs[0] + shift;
        x0 = Math.min(0.91 - w * sc, Math.max(0.09, x0));
        const row = []; ord.forEach((i, k) => (row[i] = x0 + (xs[k] - xs[0]) * sc)); X.push(row);
      }
      return { rng, G, N, par, live, X, mrca, eve, t: 0 };
    },
    px(s, g, i) { return [s.X[g][i], 0.1 + (g / (s.G - 1)) * 0.8]; },
    step(s, dt) {
      s.t += dt;
      if (s.t > 1.6 + s.G * 0.5 + 5) Object.assign(s, MODES.mitoeve.create({}, s.rng));
    },
    draw(ctx, s) {
      const { G, N } = s, shown = Math.min(G, 1 + Math.floor(s.t / 0.2));
      const back = Math.max(0, (s.t - 1.6) / 0.5); // сколько поколений назад прослежено
      const dash = [], solid = [];
      for (let g = 1; g < shown; g++) for (let i = 0; i < N; i++) {
        const [x1, y1] = this.px(s, g, i), [x2, y2] = this.px(s, g - 1, s.par[g][i]);
        const traced = s.live[g].has(i) && G - 1 - g < back;
        (traced ? solid : dash).push(x1, y1 - 0.008, x2, y2 + 0.008);
      }
      ctx.save(); ctx.setLineDash(DASH); segments(ctx, dash); ctx.restore();
      segments(ctx, solid);
      // частично прослеженное поколение — линии растут вверх
      const gp = G - 1 - Math.floor(back), frac = back - Math.floor(back);
      if (gp >= 1 && gp < shown && back > 0) {
        for (const i of s.live[gp]) {
          const [x1, y1] = this.px(s, gp, i), [x2, y2] = this.px(s, gp - 1, s.par[gp][i]);
          partial(ctx, x1, y1 - 0.008, x2, y2 + 0.008, ease(frac));
        }
      }
      for (let g = 0; g < shown; g++) {
        const xs = [], ys = [], hx = [], hy = [];
        for (let i = 0; i < N; i++) {
          const [x, y] = this.px(s, g, i);
          if (s.live[g].has(i) && G - 1 - g <= back) { xs.push(x); ys.push(y); } else { hx.push(x); hy.push(y); }
        }
        dots(ctx, xs, ys, g === G - 1 ? 0.0075 : 0.006);
        dots(ctx, hx, hy, 0.0035);
      }
      if (s.mrca >= 0 && G - 1 - s.mrca <= back) {
        const [x, y] = this.px(s, s.mrca, s.eve);
        const u = ease(Math.min(1, (back - (G - 1 - s.mrca)) / 1.5));
        for (let k = 1; k <= 3; k++) circle(ctx, x, y, 0.006 + k * 0.011 * u);
      }
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

// 3. Клеточные автоматы: «Жизнь» Конвея и элементарные правила Вольфрама
//    + решёточные модели: муравей, реакция–диффузия, Шеллинг, песочная куча, перколяция, Изинг, машина Тьюринга
import { dots, TAU, DASH, contours, segments, poly, circle, line, dot, ease, clamp } from '../core/draw.js';

const GOSPER = [
  [24, 0], [22, 1], [24, 1], [12, 2], [13, 2], [20, 2], [21, 2], [34, 2], [35, 2],
  [11, 3], [15, 3], [20, 3], [21, 3], [34, 3], [35, 3], [0, 4], [1, 4], [10, 4],
  [16, 4], [20, 4], [21, 4], [0, 5], [1, 5], [10, 5], [14, 5], [16, 5], [17, 5],
  [22, 5], [24, 5], [10, 6], [16, 6], [11, 7], [15, 7], [12, 8], [13, 8],
];

function seedLife(s) {
  s.cells.fill(0);
  s.gen = 0;
  s.still = 0;
  if (s.pattern === 'gun') {
    for (const [x, y] of GOSPER) s.cells[(y + 3) * s.n + x + 2] = 1;
  } else {
    for (let i = 0; i < s.cells.length; i++) s.cells[i] = s.rng() < s.density ? 1 : 0;
  }
}

function lifeStep(s) {
  const { n, cells, next, wrap } = s;
  let pop = 0;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let c = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          let xx = x + dx, yy = y + dy;
          if (wrap) { xx = (xx + n) % n; yy = (yy + n) % n; }
          else if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
          c += cells[yy * n + xx];
        }
      }
      const alive = cells[y * n + x];
      const v = c === 3 || (alive && c === 2) ? 1 : 0;
      next[y * n + x] = v;
      pop += v;
    }
  }
  s.still = pop === s.pop ? s.still + 1 : 0;
  s.pop = pop;
  s.cells = next;
  s.next = cells;
  s.gen++;
}

function ruleRow(rule, prev, wrap) {
  const w = prev.length;
  const row = new Uint8Array(w);
  for (let i = 0; i < w; i++) {
    const l = i > 0 ? prev[i - 1] : wrap ? prev[w - 1] : 0;
    const r = i < w - 1 ? prev[i + 1] : wrap ? prev[0] : 0;
    row[i] = (rule >> ((l << 2) | (prev[i] << 1) | r)) & 1;
  }
  return row;
}

// ——— Новые режимы: у каждого create(p, rng) / step(s, dt) / draw(ctx, s) ———

const DX4 = [0, 1, 0, -1];
const DY4 = [-1, 0, 1, 0];

// ширина линии ×2 — редкий акцент
function bold(ctx, fn) {
  const lw = ctx.lineWidth;
  ctx.lineWidth = lw * 2;
  fn();
  ctx.lineWidth = lw;
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}

const MODES = {
  // Правило 90: из одной клетки — треугольник Серпинского, нарисованный рёбрами решётки
  rule90: {
    create(p) {
      const D = p.depth || 31, w = 2 * D + 1;
      const rows = [new Uint8Array(w)];
      rows[0][D] = 1;
      for (let j = 1; j <= D; j++) rows.push(ruleRow(90, rows[j - 1], false));
      const hx = 0.86 / (2 * D), hy = hx * Math.sqrt(3);
      const y0 = (1 - D * hy) / 2;
      const X = (i) => 0.5 + (i - D) * hx, Y = (j) => y0 + j * hy;
      // рёбра треугольной решётки между живыми соседями; по строке j — все рёбра, кончающиеся в ней
      const edges = rows.map((row, j) => {
        const e = [];
        for (let i = 0; i < w; i++) {
          if (!row[i]) continue;
          if (j > 0) {
            if (i > 0 && rows[j - 1][i - 1]) e.push(X(i - 1), Y(j - 1), X(i), Y(j));
            if (i < w - 1 && rows[j - 1][i + 1]) e.push(X(i + 1), Y(j - 1), X(i), Y(j));
          }
          if (i + 2 < w && row[i + 2]) e.push(X(i), Y(j), X(i + 2), Y(j));
        }
        return e;
      });
      return { D, w, rows, edges, X, Y, t: 0 };
    },
    step(s, dt) { s.t = (s.t + dt) % (s.D * 0.2 + 7); },
    draw(ctx, s) {
      const k = Math.min(s.D, Math.floor(s.t / 0.2));
      const segs = [];
      for (let j = 0; j <= k; j++) for (const v of s.edges[j]) segs.push(v);
      segments(ctx, segs);
      dot(ctx, s.X(s.D), s.Y(0), 0.006);
      if (k < s.D) {
        // фронт вычисления: живые клетки текущей строки и пунктир под ней
        const row = s.rows[k], xs = [], ys = [];
        for (let i = 0; i < s.w; i++) if (row[i]) { xs.push(s.X(i)); ys.push(s.Y(k)); }
        dots(ctx, xs, ys, 0.0035);
        ctx.setLineDash(DASH);
        line(ctx, s.X(0), s.Y(k), s.X(s.w - 1), s.Y(k));
        ctx.setLineDash([]);
      }
    },
  },

  // Муравей Лэнгтона: ~10 000 шагов хаоса, затем «шоссе»
  ant: {
    create(p, rng) {
      const n = p.n || 90;
      const s = { n, rng, cells: new Uint8Array(n * n), rate: p.rate || 700 };
      this.reset(s);
      return s;
    },
    reset(s) {
      s.cells.fill(0);
      // хаос занимает примерно [−19..29]×[−22..22] клеток от старта, шоссе уходит по диагонали вниз-влево
      s.x = s.n - 40; s.y = 30; s.d = 0;
      s.rot = Math.floor(s.rng() * 4);
      s.steps = 0; s.acc = 0; s.hold = 0; s.out = false;
    },
    step(s, dt) {
      if (s.out) {
        s.hold += dt;
        if (s.hold > 4) this.reset(s);
        return;
      }
      // хаос проматываем быстро, рождение «шоссе» показываем медленнее
      s.acc += dt * (s.steps < 9600 ? s.rate : s.rate * 0.4);
      const { n, cells } = s;
      while (s.acc >= 1) {
        s.acc -= 1;
        const i = s.y * n + s.x;
        if (cells[i]) { s.d = (s.d + 3) & 3; cells[i] = 0; } else { s.d = (s.d + 1) & 3; cells[i] = 1; }
        const x = s.x + DX4[s.d], y = s.y + DY4[s.d];
        s.steps++;
        if (x < 0 || y < 0 || x >= n || y >= n) { s.out = true; s.acc = 0; break; }
        s.x = x; s.y = y;
      }
    },
    draw(ctx, s) {
      const { n } = s, c = 0.88 / n;
      // поворот всей картины на rot·90° вокруг центра
      const P = (x, y) => {
        const u = (x + 0.5) / n - 0.5, v = (y + 0.5) / n - 0.5;
        const r = s.rot;
        const a = r === 0 ? u : r === 1 ? -v : r === 2 ? -u : v;
        const b = r === 0 ? v : r === 1 ? u : r === 2 ? -v : -u;
        return [0.5 + a * 0.88, 0.5 + b * 0.88];
      };
      const xs = [], ys = [];
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        if (!s.cells[y * n + x]) continue;
        const q = P(x, y);
        xs.push(q[0]); ys.push(q[1]);
      }
      dots(ctx, xs, ys, c * 0.36);
      if (!s.out) {
        const q = P(s.x, s.y);
        circle(ctx, q[0], q[1], 0.016);
      }
    },
  },

  // Морфогенез Тьюринга: реакция–диффузия Грея — Скотта на торе, видимая в круглой «чашке» изолиниями
  grayscott: {
    PRESETS: [[0.0367, 0.0649], [0.029, 0.057], [0.03, 0.062], [0.026, 0.055]],
    create(p, rng) {
      const G = p.n || 64;
      const s = {
        G, rng, u: new Float32Array(G * G), v: new Float32Array(G * G),
        u2: new Float32Array(G * G), v2: new Float32Array(G * G), f: new Float32Array(G * G), win: new Float32Array(G * G),
        preset: p.preset ?? Math.floor(rng() * 2), ips: p.ips || 330, D: p.diff || 0.62, acc: 0, it: 0, segs: [], segs2: [],
      };
      // окно «чашки»: поле гасится к краю круга, и изолинии замыкаются внутри него
      const R = (G - 1) / 2;
      for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
        const r = Math.hypot(i - R, j - R) / R;
        s.win[j * G + i] = clamp((0.97 - r) / 0.12, 0, 1);
      }
      this.reset(s);
      return s;
    },
    reset(s) {
      const { G, u, v, rng } = s;
      u.fill(1); v.fill(0);
      const [F, k] = this.PRESETS[s.preset % this.PRESETS.length];
      s.F = F; s.k = k;
      for (let m = 0; m < 16; m++) {
        const cx = Math.floor(rng() * G), cy = Math.floor(rng() * G);
        for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) {
          const q = ((cy + j + G) % G) * G + ((cx + i + G) % G);
          u[q] = 0.5; v[q] = 0.25 + rng() * 0.25;
        }
      }
      s.it = 0;
      this.contour(s);
    },
    iterate(s) {
      const { G, F, k, D } = s;
      const { u, v, u2, v2 } = s;
      const kf = k + F, Du = D, Dv = D * 0.5;
      for (let j = 0; j < G; j++) {
        const jm = (j === 0 ? G - 1 : j - 1) * G, j0 = j * G, jp = (j === G - 1 ? 0 : j + 1) * G;
        for (let i = 0; i < G; i++) {
          const im = i === 0 ? G - 1 : i - 1, ip = i === G - 1 ? 0 : i + 1;
          const q = j0 + i, U = u[q], V = v[q];
          const lu = 0.2 * (u[j0 + im] + u[j0 + ip] + u[jm + i] + u[jp + i]) + 0.05 * (u[jm + im] + u[jm + ip] + u[jp + im] + u[jp + ip]) - U;
          const lv = 0.2 * (v[j0 + im] + v[j0 + ip] + v[jm + i] + v[jp + i]) + 0.05 * (v[jm + im] + v[jm + ip] + v[jp + im] + v[jp + ip]) - V;
          const uvv = U * V * V;
          u2[q] = U + Du * lu - uvv + F * (1 - U);
          v2[q] = V + Dv * lv + uvv - kf * V;
        }
      }
      s.u = u2; s.u2 = u; s.v = v2; s.v2 = v;
      s.it++;
    },
    contour(s) {
      const pad = 0.06, w = 1 - 2 * pad, { f, v, win } = s;
      for (let q = 0; q < f.length; q++) f[q] = v[q] * win[q];
      s.segs = contours(f, s.G, s.G, 0.2, [], pad, pad, w, w);
      s.segs2 = contours(f, s.G, s.G, 0.3, [], pad, pad, w, w);
    },
    step(s, dt) {
      s.acc += Math.min(dt, 0.12) * s.ips;
      let n = 0;
      while (s.acc >= 1 && n < 40) { s.acc -= 1; this.iterate(s); n++; }
      if (s.acc > 2) s.acc = 0;
      if (n) this.contour(s);
      if (s.it > 10000) { s.preset++; this.reset(s); }
    },
    draw(ctx, s) {
      circle(ctx, 0.5, 0.5, 0.455);
      segments(ctx, s.segs);
      ctx.setLineDash(DASH);
      segments(ctx, s.segs2);
      ctx.setLineDash([]);
    },
  },

  // Сегрегация Шеллинга: недовольные переезжают, кварталы расслаиваются
  schelling: {
    create(p, rng) {
      const n = p.n || 20;
      const s = { n, rng, need: p.need ?? 0.5, empty: p.empty ?? 0.12, grid: new Int8Array(n * n), moves: [], t: 0 };
      this.reset(s);
      return s;
    },
    reset(s) {
      const { n, grid, rng } = s;
      const idx = shuffle([...Array(n * n).keys()], rng);
      const ne = Math.round(n * n * s.empty);
      idx.forEach((q, m) => { grid[q] = m < ne ? 0 : m % 2 ? 1 : 2; });
      s.moves = []; s.t = 0; s.age = 0; s.hold = 0; s.done = false;
    },
    // доля «своих» среди занятых соседей клетки q для жителя типа a
    share(s, q, a) {
      const { n, grid } = s;
      const x = q % n, y = (q / n) | 0;
      let same = 0, all = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
        const b = grid[yy * n + xx];
        if (!b) continue;
        all++; if (b === a) same++;
      }
      return all ? same / all : 1;
    },
    step(s, dt) {
      s.t += dt;
      if (s.done) {
        s.hold += dt;
        if (s.hold > 4) this.reset(s);
        return;
      }
      s.age += dt;
      if (s.t < 0.3) return;
      s.t = 0;
      const { n, grid, rng } = s;
      const bad = [];
      for (let q = 0; q < n * n; q++) if (grid[q] && this.share(s, q, grid[q]) < s.need) bad.push(q);
      s.moves = [];
      if (!bad.length || s.age > 30) { s.done = true; return; }
      shuffle(bad, rng);
      const k = Math.min(6, bad.length);
      for (let m = 0; m < k; m++) {
        const a = bad[m], t = grid[a], ax = a % n, ay = (a / n) | 0;
        if (!t) continue;
        // ближайшая свободная клетка, где будет достаточно своих; если такой нет — любая свободная
        let best = -1, bd = 1e9, any = -1;
        grid[a] = 0;
        for (let q = 0; q < n * n; q++) {
          if (grid[q] || q === a) continue;
          if (any < 0 || rng() < 0.1) any = q;
          const d = Math.hypot((q % n) - ax, ((q / n) | 0) - ay) + rng() * 0.5;
          if (d < bd && this.share(s, q, t) >= s.need) { bd = d; best = q; }
        }
        const b = best >= 0 ? best : any;
        if (b < 0) { grid[a] = t; continue; }
        s.moves.push(a, b, t);
        grid[b] = t;
      }
    },
    draw(ctx, s) {
      const { n, grid } = s, c = 0.86 / n, r = c * 0.27;
      const X = (q) => 0.07 + ((q % n) + 0.5) * c, Y = (q) => 0.07 + (((q / n) | 0) + 0.5) * c;
      const moving = new Set();
      for (let m = 0; m < s.moves.length; m += 3) moving.add(s.moves[m + 1]);
      const ax = [], ay = [], bx = [], by = [];
      for (let q = 0; q < n * n; q++) {
        if (!grid[q] || moving.has(q)) continue;
        (grid[q] === 1 ? ax : bx).push(X(q));
        (grid[q] === 1 ? ay : by).push(Y(q));
      }
      // переезды: пунктир от старого дома к новому, жилец в пути
      const f = s.done ? 1 : ease(clamp(s.t / 0.3, 0, 1));
      ctx.setLineDash(DASH);
      for (let m = 0; m < s.moves.length; m += 3) {
        const a = s.moves[m], b = s.moves[m + 1];
        const x = X(a) + (X(b) - X(a)) * f, y = Y(a) + (Y(b) - Y(a)) * f;
        line(ctx, X(a), Y(a), x, y);
        (s.moves[m + 2] === 1 ? ax : bx).push(x);
        (s.moves[m + 2] === 1 ? ay : by).push(y);
      }
      ctx.setLineDash([]);
      dots(ctx, ax, ay, r * 0.8);
      dots(ctx, bx, by, r * 1.05, bx.length, 'stroke');
    },
  },

  // Песочная куча Бака — Танга — Визенфельда: число песчинок в клетке — числом точек
  sandpile: {
    create(p, rng) {
      const n = p.n || 61;
      const s = { n, rng, h: new Uint8Array(n * n), rate: p.rate || 380, stack: new Int32Array(n * n * 4) };
      this.reset(s);
      return s;
    },
    reset(s) { s.h.fill(0); s.acc = 0; s.grains = 0; s.full = false; s.hold = 0; s.lastAv = 0; },
    drop(s) {
      const { n, h, stack } = s, c = ((n / 2) | 0) * (n + 1);
      h[c]++;
      if (h[c] < 4) return 0;
      let sp = 0, topples = 0;
      stack[sp++] = c;
      while (sp) {
        const q = stack[--sp];
        if (h[q] < 4) continue;
        const k = h[q] >> 2;
        h[q] -= k * 4;
        topples += k;
        const x = q % n, y = (q / n) | 0;
        if (x === 0 || y === 0 || x === n - 1 || y === n - 1) s.full = true;
        if (x > 0) { h[q - 1] += k; if (h[q - 1] >= 4) stack[sp++] = q - 1; }
        if (x < n - 1) { h[q + 1] += k; if (h[q + 1] >= 4) stack[sp++] = q + 1; }
        if (y > 0) { h[q - n] += k; if (h[q - n] >= 4) stack[sp++] = q - n; }
        if (y < n - 1) { h[q + n] += k; if (h[q + n] >= 4) stack[sp++] = q + n; }
      }
      return topples;
    },
    step(s, dt) {
      if (s.full) {
        s.hold += dt;
        if (s.hold > 4) this.reset(s);
        return;
      }
      // сначала медленно, потом быстрее
      s.acc += dt * s.rate * Math.min(1, 0.4 + s.grains / 2500);
      while (s.acc >= 1 && !s.full) {
        s.acc -= 1;
        s.grains++;
        s.lastAv = this.drop(s);
        // клетки на краю ещё не трогаем: куча останавливается, когда лавина доходит до кромки
        const { n, h } = s, m = 2;
        for (let i = m; i < n - m && !s.full; i++) {
          if (h[m * n + i] || h[(n - 1 - m) * n + i] || h[i * n + m] || h[i * n + n - 1 - m]) s.full = true;
        }
      }
    },
    draw(ctx, s) {
      // 1 — крошка, 2 — кружок, 3 — точка (клетка на грани осыпания)
      const { n, h } = s, c = 0.88 / n, o = 0.06;
      const x1 = [], y1 = [], x2 = [], y2 = [], x3 = [], y3 = [];
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const v = h[y * n + x];
        if (!v) continue;
        const cx = o + (x + 0.5) * c, cy = o + (y + 0.5) * c;
        if (v === 1) { x1.push(cx); y1.push(cy); } else if (v === 2) { x2.push(cx); y2.push(cy); } else { x3.push(cx); y3.push(cy); }
      }
      dots(ctx, x1, y1, c * 0.09);
      dots(ctx, x2, y2, c * 0.3, x2.length, 'stroke');
      dots(ctx, x3, y3, c * 0.3);
      // место падения песчинок
      const m = (n / 2) | 0;
      if (!s.full) circle(ctx, o + (m + 0.5) * c, o + (m + 0.5) * c, c * 1.4);
    },
  },

  // Перколяция: клетки открываются по одной, пока кластер не соединит верх и низ
  percolation: {
    create(p, rng) {
      const n = p.n || 24;
      const s = { n, rng, rate: p.rate || 34, open: new Uint8Array(n * n), par: new Int32Array(n * n + 2) };
      this.reset(s);
      return s;
    },
    reset(s) {
      const { n } = s;
      s.open.fill(0);
      for (let i = 0; i < s.par.length; i++) s.par[i] = i;
      s.order = shuffle([...Array(n * n).keys()], s.rng);
      s.k = 0; s.acc = 0; s.path = null; s.hold = 0;
    },
    find(s, a) {
      const { par } = s;
      while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; }
      return a;
    },
    union(s, a, b) { s.par[this.find(s, a)] = this.find(s, b); },
    step(s, dt) {
      const { n, open } = s;
      if (s.path) {
        s.hold += dt;
        if (s.hold > 6) this.reset(s);
        return;
      }
      s.acc += dt * s.rate;
      while (s.acc >= 1 && !s.path) {
        s.acc -= 1;
        const q = s.order[s.k++];
        open[q] = 1;
        const x = q % n, y = (q / n) | 0;
        if (y === 0) this.union(s, q, n * n);
        if (y === n - 1) this.union(s, q, n * n + 1);
        if (x > 0 && open[q - 1]) this.union(s, q, q - 1);
        if (x < n - 1 && open[q + 1]) this.union(s, q, q + 1);
        if (y > 0 && open[q - n]) this.union(s, q, q - n);
        if (y < n - 1 && open[q + n]) this.union(s, q, q + n);
        if (this.find(s, n * n) === this.find(s, n * n + 1)) s.path = this.bfs(s);
      }
    },
    // кратчайший путь протекания сверху вниз
    bfs(s) {
      const { n, open } = s, prev = new Int32Array(n * n).fill(-2), queue = [];
      for (let x = 0; x < n; x++) if (open[x]) { prev[x] = -1; queue.push(x); }
      for (let h = 0; h < queue.length; h++) {
        const q = queue[h], x = q % n, y = (q / n) | 0;
        if (y === n - 1) {
          const path = [];
          for (let c = q; c >= 0; c = prev[c]) path.push(c);
          return path.reverse();
        }
        for (let d = 0; d < 4; d++) {
          const xx = x + DX4[d], yy = y + DY4[d];
          if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
          const r = yy * n + xx;
          if (open[r] && prev[r] === -2) { prev[r] = q; queue.push(r); }
        }
      }
      return [];
    },
    draw(ctx, s) {
      const { n, open } = s, c = 0.8 / n, o = 0.1;
      const X = (q) => o + ((q % n) + 0.5) * c, Y = (q) => o + (((q / n) | 0) + 0.5) * c;
      // электроды сверху и снизу
      line(ctx, o, o - c * 0.5, o + n * c, o - c * 0.5);
      line(ctx, o, o + n * c + c * 0.5, o + n * c, o + n * c + c * 0.5);
      const segs = [], xs = [], ys = [];
      for (let q = 0; q < n * n; q++) {
        if (!open[q]) continue;
        const x = q % n, y = (q / n) | 0;
        xs.push(X(q)); ys.push(Y(q));
        if (x < n - 1 && open[q + 1]) segs.push(X(q), Y(q), X(q + 1), Y(q + 1));
        if (y < n - 1 && open[q + n]) segs.push(X(q), Y(q), X(q + n), Y(q + n));
      }
      segments(ctx, segs);
      dots(ctx, xs, ys, c * 0.11);
      if (s.path && s.path.length) {
        // путь протекает сверху вниз
        const L = s.path.length, m = Math.min(L, 1 + Math.floor((s.hold / 1.6) * L));
        const pts = [X(s.path[0]), o - c * 0.5];
        for (let i = 0; i < m; i++) pts.push(X(s.path[i]), Y(s.path[i]));
        if (m === L) pts.push(X(s.path[L - 1]), o + n * c + c * 0.5);
        bold(ctx, () => poly(ctx, pts));
        dot(ctx, pts[pts.length - 2], pts[pts.length - 1], 0.008);
      }
    },
  },

  // Модель Изинга: спины ↑ — штрих, ↓ — пусто; температура качается около критической.
  // Динамика Кавасаки (соседи меняются спинами): намагниченность сохраняется, поэтому оба типа доменов есть всегда
  ising: {
    create(p, rng) {
      const n = p.n || 40;
      const s = { n, rng, spin: new Int8Array(n * n), t: 0, acc: 0, sweeps: p.sweeps || 160 };
      const idx = shuffle([...Array(n * n).keys()], rng);
      idx.forEach((q, m) => { s.spin[q] = m < (n * n) / 2 ? 1 : -1; });
      s.T = this.temp(0);
      return s;
    },
    TC: 2 / Math.log(1 + Math.SQRT2),
    temp(t) { return this.TC * (1 - 0.45 * Math.cos((TAU * t) / 32)); },
    step(s, dt) {
      s.t += dt;
      s.T = this.temp(s.t);
      const { n, spin, rng } = s, N = n * n;
      // вероятности Метрополиса для ΔE = 4, 8, 12, 16
      const w = [1, Math.exp(-4 / s.T), Math.exp(-8 / s.T), Math.exp(-12 / s.T), Math.exp(-16 / s.T)];
      const nb = (x, y) => spin[((y + n) % n) * n + ((x + n) % n)];
      s.acc += Math.min(dt, 0.12) * s.sweeps * N;
      while (s.acc >= 1) {
        s.acc -= 1;
        const q = (rng() * N) | 0, x = q % n, y = (q / n) | 0, d = (rng() * 4) | 0;
        const x2 = (x + DX4[d] + n) % n, y2 = (y + DY4[d] + n) % n, r = y2 * n + x2;
        const a = spin[q], b = spin[r];
        if (a === b) continue;
        const sa = nb(x + 1, y) + nb(x - 1, y) + nb(x, y + 1) + nb(x, y - 1) - b;
        const sb = nb(x2 + 1, y2) + nb(x2 - 1, y2) + nb(x2, y2 + 1) + nb(x2, y2 - 1) - a;
        const dE = 2 * a * sa + 2 * b * sb;
        if (dE <= 0 || rng() < w[dE >> 2]) { spin[q] = b; spin[r] = a; }
      }
    },
    draw(ctx, s) {
      const { n, spin } = s, c = 0.76 / n, ox = 0.12, oy = 0.07, hl = c * 0.34;
      const segs = [];
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        if (spin[y * n + x] < 0) continue;
        const cx = ox + (x + 0.5) * c, cy = oy + (y + 0.5) * c;
        segs.push(cx, cy - hl, cx, cy + hl);
      }
      segments(ctx, segs);
      // шкала температуры: Tc — штрих, текущая T — точка
      const y = 0.905, a = 0.2, b = 0.8;
      const tx = (T) => a + ((T / this.TC - 0.55) / 0.9) * (b - a);
      ctx.setLineDash(DASH);
      line(ctx, a, y, b, y);
      ctx.setLineDash([]);
      line(ctx, tx(this.TC), y - 0.018, tx(this.TC), y + 0.018);
      dot(ctx, tx(s.T), y, 0.008);
    },
  },

  // Машина Тьюринга: «занятой бобёр» на 4 состояния — 107 шагов, 13 единиц; история ленты вниз
  turing: {
    // [запись, сдвиг, новое состояние] для символов 0 и 1; −1 — останов
    BB4: [[[1, 1, 1], [1, -1, 1]], [[1, -1, 0], [0, -1, 2]], [[1, 1, -1], [1, -1, 3]], [[1, 1, 3], [0, 1, 0]]],
    create(p) {
      const s = { lo: -11, W: 16, rate: p.rate || 6 };
      this.reset(s);
      return s;
    },
    reset(s) {
      s.tape = new Uint8Array(s.W);
      s.head = -s.lo; s.state = 0; s.k = 0; s.acc = 0; s.hold = 0;
      s.hist = [s.tape.slice()]; s.heads = [s.head];
    },
    step(s, dt) {
      if (s.state < 0) {
        s.hold += dt;
        if (s.hold > 5) this.reset(s);
        return;
      }
      s.acc += dt * s.rate;
      while (s.acc >= 1 && s.state >= 0) {
        s.acc -= 1;
        const [w, m, ns] = this.BB4[s.state][s.tape[s.head]];
        s.tape[s.head] = w;
        s.head += m; s.state = ns; s.k++;
        s.hist.push(s.tape.slice()); s.heads.push(s.head);
      }
    },
    draw(ctx, s) {
      const W = s.W, c = 0.8 / W, ox = 0.1, ty = 0.1;
      const X = (i) => ox + (i + 0.5) * c;
      const top = ty + c * 1.0, rh = (0.94 - top) / 108;
      const Y = (k) => top + k * rh;
      // лента
      ctx.beginPath();
      ctx.rect(ox, ty - c / 2, W * c, c);
      for (let i = 1; i < W; i++) { ctx.moveTo(ox + i * c, ty - c / 2); ctx.lineTo(ox + i * c, ty + c / 2); }
      ctx.stroke();
      const xs = [], ys = [];
      for (let i = 0; i < W; i++) if (s.tape[i]) { xs.push(X(i)); ys.push(ty); }
      dots(ctx, xs, ys, c * 0.16);
      // головка: треугольник над читаемой клеткой
      const hx = X(s.head), hy = ty - c * 0.62;
      ctx.beginPath();
      ctx.moveTo(hx, hy); ctx.lineTo(hx - c * 0.22, hy - c * 0.36); ctx.lineTo(hx + c * 0.22, hy - c * 0.36); ctx.closePath();
      ctx.stroke();
      // история: непрерывные единицы — вертикальные линии
      const K = s.hist.length, segs = [];
      for (let i = 0; i < W; i++) {
        let start = -1;
        for (let k = 0; k <= K; k++) {
          const v = k < K ? s.hist[k][i] : 0;
          if (v && start < 0) start = k;
          if (!v && start >= 0) { segs.push(X(i), Y(start), X(i), Y(k - 1)); start = -1; }
        }
      }
      segments(ctx, segs);
      // путь головки — пунктир
      const pts = [];
      for (let k = 0; k < K; k++) pts.push(X(s.heads[k]), Y(k));
      ctx.setLineDash(DASH);
      poly(ctx, pts);
      ctx.setLineDash([]);
      dot(ctx, X(s.heads[K - 1]), Y(K - 1), 0.006);
    },
  },
};

export default {
  id: 'automata',
  create(p, rng) {
    if (MODES[p.mode]) return { mode: p.mode, ...MODES[p.mode].create(p, rng) };
    if (p.mode === 'rule') {
      const w = p.w || 81;
      const first = new Uint8Array(w);
      if (p.init === 'random') for (let i = 0; i < w; i++) first[i] = rng() < (p.density ?? 0.5) ? 1 : 0;
      else first[p.init === 'right' ? w - 1 : (w / 2) | 0] = 1;
      return { mode: 'rule', rule: p.rule ?? 110, w, rows: [first], wrap: p.init === 'random', acc: 0 };
    }
    const n = p.n || (p.pattern === 'gun' ? 44 : 40);
    const s = {
      mode: 'life', n, rng, pattern: p.pattern || 'random', density: p.density ?? 0.3,
      cells: new Uint8Array(n * n), next: new Uint8Array(n * n), wrap: p.pattern !== 'gun', acc: 0, pop: 0,
    };
    seedLife(s);
    return s;
  },
  step(s, dt) {
    if (MODES[s.mode]) return MODES[s.mode].step(s, dt);
    s.acc += dt;
    if (s.mode === 'rule') {
      while (s.acc > 0.045) {
        s.acc -= 0.045;
        s.rows.push(ruleRow(s.rule, s.rows[s.rows.length - 1], s.wrap));
        if (s.rows.length > s.w) s.rows.shift();
      }
      return;
    }
    while (s.acc > 0.11) {
      s.acc -= 0.11;
      lifeStep(s);
      if (s.gen > 420 || s.still > 40) seedLife(s);
    }
  },
  draw(ctx, s) {
    if (MODES[s.mode]) return MODES[s.mode].draw(ctx, s);
    if (s.mode === 'rule') {
      const c = 0.92 / s.w;
      const xs = [], ys = [];
      s.rows.forEach((row, j) => {
        for (let i = 0; i < s.w; i++) if (row[i]) { xs.push(0.04 + (i + 0.5) * c); ys.push(0.04 + (j + 0.5) * c); }
      });
      dots(ctx, xs, ys, c * 0.38);
      return;
    }
    const c = 0.92 / s.n;
    ctx.beginPath();
    for (let y = 0; y < s.n; y++) {
      for (let x = 0; x < s.n; x++) {
        if (!s.cells[y * s.n + x]) continue;
        const cx = 0.04 + (x + 0.5) * c, cy = 0.04 + (y + 0.5) * c;
        ctx.moveTo(cx + c * 0.36, cy);
        ctx.arc(cx, cy, c * 0.36, 0, TAU);
      }
    }
    ctx.stroke();
  },
};

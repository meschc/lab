// 3. Клеточные автоматы: «Жизнь» Конвея и элементарные правила Вольфрама
import { dots, TAU } from '../core/draw.js';

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

export default {
  id: 'automata',
  create(p, rng) {
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

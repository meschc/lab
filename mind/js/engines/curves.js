// 1. Кривые, заполняющие пространство: рисуются по порядкам
import { poly, star } from '../core/draw.js';

const M = 0.07; // поле внутри рамки

function place(raw, n, flipY = true) {
  const out = new Float32Array(raw.length);
  const k = (1 - 2 * M) / n;
  for (let i = 0; i < raw.length; i += 2) {
    out[i] = M + (raw[i] + 0.5) * k;
    out[i + 1] = flipY ? 1 - M - (raw[i + 1] + 0.5) * k : M + (raw[i + 1] + 0.5) * k;
  }
  return out;
}

function hilbert(order) {
  const n = 1 << order;
  const N = n * n;
  const raw = new Float32Array(N * 2);
  for (let d = 0; d < N; d++) {
    let t = d, x = 0, y = 0;
    for (let s = 1; s < n; s *= 2) {
      const rx = 1 & (t >> 1);
      const ry = 1 & (t ^ rx);
      if (!ry) {
        if (rx) { x = s - 1 - x; y = s - 1 - y; }
        const tmp = x; x = y; y = tmp;
      }
      x += s * rx;
      y += s * ry;
      t >>= 2;
    }
    raw[d * 2] = x;
    raw[d * 2 + 1] = y;
  }
  return place(raw, n);
}

// Формула Пеано: цифры троичной записи с дополнением k(t)=2−t по чётности сумм
function peano(order) {
  const n = 3 ** order;
  const N = n * n;
  const raw = new Float32Array(N * 2);
  const digits = new Array(order * 2);
  for (let d = 0; d < N; d++) {
    let t = d;
    for (let i = order * 2 - 1; i >= 0; i--) { digits[i] = t % 3; t = (t / 3) | 0; }
    let sx = 0, sy = 0, x = 0, y = 0;
    for (let j = 0; j < order; j++) {
      const ax = digits[2 * j];
      const ay = digits[2 * j + 1];
      const bx = sy & 1 ? 2 - ax : ax;
      sx += ax;
      const by = sx & 1 ? 2 - ay : ay;
      sy += ay;
      x = x * 3 + bx;
      y = y * 3 + by;
    }
    raw[d * 2] = x;
    raw[d * 2 + 1] = y;
  }
  return place(raw, n);
}

function morton(order) {
  const n = 1 << order;
  const N = n * n;
  const raw = new Float32Array(N * 2);
  for (let d = 0; d < N; d++) {
    let x = 0, y = 0;
    for (let b = 0; b < order; b++) {
      x |= ((d >> (2 * b)) & 1) << b;
      y |= ((d >> (2 * b + 1)) & 1) << b;
    }
    raw[d * 2] = x;
    raw[d * 2 + 1] = y;
  }
  return place(raw, n, false);
}

// Кривая дракона: последовательность поворотов из сгибания полоски бумаги
function dragon(order) {
  const N = 1 << order;
  const pts = new Float32Array((N + 1) * 2);
  let x = 0, y = 0, dir = 0;
  const dx = [1, 0, -1, 0];
  const dy = [0, 1, 0, -1];
  pts[0] = 0; pts[1] = 0;
  for (let i = 1; i <= N; i++) {
    x += dx[dir]; y += dy[dir];
    pts[i * 2] = x; pts[i * 2 + 1] = y;
    const right = (((i & -i) << 1) & i) !== 0;
    dir = (dir + (right ? 3 : 1)) & 3;
  }
  // вписываем в квадрат с сохранением пропорций
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    x0 = Math.min(x0, pts[i]); x1 = Math.max(x1, pts[i]);
    y0 = Math.min(y0, pts[i + 1]); y1 = Math.max(y1, pts[i + 1]);
  }
  const s = (1 - 2 * M - 0.06) / Math.max(x1 - x0, y1 - y0, 1);
  const ox = 0.5 - ((x1 - x0) * s) / 2;
  const oy = 0.5 - ((y1 - y0) * s) / 2;
  for (let i = 0; i < pts.length; i += 2) {
    pts[i] = ox + (pts[i] - x0) * s;
    pts[i + 1] = oy + (pts[i + 1] - y0) * s;
  }
  return pts;
}

const BUILD = { hilbert, peano, morton, dragon };
const MAX = { hilbert: 6, peano: 4, morton: 5, dragon: 13 };
const MIN = { hilbert: 1, peano: 1, morton: 1, dragon: 3 };

export default {
  id: 'curves',
  create(p) {
    const mode = p.mode || 'hilbert';
    return { mode, max: p.maxOrder || MAX[mode], order: MIN[mode], p: 0, hold: 0, cache: {} };
  },
  get(s, order) {
    return s.cache[order] || (s.cache[order] = BUILD[s.mode](order));
  },
  step(s, dt) {
    if (s.p < 1) {
      const dur = s.mode === 'dragon' ? 0.9 + s.order * 0.12 : 1.1 + s.order * 0.55;
      s.p = Math.min(1, s.p + dt / dur);
    } else if (s.order < s.max) {
      s.order++;
      s.p = 0;
    } else if ((s.hold += dt) > 3.5) {
      s.order = MIN[s.mode];
      s.p = 0;
      s.hold = 0;
    }
  },
  draw(ctx, s) {
    const cur = this.get(s, s.order);
    const n = cur.length / 2;
    if (s.order > MIN[s.mode] && s.mode !== 'dragon') {
      ctx.save();
      ctx.globalAlpha = 0.16;
      poly(ctx, this.get(s, s.order - 1));
      ctx.restore();
    }
    // дракон меняет масштаб с каждым порядком — показываем его целиком
    const count = s.mode === 'dragon' ? n : Math.max(2, Math.floor(s.p * n));
    poly(ctx, cur, count);
    const hx = cur[(count - 1) * 2];
    const hy = cur[(count - 1) * 2 + 1];
    star(ctx, hx, hy, 0.016);
  },
};

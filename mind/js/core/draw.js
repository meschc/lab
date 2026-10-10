// Общие примитивы. Движки рисуют в единичном квадрате [0..1]×[0..1]:
// вызывающий код ставит transform, lineWidth = LW и цвета.
export const LW = 0.003; // 3px на 1000px, как в референсах
export const TAU = Math.PI * 2;
// вспомогательные линии — пунктиром, а не полутоном
export const DASH = [0.006, 0.009];

// шрифты холста; app.js подставляет те же семейства, что и в CSS (--display, --text)
export const FONTS = {
  display: 'Minipax, "PT Serif", Georgia, serif',
  text: 'Minipax, "PT Serif", Georgia, serif',
};

// Фирменная 12-лучевая звезда из референсов
export function star(ctx, x, y, r, n = 12, inner = 0.37) {
  ctx.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / n;
    const rr = i % 2 ? r * inner : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
}

export function circle(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, Math.max(r, 0), 0, TAU);
  ctx.stroke();
}

export function line(ctx, x1, y1, x2, y2) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

// Много кружков одним путём: fill — точки, stroke — контуры
export function dots(ctx, xs, ys, r, n = xs.length, mode = 'fill') {
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    ctx.moveTo(xs[i] + r, ys[i]);
    ctx.arc(xs[i], ys[i], r, 0, TAU);
  }
  mode === 'fill' ? ctx.fill() : ctx.stroke();
}

// Ломаная из плоского массива [x0,y0,x1,y1,...]
export function poly(ctx, pts, count = pts.length / 2, closed = false, from = 0) {
  if (count - from < 2) return;
  ctx.beginPath();
  ctx.moveTo(pts[from * 2], pts[from * 2 + 1]);
  for (let i = from + 1; i < count; i++) ctx.lineTo(pts[i * 2], pts[i * 2 + 1]);
  if (closed) ctx.closePath();
  ctx.stroke();
}

// Отрезки из плоского массива [x1,y1,x2,y2,...]
export function segments(ctx, segs) {
  ctx.beginPath();
  for (let i = 0; i < segs.length; i += 4) {
    ctx.moveTo(segs[i], segs[i + 1]);
    ctx.lineTo(segs[i + 2], segs[i + 3]);
  }
  ctx.stroke();
}

// Marching squares: изолиния поля nx×ny (значения в узлах) → отрезки в [x0..x0+w]×[y0..y0+h]
export function contours(field, nx, ny, level, out = [], x0 = 0, y0 = 0, w = 1, h = 1) {
  const sx = w / (nx - 1);
  const sy = h / (ny - 1);
  const lerp = (a, b) => (level - a) / (b - a || 1e-9);
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = field[j * nx + i];
      const b = field[j * nx + i + 1];
      const c = field[(j + 1) * nx + i + 1];
      const d = field[(j + 1) * nx + i];
      const idx = (a > level) | ((b > level) << 1) | ((c > level) << 2) | ((d > level) << 3);
      if (idx === 0 || idx === 15) continue;
      const X = x0 + i * sx;
      const Y = y0 + j * sy;
      // рёбра: 0 — верх (a-b), 1 — право (b-c), 2 — низ (d-c), 3 — лево (a-d)
      const e = (k) => {
        switch (k) {
          case 0: return [X + lerp(a, b) * sx, Y];
          case 1: return [X + sx, Y + lerp(b, c) * sy];
          case 2: return [X + lerp(d, c) * sx, Y + sy];
          default: return [X, Y + lerp(a, d) * sy];
        }
      };
      const seg = (p, q) => {
        const P = e(p);
        const Q = e(q);
        out.push(P[0], P[1], Q[0], Q[1]);
      };
      switch (idx) {
        case 1: case 14: seg(3, 0); break;
        case 2: case 13: seg(0, 1); break;
        case 3: case 12: seg(3, 1); break;
        case 4: case 11: seg(1, 2); break;
        case 6: case 9: seg(0, 2); break;
        case 7: case 8: seg(3, 2); break;
        case 5: seg(3, 0); seg(1, 2); break;
        case 10: seg(0, 1); seg(2, 3); break;
      }
    }
  }
  return out;
}

// Текст в единичных координатах: масштабируем через 1000, чтобы не упираться в минимальный кегль
export function text(ctx, str, x, y, size, opts = {}) {
  const { family = FONTS.text, weight = 400, align = 'center', baseline = 'middle', stroke = false, lw = LW } = opts;
  ctx.save();
  ctx.scale(0.001, 0.001);
  ctx.font = `${weight} ${size * 1000}px ${family}`;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  if (stroke) {
    ctx.lineWidth = lw * 1000;
    ctx.strokeText(str, x * 1000, y * 1000);
  } else {
    ctx.fillText(str, x * 1000, y * 1000);
  }
  ctx.restore();
}

// Перенос по словам (в пикселях текущего ctx.font)
export function wrapLines(ctx, str, maxW) {
  const words = str.split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(test).width <= maxW || !cur) cur = test;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

// Подбор кегля: самый крупный, при котором текст влезает в maxW×maxH
export function fitText(ctx, str, { family, weight = 400, maxW, maxH, max = 120, min = 40, lh = 1.08 }) {
  for (let size = max; size >= min; size -= 2) {
    ctx.font = `${weight} ${size}px ${family}`;
    const lines = wrapLines(ctx, str, maxW);
    const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
    if (lines.length * size * lh <= maxH && widest <= maxW) return { size, lines };
  }
  ctx.font = `${weight} ${min}px ${family}`;
  return { size: min, lines: wrapLines(ctx, str, maxW) };
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

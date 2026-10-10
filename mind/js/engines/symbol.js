// 8. Типографика и символ: геометрия из референсов + отдельные глифы для философских понятий
import { circle, line, star, dots, poly, text, FONTS, ease, TAU, DASH } from '../core/draw.js';
import { mulberry32, pick } from '../core/rng.js';

const PHI = (1 + Math.sqrt(5)) / 2;

// арка-«надгробие»: полукруг сверху, прямоугольник снизу
function arch(ctx, cx, cy, R, rot = 0, flip = false) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rot + (flip ? Math.PI : 0));
  ctx.beginPath();
  ctx.arc(0, 0, R, Math.PI, TAU);
  ctx.lineTo(R, R);
  ctx.lineTo(-R, R);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

const MODES = {
  // реф. 1: вложенные арки, каждая повёрнута на шаг — спираль
  arches: {
    create(p) { return { n: p.n || 13, ratio: p.ratio || 0.86, twist: p.twist ?? Math.PI / 12, t: 0 }; },
    draw(ctx, s) {
      const tw = s.twist * (1 + 0.45 * Math.sin(s.t * 0.3));
      const g = s.t * 0.04;
      let R = 0.47;
      for (let i = 0; i < s.n; i++) {
        arch(ctx, 0.5, 0.5, R, g + i * tw);
        arch(ctx, 0.5, 0.5, R, g + i * tw, true);
        R *= s.ratio;
      }
      star(ctx, 0.5, 0.5, 0.015);
    },
  },

  // реф. 2: арки, опирающиеся на общее основание, и их отражение
  stack: {
    create(p) { return { n: p.n || 8, t: 0 }; },
    draw(ctx, s) {
      const step = 0.034 * (1 + 0.35 * Math.sin(s.t * 0.45));
      for (let i = 0; i < s.n; i++) {
        const R = 0.49 - i * step;
        ctx.beginPath();
        ctx.arc(0.5, 0.5 + i * step, R, Math.PI, TAU);
        ctx.lineTo(0.5 + R, 0.995); ctx.lineTo(0.5 - R, 0.995); ctx.closePath();
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0.5, 0.5 - i * step, R, 0, Math.PI);
        ctx.lineTo(0.5 - R, 0.005); ctx.lineTo(0.5 + R, 0.005); ctx.closePath();
        ctx.stroke();
      }
      star(ctx, 0.5, 0.5, 0.015);
    },
  },

  // реф. 3: золотые квадраты, вписанные круги и спираль
  golden: {
    create() { return { t: 0 }; },
    draw(ctx, s) {
      const P = 9.5, ph = s.t % P, k = Math.min(11, ph * 1.6);
      const flip = Math.floor(s.t / P) % 2;
      ctx.save();
      if (flip) { ctx.translate(1, 0); ctx.scale(-1, 1); }
      let w = 0.92, h = w / PHI, x = 0.04, y = (1 - h) / 2;
      ctx.strokeRect(x, y, w, h);
      for (let i = 0; i < 11; i++) {
        if (i > k) break;
        const sq = Math.min(w, h), dir = i % 4;
        let sx, sy, cx, cy, a0;
        if (dir === 0) { sx = x; sy = y; cx = x + sq; cy = y + sq; a0 = Math.PI; x += sq; w -= sq; }
        else if (dir === 1) { sx = x; sy = y; cx = x; cy = y + sq; a0 = 1.5 * Math.PI; y += sq; h -= sq; }
        else if (dir === 2) { sx = x + w - sq; sy = y; cx = sx; cy = y; a0 = 0; w -= sq; }
        else { sx = x; sy = y + h - sq; cx = x + sq; cy = sy; a0 = 0.5 * Math.PI; h -= sq; }
        const part = Math.min(1, k - i);
        ctx.strokeRect(sx, sy, sq, sq);
        ctx.save(); ctx.setLineDash(DASH); circle(ctx, sx + sq / 2, sy + sq / 2, sq / 2); ctx.restore();
        ctx.beginPath(); ctx.arc(cx, cy, sq, a0, a0 + (Math.PI / 2) * part); ctx.stroke();
      }
      ctx.restore();
    },
  },

  // реф. 4: цепочки кругов, касающихся внешнего в одной точке
  orbits: {
    create(p) { return { k: p.k || 4, t: 0 }; },
    draw(ctx, s) {
      const R0 = 0.48, ratio = 0.62 + 0.05 * Math.sin(s.t * 0.4);
      circle(ctx, 0.5, 0.5, R0);
      for (let d = 0; d < s.k; d++) {
        const a = (d / s.k) * TAU + s.t * 0.06;
        let r = R0;
        for (let j = 0; j < 7; j++) {
          r *= ratio;
          circle(ctx, 0.5 + (R0 - r) * Math.cos(a), 0.5 + (R0 - r) * Math.sin(a), r);
        }
      }
      star(ctx, 0.5, 0.5, 0.015);
    },
  },

  // реф. 5: каждый следующий круг касается предыдущего изнутри, точка касания поворачивается
  spiral: {
    create(p) { return { chains: p.chains || 2, t: 0 }; },
    draw(ctx, s) {
      const spin = Math.PI / 4 + 0.35 * Math.sin(s.t * 0.22);
      circle(ctx, 0.5, 0.5, 0.48);
      for (let c = 0; c < s.chains; c++) {
        let x = 0.5, y = 0.5, R = 0.48;
        for (let j = 1; j <= 8; j++) {
          const r = R * 0.62, a = (c * TAU) / s.chains + j * spin + s.t * 0.05;
          x += (R - r) * Math.cos(a); y += (R - r) * Math.sin(a);
          circle(ctx, x, y, r);
          R = r;
        }
      }
      star(ctx, 0.5, 0.5, 0.015);
    },
  },

  // буква с построечными линиями
  monogram: {
    create(p) { return { ch: p.char || 'Я', t: 0 }; },
    draw(ctx, s) {
      const a = s.t * 0.15;
      circle(ctx, 0.5, 0.5, 0.44);
      ctx.save(); ctx.setLineDash(DASH);
      ctx.save(); ctx.translate(0.5, 0.5); ctx.rotate(a); ctx.strokeRect(-0.311, -0.311, 0.622, 0.622); ctx.restore();
      line(ctx, 0.06, 0.5, 0.94, 0.5); line(ctx, 0.5, 0.06, 0.5, 0.94);
      line(ctx, 0.19, 0.19, 0.81, 0.81); line(ctx, 0.81, 0.19, 0.19, 0.81);
      ctx.restore();
      text(ctx, s.ch, 0.5, 0.52, 0.56, { family: FONTS.display, weight: 400, stroke: true });
      const dx = 0.5 + 0.44 * Math.cos(a * 2), dy = 0.5 + 0.44 * Math.sin(a * 2);
      star(ctx, dx, dy, 0.016);
    },
  },

  // корабль Тесея: доски заменяются, старые собираются во второй корабль
  theseus: {
    create(p, rng) {
      const N = 24;
      return { N, order: Array.from({ length: N }, (_, i) => i).sort(() => rng() - 0.5), done: 0, acc: 0, hold: 0, t: 0, rng };
    },
    step(s, dt) {
      s.acc += dt;
      if (s.done < s.N && s.acc > 0.5) { s.acc = 0; s.done++; }
      else if (s.done >= s.N && s.acc > 4) Object.assign(s, MODES.theseus.create({}, s.rng));
    },
    draw(ctx, s) {
      const replaced = new Set(s.order.slice(0, s.done));
      const seg = TAU / s.N, gap = 0.035;
      for (let i = 0; i < s.N; i++) {
        const a0 = i * seg + gap - Math.PI / 2, a1 = (i + 1) * seg - gap - Math.PI / 2;
        ctx.beginPath(); ctx.arc(0.5, 0.5, 0.4, a0, a1); ctx.stroke();
        if (replaced.has(i)) {
          ctx.beginPath(); ctx.arc(0.5, 0.5, 0.42, a0, a1); ctx.stroke();
          ctx.beginPath(); ctx.arc(0.5, 0.5, 0.24, a0, a1); ctx.stroke();
        }
      }
      ctx.save(); ctx.setLineDash(DASH); circle(ctx, 0.5, 0.5, 0.24); ctx.restore();
      star(ctx, 0.5, 0.5, 0.02);
    },
  },

  // пещера Платона: вход, огонь, мерцающие тени
  cave: {
    create() { return { t: 0 }; },
    draw(ctx, s) {
      for (let i = 0; i < 7; i++) {
        const R = 0.46 - i * 0.03;
        ctx.beginPath();
        ctx.arc(0.5, 0.52 + i * 0.03, R, Math.PI, TAU);
        ctx.lineTo(0.5 + R, 0.98); ctx.lineTo(0.5 - R, 0.98); ctx.closePath();
        ctx.stroke();
      }
      const fl = 1 + 0.06 * Math.sin(s.t * 11) + 0.04 * Math.sin(s.t * 6.3);
      ctx.save();
      ctx.setLineDash([0.01, 0.008]);
      for (let k = 0; k < 3; k++) {
        const r = (0.05 + k * 0.035) * fl;
        ctx.beginPath(); ctx.ellipse(0.5, 0.42, r * 1.4, r, 0, 0, TAU); ctx.stroke();
      }
      ctx.restore();
      star(ctx, 0.5, 0.74, 0.03 * fl);
      for (const x of [0.38, 0.5, 0.62]) circle(ctx, x, 0.88, 0.022);
    },
  },

  // бритва Оккама: лишние гипотезы срезаются, остаётся простейшая
  occam: {
    create(p, rng) {
      const pts = [[0.46, 0.46], [0.56, 0.5], [0.49, 0.57]];
      const cx = (0.46 + 0.56 + 0.49) / 3, cy = (0.46 + 0.5 + 0.57) / 3;
      const hyp = [];
      for (let i = 0; i < 13; i++) {
        const a = rng() * TAU, d = 0.03 + rng() * 0.22;
        const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
        const r = Math.max(...pts.map(([px, py]) => Math.hypot(px - x, py - y))) + 0.02 + rng() * 0.05;
        hyp.push([x, y, r]);
      }
      const best = [cx, cy, Math.max(...pts.map(([px, py]) => Math.hypot(px - cx, py - cy))) + 0.015];
      hyp.sort((a, b) => b[2] - a[2]);
      return { pts, hyp, best, t: 0, rng };
    },
    step(s, dt) {
      s.t += dt;
      if (s.t > 12) Object.assign(s, MODES.occam.create({}, s.rng));
    },
    draw(ctx, s) {
      const cut = Math.max(0, (s.t - 1.5) / 7);
      s.hyp.forEach(([x, y, r], i) => {
        const gone = cut * s.hyp.length - i;
        if (gone >= 1) return;
        if (gone > 0) return; // срезанная гипотеза исчезает сразу, без полутона
        circle(ctx, x, y, r);
      });
      circle(ctx, ...s.best);
      dots(ctx, s.pts.map((p) => p[0]), s.pts.map((p) => p[1]), 0.007);
      const rx = -0.1 + Math.min(1, cut) * 1.2;
      if (cut < 1) { line(ctx, rx, 0.02, rx - 0.12, 0.98); star(ctx, rx, 0.02, 0.016); }
    },
  },

  // когнитивный диссонанс: две системы колец, которые не совпадают
  dissonance: {
    create() { return { t: 0 }; },
    draw(ctx, s) {
      const d = 0.065 * Math.sin(s.t * 0.3);
      for (let k = 1; k <= 17; k++) {
        circle(ctx, 0.5 - d, 0.5, k * 0.028);
        circle(ctx, 0.5 + d, 0.5, k * 0.028);
      }
      star(ctx, 0.5 - d, 0.5, 0.012);
      star(ctx, 0.5 + d, 0.5, 0.012);
    },
  },

  // апофения: в случайных точках проступает лицо
  apophenia: {
    create(p, rng) {
      const xs = [], ys = [];
      for (let i = 0; i < 80; i++) { xs.push(0.06 + rng() * 0.88); ys.push(0.06 + rng() * 0.88); }
      const near = (x, y, used) => {
        let best = -1, bd = Infinity;
        xs.forEach((px, i) => { const d = Math.hypot(px - x, ys[i] - y); if (d < bd && !used.has(i)) { bd = d; best = i; } });
        used.add(best);
        return best;
      };
      const used = new Set();
      const eyes = [near(0.37, 0.4, used), near(0.63, 0.4, used)];
      const mouth = [0.3, 0.4, 0.5, 0.6, 0.7].map((x) => near(x, 0.64 + 0.07 * Math.sin(((x - 0.3) / 0.4) * Math.PI), used));
      return { xs, ys, eyes, mouth, t: 0, rng };
    },
    step(s, dt) {
      s.t += dt;
      if (s.t > 8) Object.assign(s, MODES.apophenia.create({}, s.rng));
    },
    draw(ctx, s) {
      const a = Math.min(1, s.t / 1.2) * (s.t > 7 ? Math.max(0, 8 - s.t) : 1);
      dots(ctx, s.xs, s.ys, 0.005);
      if (a < 0.5) return; // лицо появляется и исчезает целиком
      ctx.save();
      if (s.t > 1.2) s.eyes.forEach((i) => { circle(ctx, s.xs[i], s.ys[i], 0.03); circle(ctx, s.xs[i], s.ys[i], 0.05); });
      const m = Math.min(1, Math.max(0, (s.t - 2.4) / 2)) * (s.mouth.length - 1);
      const pts = [];
      for (let k = 0; k <= Math.floor(m); k++) pts.push(s.xs[s.mouth[k]], s.ys[s.mouth[k]]);
      const f = m - Math.floor(m), k = Math.floor(m);
      if (k < s.mouth.length - 1 && f > 0) {
        const A = s.mouth[k], B = s.mouth[k + 1];
        pts.push(s.xs[A] + (s.xs[B] - s.xs[A]) * f, s.ys[A] + (s.ys[B] - s.ys[A]) * f);
      }
      poly(ctx, pts);
      ctx.restore();
    },
  },

  // апория Зенона: каждый шаг вдвое короче предыдущего
  zeno: {
    create() { return { t: 0 }; },
    draw(ctx, s) {
      const P = 10, ph = s.t % P, k = Math.min(14, Math.floor(ph / 0.55));
      const X = (n) => 0.94 - 0.88 / 2 ** n;
      line(ctx, 0.04, 0.6, 0.96, 0.6);
      for (let n = 0; n < k; n++) {
        const a = X(n), b = X(n + 1), r = (b - a) / 2;
        ctx.beginPath(); ctx.arc(a + r, 0.6, r, Math.PI, TAU); ctx.stroke();
        ctx.save(); ctx.setLineDash(DASH); ctx.beginPath(); ctx.arc(a + r, 0.6, r, 0, Math.PI); ctx.stroke(); ctx.restore();
      }
      const u = ease(Math.min(1, (ph % 0.55) / 0.55));
      const hx = k >= 14 ? X(14) : X(k) + (X(k + 1) - X(k)) * u;
      star(ctx, hx, 0.6, 0.016);
      circle(ctx, 0.94, 0.6, 0.012);
    },
  },

  // Сизиф: камень почти у вершины — и снова вниз
  sisyphus: {
    create() { return { t: 0 }; },
    draw(ctx, s) {
      const ax = 0.06, ay = 0.9, bx = 0.94, by = 0.24, L = Math.hypot(bx - ax, by - ay);
      const ux = (bx - ax) / L, uy = (by - ay) / L, nx = uy, ny = -ux, R = 0.07;
      const P = 10, ph = s.t % P;
      const u = ph < 8.4 ? ease(ph / 8.4) * 0.86 : 0.86 * (1 - ease((ph - 8.4) / 1.6));
      const d = 0.04 + u * (L - 0.2);
      const cx = ax + ux * d - nx * R * -1, cy = ay + uy * d - ny * R * -1;
      line(ctx, 0.02, ay + (0.02 - ax) * (uy / ux), 0.98, ay + (0.98 - ax) * (uy / ux));
      const rot = -d / R;
      circle(ctx, cx, cy, R);
      circle(ctx, cx, cy, R * 0.55);
      for (let k = 0; k < 3; k++) {
        const a = rot + (k * Math.PI) / 3;
        line(ctx, cx + Math.cos(a) * R * 0.55, cy + Math.sin(a) * R * 0.55, cx + Math.cos(a) * R, cy + Math.sin(a) * R);
        line(ctx, cx - Math.cos(a) * R * 0.55, cy - Math.sin(a) * R * 0.55, cx - Math.cos(a) * R, cy - Math.sin(a) * R);
      }
      star(ctx, bx - ux * 0.03 + nx * 0.05, by - uy * 0.03 + ny * 0.05, 0.02);
    },
  },

  // Даннинг — Крюгер: «пик глупости», долина и медленный подъём
  dk: {
    create() { return { t: 0 }; },
    draw(ctx, s) {
      const f = (x) => 0.12 + 0.72 * Math.exp(-(((x - 0.13) / 0.075) ** 2)) + 0.55 / (1 + Math.exp(-(x - 0.62) * 9)) - 0.08 * x;
      const P = 9, ph = s.t % P, m = Math.min(1, ph / 6);
      line(ctx, 0.08, 0.92, 0.94, 0.92);
      line(ctx, 0.08, 0.92, 0.08, 0.06);
      const pts = [];
      const N = 240, n = Math.floor(m * N);
      for (let i = 0; i <= n; i++) { const x = i / N; pts.push(0.08 + x * 0.86, 0.92 - f(x) * 0.95); }
      poly(ctx, pts);
      if (n > 0) star(ctx, pts[pts.length - 2], pts[pts.length - 1], 0.018);
    },
  },
};

const AUTO = ['arches', 'stack', 'orbits', 'spiral', 'golden', 'dissonance'];

export default {
  id: 'symbol',
  create(p, rng) {
    const mode = p.mode === 'auto' || !p.mode ? pick(rng, AUTO) : p.mode;
    const local = mulberry32((rng() * 1e9) | 0);
    const st = MODES[mode].create(p, local);
    return { mode, ...st };
  },
  step(s, dt) {
    if (MODES[s.mode].step) MODES[s.mode].step(s, dt);
    else s.t += dt;
  },
  draw(ctx, s, env) {
    s.paper = env.paper;
    MODES[s.mode].draw(ctx, s);
  },
};

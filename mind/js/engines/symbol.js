// 8. Типографика и символ: геометрия из референсов + отдельные глифы для философских понятий
import { circle, line, dot, dots, poly, text, FONTS, ease, TAU, DASH } from '../core/draw.js';
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
      // арка повёрнута, её угол уходит на R·√2 — держим его внутри квадрата
      let R = 0.335;
      for (let i = 0; i < s.n; i++) {
        arch(ctx, 0.5, 0.5, R, g + i * tw);
        arch(ctx, 0.5, 0.5, R, g + i * tw, true);
        R *= s.ratio;
      }
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
      dot(ctx, dx, dy, 0.006);
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
      dot(ctx, 0.5, 0.74, 0.012 * fl);
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
        const a = rng() * TAU, d = 0.02 + rng() * 0.12;
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
      const rx = 0.14 + Math.min(1, cut) * 0.84;
      if (cut < 1) { line(ctx, rx, 0.02, rx - 0.12, 0.98); dot(ctx, rx, 0.02, 0.006); }
    },
  },

  // когнитивный диссонанс: две системы колец, которые не совпадают
  dissonance: {
    create() { return { t: 0 }; },
    draw(ctx, s) {
      const d = 0.065 * Math.sin(s.t * 0.3);
      for (let k = 1; k <= 15; k++) {
        circle(ctx, 0.5 - d, 0.5, k * 0.028);
        circle(ctx, 0.5 + d, 0.5, k * 0.028);
      }
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
      dot(ctx, hx, 0.6, 0.006);
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
      const d = 0.12 + u * (L - 0.28);
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
      dot(ctx, bx - ux * 0.03 + nx * 0.05, by - uy * 0.03 + ny * 0.05, 0.007);
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
      if (n > 0) dot(ctx, pts[pts.length - 2], pts[pts.length - 1], 0.007);
    },
  },

  // кот Шрёдингера: в закрытой коробке кот и жив, и мёртв; открыли — остался один
  schrodinger: {
    create(p, rng) { return { fate: Array.from({ length: 16 }, () => rng() < 0.5), t: 0 }; },
    draw(ctx, s) {
      const P = 9, ph = s.t % P, cyc = Math.floor(s.t / P);
      const x0 = 0.16, x1 = 0.84, y0 = 0.3, y1 = 0.84, cx = 0.5, cy = 0.6, L = (x1 - x0) / 2, r = 0.105;
      // крышка: открывается 4.6–5.3, открыта до 7, закрывается к 7.7
      const open = ph < 4.6 ? 0 : ph < 5.3 ? ease((ph - 4.6) / 0.7) : ph < 7 ? 1 : ph < 7.7 ? 1 - ease((ph - 7) / 0.7) : 0;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0, y1); ctx.lineTo(x1, y1); ctx.lineTo(x1, y0); ctx.stroke();
      const a = open * 0.78;
      line(ctx, x0, y0, x0 + L * Math.cos(a), y0 - L * Math.sin(a));
      line(ctx, x1, y0, x1 - L * Math.cos(a), y0 - L * Math.sin(a));
      // время в закрытой коробке: непрерывно через границу цикла
      const tau = ph >= 7.7 ? ph - 7.7 : Math.min(ph, 4.6) + (P - 7.7);
      const phi = tau * 1.25;
      const alive = s.fate[cyc % s.fate.length];
      if (ph >= 4.6 && ph < 7.7) {
        const k = 1 - ease(Math.min(1, (ph - 4.6) / 0.7));
        const sgn = alive ? 1 : -1;
        catHead(ctx, cx + sgn * 0.095 * Math.cos(phi) * k, cy + sgn * 0.022 * Math.sin(phi) * k, r, alive, false);
        return;
      }
      const m = Math.min(1, tau / 1.2), c = Math.cos(phi) * m * 0.095, sn = Math.sin(phi) * m * 0.022;
      // ближний к зрителю — сплошной, дальний — пунктир
      catHead(ctx, cx - c, cy - sn, r, false, sn > 0);
      catHead(ctx, cx + c, cy + sn, r, true, sn <= 0);
    },
  },

  // буриданов осёл: ровно посередине между одинаковыми стогами, колеблется и не выбирает
  buridan: {
    create() { return { t: 0 }; },
    draw(ctx, s) {
      const P = 11, ph = s.t % P, gy = 0.84, px = 0.5, py = 0.14, L = 0.6, A0 = 0.19;
      const ang = (u) => A0 * Math.exp(-u * 0.38) * (1 - Math.exp(-u * 3)) * Math.sin(u * 2.6);
      line(ctx, 0.05, gy, 0.95, gy);
      for (const sx of [0.215, 0.785]) {
        for (const R of [0.165, 0.12, 0.075, 0.03]) {
          ctx.beginPath(); ctx.arc(sx, gy, R, Math.PI, TAU); ctx.stroke();
        }
      }
      line(ctx, px - 0.06, py, px + 0.06, py);
      // пунктир: ось симметрии и дуга возможного размаха
      ctx.save(); ctx.setLineDash(DASH);
      ctx.beginPath(); ctx.arc(px, py, L, Math.PI / 2 - A0, Math.PI / 2 + A0); ctx.stroke();
      line(ctx, px, py + L + 0.03, px, gy);
      ctx.restore();
      const a = ang(ph), bx = px + L * Math.sin(a), by = py + L * Math.cos(a);
      line(ctx, px, py, bx - 0.02 * Math.sin(a), by - 0.02 * Math.cos(a));
      circle(ctx, bx, by, 0.02);
      dot(ctx, bx, by, 0.006);
    },
  },

  // парадокс кучи: песчинки убывают по одной, а куча всё ещё похожа на кучу
  sorites: {
    create(p, rng) {
      const base = 0.7, H = 0.38, W = 0.38, dx = 0.029, dy = 0.0252;
      const h = (x) => H * (1 - ((x - 0.5) / W) ** 2);
      const g = [];
      for (let j = 0; ; j++) {
        const y = base - 0.011 - j * dy;
        if (base - y > H) break;
        for (let x = 0.5 - W + (j % 2 ? dx : dx / 2); x < 0.5 + W; x += dx) {
          if (base - y > h(x) - 0.008) continue;
          g.push([x + (rng() - 0.5) * 0.005, y + (rng() - 0.5) * 0.004, (base - y) / h(x) + rng() * 0.3]);
        }
      }
      // первыми в массиве — те, что останутся дольше всех
      g.sort((a, b) => a[2] - b[2]);
      const outline = [];
      for (let i = 0; i <= 60; i++) { const x = 0.5 - W + (2 * W * i) / 60; outline.push(x, base - h(x)); }
      return { xs: g.map((q) => q[0]), ys: g.map((q) => q[1]), outline, base, t: 0 };
    },
    draw(ctx, s) {
      const P = 13, ph = s.t % P, N = s.xs.length;
      let n;
      if (ph < 1.2) n = N;
      else if (ph < 9.2) n = N - Math.floor(((ph - 1.2) / 8) * (N - 1));
      else if (ph < 10.8) n = 1;
      else if (ph < 12.6) n = 1 + Math.floor(ease((ph - 10.8) / 1.8) * (N - 1));
      else n = N;
      line(ctx, 0.06, s.base, 0.94, s.base);
      ctx.save(); ctx.setLineDash(DASH); poly(ctx, s.outline); ctx.restore();
      dots(ctx, s.xs, s.ys, 0.0085, Math.max(1, Math.min(N, n)));
    },
  },

  // мозг в колбе: всё, что он знает о мире, приходит по проводам
  vat: {
    create() {
      const wires = [];
      const xs = [0.3, 0.32, 0.34], ys = [0.15, 0.19, 0.23], Xs = [0.82, 0.74, 0.66];
      for (let i = 0; i < 3; i++) {
        const pts = [xs[i], 0.6, xs[i], ys[i], Xs[i], ys[i], Xs[i], 0.47];
        let len = 0; const cum = [0];
        for (let k = 2; k < pts.length; k += 2) { len += Math.hypot(pts[k] - pts[k - 2], pts[k + 1] - pts[k - 1]); cum.push(len); }
        wires.push({ pts, cum, len });
      }
      // мозг: бугристый контур и извилины
      const brain = [];
      const bx = 0.32, by = 0.665;
      for (let i = 0; i <= 120; i++) {
        const a = (i / 120) * TAU, r = 1 + 0.06 * Math.sin(a * 11);
        brain.push(bx + 0.1 * r * Math.cos(a), by + 0.07 * r * Math.sin(a));
      }
      const folds = [];
      for (const [k, w] of [[-1, 0.62], [0, 0.82], [1, 0.62]]) {
        const f = [];
        for (let i = 0; i <= 40; i++) {
          const u = i / 40 - 0.5;
          f.push(bx + u * 0.2 * w, by + k * 0.027 + 0.009 * Math.sin(u * (19 + 4 * k) + k * 2));
        }
        folds.push(f);
      }
      return { wires, brain, folds, bx, by, t: 0 };
    },
    draw(ctx, s) {
      const fx = 0.32, fy = 0.64, fr = 0.19, nw = 0.045, d = Math.asin(nw / fr), ny = fy - fr * Math.cos(d), top = 0.3;
      ctx.beginPath(); ctx.arc(fx, fy, fr, -Math.PI / 2 + d, 1.5 * Math.PI - d); ctx.stroke();
      line(ctx, fx - nw, ny, fx - nw, top); line(ctx, fx + nw, ny, fx + nw, top);
      line(ctx, fx - nw - 0.015, top, fx - nw, top); line(ctx, fx + nw, top, fx + nw + 0.015, top);
      ctx.save(); ctx.setLineDash(DASH);
      const ly = fy - 0.1, lw = Math.sqrt(fr * fr - 0.01);
      line(ctx, fx - lw, ly, fx + lw, ly);
      ctx.restore();
      poly(ctx, s.brain);
      for (const f of s.folds) poly(ctx, f);
      line(ctx, s.bx + 0.025, s.by + 0.07, s.bx + 0.035, s.by + 0.115);
      // «мир» — квадрат-симуляция; его содержимое пунктиром
      const X0 = 0.6, Y0 = 0.47, S = 0.28;
      ctx.strokeRect(X0, Y0, S, S);
      ctx.save(); ctx.setLineDash(DASH);
      line(ctx, X0 + 0.02, Y0 + 0.2, X0 + S - 0.02, Y0 + 0.2);
      poly(ctx, [X0 + 0.03, Y0 + 0.2, X0 + 0.1, Y0 + 0.12, X0 + 0.15, Y0 + 0.16, X0 + 0.2, Y0 + 0.1, X0 + 0.26, Y0 + 0.2]);
      circle(ctx, X0 + 0.07, Y0 + 0.07, 0.025);
      ctx.restore();
      for (let i = 0; i < 3; i++) {
        const w = s.wires[i];
        poly(ctx, w.pts);
        for (let k = 0; k < 2; k++) {
          let u = (s.t * 0.16 + k / 2 + i * 0.29) % 1;
          if (i < 2) u = 1 - u; // из мира к мозгу
          const L = u * w.len;
          let j = 1;
          while (j < w.cum.length - 1 && w.cum[j] < L) j++;
          const f = (L - w.cum[j - 1]) / (w.cum[j] - w.cum[j - 1] || 1);
          const p = w.pts;
          dot(ctx, p[j * 2 - 2] + (p[j * 2] - p[j * 2 - 2]) * f, p[j * 2 - 1] + (p[j * 2 + 1] - p[j * 2 - 1]) * f, 0.006);
        }
      }
    },
  },

  // отель Гильберта: бесконечный ряд комнат, все гости сдвигаются на одну — первая свободна
  hotel: {
    create() { return { t: 0 }; },
    draw(ctx, s) {
      const q = 0.68, X0 = 0.08, W0 = 0.24, H0 = 0.62, cy = 0.5, C = (W0 * 1.12) / (1 - q);
      const room = (k) => { const f = q ** k; return [X0 + C * (1 - f), W0 * f, H0 * f]; };
      ctx.save(); ctx.setLineDash(DASH);
      line(ctx, X0, cy + H0 / 2, X0 + C, cy);
      line(ctx, X0 + W0 / 2, cy - H0 / 2, X0 + C, cy);
      ctx.restore();
      for (let k = 0; k < 13; k++) {
        const [x, w, h] = room(k), top = cy - h / 2;
        ctx.beginPath();
        ctx.moveTo(x, cy + h / 2); ctx.lineTo(x, top + w / 2);
        ctx.arc(x + w / 2, top + w / 2, w / 2, Math.PI, TAU);
        ctx.lineTo(x + w, cy + h / 2); ctx.closePath(); ctx.stroke();
      }
      const P = 7, ph = s.t % P;
      const shift = ph < 1.5 ? 0 : ph < 3.5 ? ease((ph - 1.5) / 2) : 1;
      const guest = (k) => { const [x, w, h] = room(k); return [x + w / 2, cy + h * 0.22, Math.max(0.0018, Math.min(0.008, w * 0.045))]; };
      for (let k = 0; k < 14; k++) {
        const [gx, gy, r] = guest(k + shift);
        dot(ctx, gx, gy, r);
      }
      const [g0x, g0y] = guest(0);
      if (ph >= 3.5 && ph < 5) { ctx.save(); ctx.setLineDash(DASH); circle(ctx, g0x, g0y, 0.02); ctx.restore(); }
      if (ph >= 5) {
        const u = ease(Math.min(1, (ph - 5) / 1.6));
        dot(ctx, 0.04 + (g0x - 0.04) * u, g0y, 0.008);
      }
    },
  },

  // лента Мёбиуса: одна сторона, один край; путник возвращается «с изнанки»
  mobius: {
    create() { return { t: 0, p: [0, 0, 0] }; },
    draw(ctx, s) {
      const R = 0.3, w = 0.13, tilt = 0.62 + 0.14 * Math.sin(s.t * 0.17), spin = s.t * 0.12;
      const ct = Math.cos(tilt), st = Math.sin(tilt), cs = Math.cos(spin), ss = Math.sin(spin), o = s.p;
      const P = (u, v) => {
        const c = R + v * Math.cos(u / 2), x = c * Math.cos(u), y = c * Math.sin(u), z = v * Math.sin(u / 2);
        const x1 = x * cs - y * ss, y1 = x * ss + y * cs;
        o[0] = 0.5 + x1; o[1] = 0.5 + y1 * ct - z * st; o[2] = y1 * st + z * ct;
        return o;
      };
      // край — одна замкнутая кривая на 4π
      ctx.beginPath();
      for (let i = 0; i <= 200; i++) { P((i / 200) * 2 * TAU, w); i ? ctx.lineTo(o[0], o[1]) : ctx.moveTo(o[0], o[1]); }
      ctx.stroke();
      // поперечные образующие: ближние сплошные, дальние пунктиром
      const front = [], back = [];
      for (let i = 0; i < 36; i++) {
        const u = (i / 36) * TAU;
        P(u, 0); const dz = o[2];
        P(u, -w); const ax = o[0], ay = o[1];
        P(u, w);
        (dz > 0 ? front : back).push(ax, ay, o[0], o[1]);
      }
      const seg = (arr) => { ctx.beginPath(); for (let i = 0; i < arr.length; i += 4) { ctx.moveTo(arr[i], arr[i + 1]); ctx.lineTo(arr[i + 2], arr[i + 3]); } ctx.stroke(); };
      seg(front);
      ctx.save(); ctx.setLineDash(DASH); seg(back); ctx.restore();
      // путник: за один оборот попадает на «другую сторону», за два — возвращается
      const T = 16, uu = ((s.t % T) / T) * 2 * TAU;
      ctx.beginPath();
      for (let i = 0; i <= 120; i++) { P((i / 120) * uu, w * 0.55); i ? ctx.lineTo(o[0], o[1]) : ctx.moveTo(o[0], o[1]); }
      ctx.lineWidth *= 2; ctx.stroke(); ctx.lineWidth /= 2;
      P(uu, w * 0.55);
      dot(ctx, o[0], o[1], 0.008);
    },
  },

  // окно Овертона: рамка допустимого медленно ползёт по шкале идей
  overton: {
    create(p, rng) {
      const xs = [], ys = [];
      for (let tries = 0; xs.length < 30 && tries < 2000; tries++) {
        const x = 0.27 + rng() * 0.46, y = 0.08 + rng() * 0.84;
        if (Math.abs(x - 0.5) < 0.03) continue;
        if (xs.some((px, i) => Math.hypot(px - x, ys[i] - y) < 0.06)) continue;
        xs.push(x); ys.push(y);
      }
      return { xs, ys, ix: [], iy: [], t: 0 };
    },
    draw(ctx, s) {
      line(ctx, 0.5, 0.06, 0.5, 0.94);
      for (let i = 0; i <= 6; i++) { const y = 0.06 + (i * 0.88) / 6; line(ctx, 0.47, y, 0.53, y); }
      for (let i = 0; i < 6; i++) { const y = 0.06 + ((i + 0.5) * 0.88) / 6; line(ctx, 0.485, y, 0.515, y); }
      const wy = 0.5 + 0.26 * Math.sin(s.t * 0.21) + 0.04 * Math.sin(s.t * 0.57 + 1), wh = 0.26;
      const x0 = 0.2, x1 = 0.8, y0 = wy - wh / 2, y1 = wy + wh / 2;
      ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
      ctx.strokeRect(x0 + 0.014, y0 + 0.014, x1 - x0 - 0.028, y1 - y0 - 0.028);
      const ix = s.ix, iy = s.iy; ix.length = 0; iy.length = 0;
      const ox = [], oy = [];
      for (let i = 0; i < s.xs.length; i++) {
        const inside = s.ys[i] > y0 + 0.024 && s.ys[i] < y1 - 0.024;
        (inside ? ix : ox).push(s.xs[i]); (inside ? iy : oy).push(s.ys[i]);
      }
      dots(ctx, ix, iy, 0.008);
      dots(ctx, ox, oy, 0.008, ox.length, 'stroke');
    },
  },

  // пирамида Маслоу: уровни заполняются снизу вверх, вершина не удерживается
  maslow: {
    create() { return { t: 0, segs: [] }; },
    draw(ctx, s) {
      const ax = 0.5, ay = 0.1, by = 0.88, bw = 0.4, n = 5, Hl = (by - ay) / n, gap = 0.008;
      const hw = (y) => (bw * (y - ay)) / (by - ay);
      const P = 16, ph = s.t % P;
      const top = (u) => (u < 5.6 ? 0 : u < 6.8 ? (u - 5.6) / 1.2 : u < 7.8 ? 1 : u < 8.6 ? 1 - (u - 7.8) / 0.8
        : u < 9.4 ? 0 : u < 10.6 ? (u - 9.4) / 1.2 : u < 11.6 ? 1 : u < 12.4 ? 1 - (u - 11.6) / 0.8
        : u < 12.9 ? 0 : u < 14.1 ? (u - 12.9) / 1.2 : 1);
      const drain = ph < 15 ? 1 : 1 - (ph - 15);
      const segs = s.segs; segs.length = 0;
      for (let i = 0; i < n; i++) {
        const yb = by - i * Hl - (i ? gap : 0), yt = by - (i + 1) * Hl + gap;
        const yT = i === n - 1 ? ay : yt;
        ctx.beginPath();
        ctx.moveTo(ax - hw(yb), yb); ctx.lineTo(ax + hw(yb), yb);
        ctx.lineTo(ax + hw(yT), yT);
        if (i < n - 1) ctx.lineTo(ax - hw(yT), yT);
        ctx.closePath(); ctx.stroke();
        let f = i < n - 1 ? Math.min(1, Math.max(0, (ph - 0.3 - 1.3 * i) / 1.3)) : top(ph);
        f = Math.min(f, drain);
        const yf = yb - (yb - yT) * f;
        for (let y = yb - 0.018; y > yf + 0.002 && y > yT + 0.01; y -= 0.018) {
          const h = hw(y) - 0.012;
          if (h > 0.006) segs.push(ax - h, y, ax + h, y);
        }
      }
      ctx.beginPath();
      for (let i = 0; i < segs.length; i += 4) { ctx.moveTo(segs[i], segs[i + 1]); ctx.lineTo(segs[i + 2], segs[i + 3]); }
      ctx.stroke();
    },
  },

  // эффект якоря: оценки стягиваются к случайному числу, а не к истине
  anchor: {
    create(p, rng) {
      const A = 0.3, T = 0.72, N = 24, bin = 0.03, gy = 0.46;
      const est = [], stacks = {};
      for (let i = 0; i < N; i++) {
        const sx = T + (rng() - 0.5) * 0.12;
        let fx = A + (T - A) * 0.3 + (rng() + rng() + rng() - 1.5) * 0.1;
        fx = Math.min(0.88, Math.max(0.12, fx));
        const b = Math.round(fx / bin);
        const k = stacks[b] = (stacks[b] || 0) + 1;
        est.push([sx, b * bin, gy - 0.017 - (k - 1) * 0.027, 0.6 + i * 0.32]);
      }
      return { est, A, T, gy, t: 0, rng };
    },
    step(s, dt) {
      s.t += dt;
      if (s.t > 12.5) Object.assign(s, MODES.anchor.create({}, s.rng));
    },
    draw(ctx, s) {
      const { A, T, gy } = s;
      line(ctx, 0.08, gy, 0.92, gy);
      for (let i = 0; i <= 12; i++) { const x = 0.08 + i * 0.07; line(ctx, x, gy, x, gy + (i % 3 ? 0.012 : 0.022)); }
      ctx.save(); ctx.setLineDash(DASH); line(ctx, T, gy, T, 0.08); ctx.restore();
      circle(ctx, T, gy, 0.012);
      // якорь на цепи
      dot(ctx, A, gy, 0.011);
      for (let j = 0; j < 3; j++) {
        const y = gy + 0.032 + j * 0.036;
        if (j % 2 === 0) { ctx.beginPath(); ctx.ellipse(A, y, 0.011, 0.021, 0, 0, TAU); ctx.stroke(); }
        else line(ctx, A, y - 0.02, A, y + 0.02);
      }
      const ry = gy + 0.15, ab = gy + 0.4;
      circle(ctx, A, ry, 0.02);
      line(ctx, A, ry + 0.02, A, ab);
      line(ctx, A - 0.065, ry + 0.055, A + 0.065, ry + 0.055);
      const ar = 0.12, aa = 0.32, ac = ab - ar;
      ctx.beginPath(); ctx.arc(A, ac, ar, aa, Math.PI - aa); ctx.stroke();
      for (const sg of [-1, 1]) {
        const ex = A + sg * ar * Math.cos(aa), ey = ac + ar * Math.sin(aa);
        line(ctx, ex, ey, ex + sg * 0.012, ey - 0.04);
        line(ctx, ex, ey, ex - sg * 0.03, ey - 0.012);
      }
      for (const [sx, fx, fy, t0] of s.est) {
        if (s.t < t0) continue;
        const u = Math.min(1, (s.t - t0) / 1.6), e = ease(u);
        dot(ctx, sx + (fx - sx) * e, 0.1 + (fy - 0.1) * u, 0.008);
      }
    },
  },
};

// голова кота: живой — глаза-точки, мёртвый — крестики
function catHead(ctx, x, y, r, alive, dashed) {
  ctx.save();
  if (dashed) ctx.setLineDash(DASH);
  circle(ctx, x, y, r);
  for (const sg of [-1, 1]) {
    const a1 = -Math.PI / 2 + sg * 0.42, a2 = -Math.PI / 2 + sg * 1.05;
    ctx.beginPath();
    ctx.moveTo(x + r * Math.cos(a1), y + r * Math.sin(a1));
    ctx.lineTo(x + sg * 0.72 * r, y - 1.45 * r);
    ctx.lineTo(x + r * Math.cos(a2), y + r * Math.sin(a2));
    ctx.stroke();
    line(ctx, x + sg * 0.42 * r, y + 0.28 * r, x + sg * 1.35 * r, y + 0.14 * r);
    line(ctx, x + sg * 0.42 * r, y + 0.36 * r, x + sg * 1.35 * r, y + 0.5 * r);
    const ex = x + sg * 0.38 * r, ey = y - 0.08 * r, e = 0.12 * r;
    if (alive) dot(ctx, ex, ey, 0.09 * r);
    else { line(ctx, ex - e, ey - e, ex + e, ey + e); line(ctx, ex - e, ey + e, ex + e, ey - e); }
  }
  ctx.restore();
}

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

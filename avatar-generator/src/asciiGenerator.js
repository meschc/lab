'use strict';

// Рамп яркости: от светлого (фон) к тёмному (плотные символы).
const RAMP = ' .:-=+*#%@';

const W = 44; // столбцов
const H = 26; // строк
const PALETTE_STEPS = 6;

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// --- Цвет -----------------------------------------------------------------

function hslHex(h, s, l) {
  h /= 360;
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const to = (v) => Math.round(v * 255).toString(16).padStart(2, '0');
  return '#' + to(hue2rgb(p, q, h + 1 / 3)) + to(hue2rgb(p, q, h)) + to(hue2rgb(p, q, h - 1 / 3));
}

// Многоцветная палитра: от светлого к тёмному, с "путешествием" по тону,
// чтобы цвета реально были разными.
function buildPalette() {
  const h0 = rand(0, 360);
  // Крупный разброс по тону -> в одной аватарке реально разные цвета.
  const spread = pick([-200, -160, -120, 120, 160, 200]);
  const cols = [];
  for (let i = 0; i < PALETTE_STEPS; i++) {
    const t = i / (PALETTE_STEPS - 1);
    const h = (h0 + spread * t + 360) % 360;
    const s = 0.62 + 0.2 * t;
    const l = 0.72 - 0.38 * t;
    cols.push(hslHex(h, s, l));
  }
  return cols;
}

// --- Абстрактный симметричный узор ----------------------------------------

function generateAvatar() {
  // Несколько "метаболлов" (сгустков) со случайным знаком + кольцо.
  const blobs = [];
  const n = 2 + Math.floor(Math.random() * 3); // 2..4
  for (let i = 0; i < n; i++) {
    blobs.push({
      bx: rand(0.0, 0.7),
      by: rand(-0.7, 0.7),
      br: rand(0.18, 0.42),
      sign: Math.random() < 0.75 ? 1 : -1
    });
  }
  const ringK = rand(3, 7);
  const ringAmp = rand(0.0, 0.35);
  const dither = 0.18;

  // Проход 1: считаем "сырое" поле и его диапазон.
  const raw = new Float64Array(W * H);
  let mn = Infinity;
  let mx = -Infinity;
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const nx = (c / (W - 1)) * 2 - 1;
      const ny = (r / (H - 1)) * 2 - 1;
      const ax = Math.abs(nx); // симметрия по вертикали

      let v = 0;
      for (const b of blobs) {
        const dx = ax - b.bx;
        const dy = ny - b.by;
        const d2 = dx * dx + dy * dy;
        v += b.sign * (b.br * b.br) / (d2 + b.br * b.br);
      }
      const radius = Math.sqrt(ax * ax + ny * ny);
      v += ringAmp * Math.cos(radius * ringK);

      raw[r * W + c] = v;
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
  }

  // Проход 2: нормализация в [0,1] -> картинка всегда заполнена + дизеринг.
  const span = (mx - mn) || 1;
  const rows = [];
  for (let r = 0; r < H; r++) {
    let line = '';
    for (let c = 0; c < W; c++) {
      let v = (raw[r * W + c] - mn) / span;
      v += (Math.random() - 0.5) * dither;
      v = Math.max(0, Math.min(1, v));
      line += RAMP[Math.round(v * (RAMP.length - 1))];
    }
    rows.push(line);
  }

  return { ascii: rows.join('\n'), colors: buildPalette() };
}

module.exports = { generateAvatar, RAMP };

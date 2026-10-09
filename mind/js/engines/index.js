// Реестр движков и общий рендер кадра в квадрат
import curves from './curves.js';
import fractals from './fractals.js';
import automata from './automata.js';
import particles from './particles.js';
import waves from './waves.js';
import chaos from './chaos.js';
import graphs from './graphs.js';
import symbol from './symbol.js';
import { LW } from '../core/draw.js';
import { mulberry32 } from '../core/rng.js';

export const ENGINES = { curves, fractals, automata, particles, waves, chaos, graphs, symbol };

export function createVisual(engineId, params, seed) {
  const engine = ENGINES[engineId] || symbol;
  const rng = mulberry32(seed);
  return { engine, state: engine.create(params || {}, rng) };
}

// Рисует текущий кадр в квадрат (x, y, size) в пикселях текущего контекста
export function drawVisual(ctx, visual, x, y, size, colors, { frame = true } = {}) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size, size);
  ctx.beginPath();
  ctx.rect(0, 0, 1, 1);
  ctx.clip();
  ctx.lineWidth = LW;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = colors.ink;
  ctx.fillStyle = colors.ink;
  visual.engine.draw(ctx, visual.state, colors);
  ctx.restore();
  if (!frame) return;
  // рамка, как у референсов
  ctx.save();
  ctx.lineWidth = LW * size;
  ctx.strokeStyle = colors.ink;
  const h = (LW * size) / 2;
  ctx.strokeRect(x + h, y + h, size - 2 * h, size - 2 * h);
  ctx.restore();
}

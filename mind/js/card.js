// Карточка 9:16 (1080×1920): мысль крупно + текущий кадр + область мелко. Без справки и теории.
import { drawVisual } from './engines/index.js';
import { fitText, FONTS } from './core/draw.js';

const W = 1080, H = 1920, M = 80, VIS = W - 2 * M;

export async function renderCard({ title, area, visual, colors }) {
  try {
    await Promise.all([
      document.fonts.load(`400 100px ${FONTS.display}`, title),
      document.fonts.load(`400 30px ${FONTS.text}`, area),
      document.fonts.load(`300 40px ${FONTS.figure}`, 'Аа0'),
    ]);
  } catch { /* рисуем запасным шрифтом */ }

  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = colors.paper;
  ctx.fillRect(0, 0, W, H);

  // визуал
  const visY = H - M - 150 - VIS;
  drawVisual(ctx, visual, M, visY, VIS, colors);

  // заголовок: прижат к визуалу снизу
  const boxTop = 130, boxBottom = visY - 70;
  const lh = 1.06;
  const { size, lines } = fitText(ctx, title, { family: FONTS.display, weight: 400, maxW: VIS, maxH: boxBottom - boxTop, max: 132, min: 46, lh });
  ctx.fillStyle = colors.ink;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `400 ${size}px ${FONTS.display}`;
  const top = boxBottom - lines.length * size * lh;
  lines.forEach((l, i) => ctx.fillText(l, M, top + size * 0.82 + i * size * lh));

  // область
  const ay = H - M - 60;
  ctx.font = `400 30px ${FONTS.text}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  ctx.textBaseline = 'middle';
  ctx.fillText(area, M, ay + 1);
  return cv;
}

const slug = (s) => s.replace(/[«»„“"?!.,:;—–]/g, '').trim().replace(/\s+/g, '-').slice(0, 48).toLowerCase();

export async function exportCard(opts) {
  const cv = await renderCard(opts);
  const blob = await new Promise((res) => cv.toBlob(res, 'image/png'));
  const name = `mysl-${slug(opts.title) || 'card'}.png`;
  const file = new File([blob], name, { type: 'image/png' });
  const mobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  if (mobile && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return 'shared';
    } catch (e) {
      if (e.name === 'AbortError') return 'cancelled';
    }
  }
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return 'downloaded';
}

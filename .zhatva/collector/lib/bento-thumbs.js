// Превью для витрины. В плитке виден только верх кадра, а снимок страницы целиком бывает 2880×17640:
// девятнадцать таких кадров браузер ужимал в плитки в одном кадре анимации — витрина появлялась
// рывком. Витрине отдаём верх снимка шириной не больше плитки на ретине; статье остаётся оригинал.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { mockKind } = require('./html-bands');

const THUMB_WIDTH = 1000;
// Самая высокая плитка — две строки сетки; ниже этого края в плитке ничего не видно.
const MAX_ASPECT = 1.25;
// Мобильный снимок в плитке стоит в телефоне: превью режется под его экран, иначе экран внизу пустой.
const PHONE_ASPECT = 844 / 390;
const THUMB_QUALITY = 80;
const THUMB_SUFFIX = '.thumb.webp';
const CWEBP_TIMEOUT_MS = 20000;
const RASTER = new Set(['png', 'jpg', 'jpeg', 'webp']);

const thumbName = (file) => file.replace(/\.[^.]+$/, '') + THUMB_SUFFIX;

// null — превью не нужно: кадр и так лёгкий, или это не растровая картинка.
function thumbPlan(item) {
  const ext = path.extname(item.file || '').slice(1).toLowerCase();
  if (item.type !== 'image' || !RASTER.has(ext) || !item.width || !item.height) return null;
  const aspect = mockKind(item) === 'phone' ? PHONE_ASPECT : MAX_ASPECT;
  const cropHeight = Math.min(item.height, Math.round(item.width * aspect));
  const isSmall = item.width <= THUMB_WIDTH && cropHeight === item.height;
  if (isSmall) return null;
  return { cropWidth: item.width, cropHeight, resizeWidth: Math.min(item.width, THUMB_WIDTH) };
}

function isFresh(thumb, source) {
  try {
    return fs.statSync(thumb).mtimeMs >= fs.statSync(source).mtimeMs;
  } catch {
    return false;
  }
}

function makeThumb(source, thumb, plan) {
  const resize = plan.resizeWidth < plan.cropWidth ? ['-resize', String(plan.resizeWidth), '0'] : [];
  execFileSync('cwebp', [
    '-quiet', '-q', String(THUMB_QUALITY),
    '-crop', '0', '0', String(plan.cropWidth), String(plan.cropHeight),
    ...resize, source, '-o', thumb,
  ], { stdio: 'ignore', timeout: CWEBP_TIMEOUT_MS });
}

// Возвращает имя файла для плитки: превью, а если его не сделать — оригинал.
// Без cwebp витрина просто остаётся тяжелее, статья от этого не ломается.
function ensureThumb(caseDir, item) {
  const plan = thumbPlan(item);
  if (!plan) return item.file;

  const source = path.join(caseDir, 'media', item.file);
  const name = thumbName(item.file);
  const thumb = path.join(caseDir, 'media', name);
  if (isFresh(thumb, source)) return name;
  if (!fs.existsSync(source)) return item.file;

  try {
    makeThumb(source, thumb, plan);
    if (fs.statSync(thumb).size > 0) return name;
  } catch (error) {
    process.stderr.write(`превью для ${item.file} не сделано: ${error.message}\n`);
  }
  try { fs.unlinkSync(thumb); } catch {}
  return item.file;
}

const withThumbs = (caseDir, items) => items.map((item) => ({ ...item, thumb: ensureThumb(caseDir, item) }));

module.exports = { thumbPlan, thumbName, ensureThumb, withThumbs, THUMB_WIDTH };

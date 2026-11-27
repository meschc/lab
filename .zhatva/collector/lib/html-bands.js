const { escapeHtml, inline } = require('./html-inline');
const { icon } = require('./icons');

const VIDEO_TYPES = new Set(['video']);

// Все кадры живут в рамке 16:9, иначе лента скачет по высоте. Мобильный снимок в ней
// показывается экраном телефона на подложке, а не растягивается и не сжимается в полоску. Формальное соотношение сторон здесь не помощник: снимок страницы
// целиком всегда «вертикальный», хотя это десктоп, — поэтому десктоп узнаём по ширине кадра.
const DESKTOP_MIN_WIDTH = 1000;

function frameClass(item) {
  if (!item.width || !item.height) return 'project__figure--wide';
  const isWide = item.width >= item.height || item.width >= DESKTOP_MIN_WIDTH;
  return isWide ? 'project__figure--wide' : 'project__figure--fit';
}

const mediaTag = (item, src, extra = '') =>
  VIDEO_TYPES.has(item.type)
    ? `<video src="${escapeHtml(src)}" controls preload="metadata"${extra}></video>`
    : `<img src="${escapeHtml(src)}" alt="${escapeHtml(item.caption || '')}" loading="lazy"${extra}>`;

// Кадр показывается в мокапе того, чем он был: телефон, окно браузера, значок приложения.
// Остальное — схемы, превью для соцсетей — лежит карточкой на подложке.
// Иконку узнаём по квадрату небольшого размера: квадратная схема крупнее — уже картинка.
const ICON_MAX_SIDE = 512;
const SQUARE_TOLERANCE = 0.05;

function mockKind(item) {
  if (!item.width || !item.height) return 'card';
  const isSquare = Math.abs(item.width - item.height) <= item.width * SQUARE_TOLERANCE;
  if (isSquare && item.width <= ICON_MAX_SIDE) return 'icon';
  if (frameClass(item) === 'project__figure--fit') return 'phone';
  return item.height > item.width ? 'browser' : 'card';
}

// В статье экран листается сам и ловит фокус; в витрине плитка — только превью.
const screen = (media, isLive) => isLive
  ? `<div class="project__screen" data-screen tabindex="0">${media}</div>`
  : `<div class="project__screen">${media}</div>`;

const BROWSER_BAR = '<div class="device__bar" aria-hidden="true"><i></i><i></i><i></i></div>';

const MOCKS = {
  phone: (item, src, isLive) =>
    `<div class="device device--phone">${screen(mediaTag(item, src), isLive)}</div>`,
  browser: (item, src, isLive) =>
    `<div class="device device--browser">${BROWSER_BAR}${screen(mediaTag(item, src), isLive)}</div>`,
  icon: (item, src) =>
    `<img class="mock__glow" src="${escapeHtml(src)}" alt="" aria-hidden="true"><div class="app-icon">${mediaTag(item, src)}</div>`,
  card: (item, src) => mediaTag(item, src, ' class="mock__card"'),
};

function mockup(item, src, isLive) {
  const kind = mockKind(item);
  return `<div class="mock mock--${kind}">${MOCKS[kind](item, src, isLive)}</div>`;
}

function figureBand(item) {
  const src = `media/${item.file}`;
  const caption = item.caption ? `\n    <figcaption class="side">${inline(item.caption)}</figcaption>` : '';
  return `<figure class="project__figure ${frameClass(item)}" data-reveal>\n    ${mockup(item, src, true)}${caption}\n  </figure>`;
}

const PLAIN_NUMBER_RE = /^\d+$/;
const SHORT_NUMBER_CHARS = 4;

function numberCell({ value, label }) {
  // Счётчик работает только с целым числом: «8→3» или «97 КБ» он бы посчитал как 8 и 97.
  const counted = PLAIN_NUMBER_RE.test(value) ? ` data-count="${escapeHtml(value)}"` : '';
  return `<div class="number">\n      <b class="number__value"${counted}>${escapeHtml(value)}</b>\n      <span class="number__label">${escapeHtml(label)}</span>\n    </div>`;
}

function numbersBand(numbers) {
  if (!numbers.length) return '';
  // Длинное значение в ячейке крупного кегля наезжает на соседа. Мельче печатается вся полоса:
  // одно уменьшенное число среди крупных выглядит сноской.
  const long = numbers.some(({ value }) => value.length > SHORT_NUMBER_CHARS) ? ' data-long' : '';
  return `<aside class="numbers" data-reveal${long}>\n    ${numbers.map(numberCell).join('\n    ')}\n</aside>`;
}

const forkRow = (label, value) =>
  `<div class="fork__row"><dt>${escapeHtml(label)}</dt><dd>${inline(value)}</dd></div>`;

function forkCard(fork, index) {
  const no = String(index + 1).padStart(2, '0');
  const rows = [forkRow('Было', fork.before), forkRow('Выбрал', fork.chose), forkRow('Заплатил', fork.paid)];

  // Номер развилки уходит в правые две колонки: в потоке текста он мешает читать заголовок.
  return [
    '<li class="fork" data-reveal>',
    `  <p class="fork__no side">развилка ${no}</p>`,
    `  <h3 class="fork__title">${escapeHtml(fork.title)}</h3>`,
    `  <dl class="fork__rows">\n    ${rows.join('\n    ')}\n  </dl>`,
    '</li>',
  ].join('\n  ');
}

function forksBand(forks) {
  if (!forks.length) return '';
  return `<ol class="forks">\n  ${forks.map(forkCard).join('\n  ')}\n</ol>`;
}

function compareBand(pair, byFile) {
  if (!pair) return '';

  const before = byFile.get(pair.before);
  const after = byFile.get(pair.after);
  if (!before || !after) return '';

  return [
    '<div class="compare-block" data-compare data-reveal>',
    '  <div class="compare">',
    `    ${mediaTag(after, `media/${after.file}`)}`,
    `    <div class="compare__before">${mediaTag(before, `media/${before.file}`)}</div>`,
    '    <div class="compare__handle"></div>',
    '    <input class="compare__range" type="range" min="0" max="100" value="50" aria-label="Сравнение: было и стало">',
    '  </div>',
    `  <p class="compare__tags side"><span>было — ${escapeHtml(before.caption || '')}</span><span>стало — ${escapeHtml(after.caption || '')}</span></p>`,
    '</div>',
  ].join('\n');
}

function relatedItem(item) {
  const preview = item.cover ? ` data-preview="${escapeHtml(item.cover)}"` : '';
  return `<a class="related__item" href="${escapeHtml(item.href)}"${preview}><span class="related__title">${escapeHtml(item.title)}</span><span class="related__arrow">→</span></a>`;
}

function relatedBand(cases) {
  if (!cases.length) return '';
  return `<aside class="related" data-reveal>\n  <p class="label">Другие кейсы</p>\n  ${cases.map(relatedItem).join('\n  ')}\n</aside>`;
}

// Раскладка бенто: крупный кадр, два обычных, широкий, высокий — и по кругу. Ритм задаётся
// позицией, а не содержимым: про сами кадры известно только соотношение сторон.
// Размер плитки идёт от кадра: мобильный экран — всегда высокая плитка, иначе широкая
// растянет его в размытую кашу; десктопные кадры чередуют большую, обычные и широкую.
const DESKTOP_SPANS = ['bento__item--big', '', '', 'bento__item--wide', ''];
const PHONE_SPAN = 'bento__item--tall';

function bentoSpans(items) {
  return items.reduce((acc, item) => {
    if (frameClass(item) === 'project__figure--fit') return { ...acc, spans: [...acc.spans, PHONE_SPAN] };
    const span = DESKTOP_SPANS[acc.desktop % DESKTOP_SPANS.length];
    return { desktop: acc.desktop + 1, spans: [...acc.spans, span] };
  }, { desktop: 0, spans: [] }).spans;
}

// --i — место плитки в каскаде появления. thumb — лёгкое превью для плитки, если оно есть.
function bentoItem(item, span, index) {
  const caption = item.caption ? `<figcaption>${escapeHtml(item.caption)}</figcaption>` : '';
  const cls = span ? `bento__item ${span}` : 'bento__item';
  const src = `media/${item.thumb || item.file}`;
  return `<figure class="${cls}" style="--i:${index}">${mockup(item, src, false)}${caption}</figure>`;
}

const FRAME_WORDS = ['кадр', 'кадра', 'кадров'];

function pluralRu(count, [one, few, many]) {
  const mod100 = count % 100;
  const mod10 = count % 10;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

function bentoOverlay(items) {
  if (!items.length) return '';

  return [
    // Обе подписи лежат в кнопке сразу, видимую выбирает aria-expanded: скрипт не пересобирает разметку.
    '<button class="dissolve" type="button" data-dissolve aria-expanded="false" aria-controls="bento">',
    `  <span class="dissolve__label dissolve__label--open">${icon('layout-grid')}Растворить текст</span>`,
    `  <span class="dissolve__label dissolve__label--close">${icon('align-left')}Вернуть текст</span>`,
    '</button>',
    '<div class="bento" id="bento" hidden>',
    '  <div class="bento__head">',
    '    <h2 class="bento__title">Кадры проекта</h2>',
    `    <span class="bento__count">${icon('photo')}${items.length} ${pluralRu(items.length, FRAME_WORDS)}</span>`,
    '  </div>',
    '  <div class="bento__grid">',
    `    ${bentoSpans(items).map((span, i) => bentoItem(items[i], span, i)).join('\n    ')}`,
    '  </div>',
    '</div>',
    `<div class="hint" aria-hidden="true">все кадры${icon('arrow-right')}</div>`,
  ].join('\n');
}

module.exports = {
  VIDEO_TYPES,
  frameClass,
  mockKind,
  figureBand,
  numbersBand,
  forksBand,
  compareBand,
  relatedBand,
  bentoOverlay,
  pluralRu,
};

const fs = require('fs');
const path = require('path');
const { loadConfig } = require('./config');
const { writeTextAtomic } = require('./fsx');
const { readSiteCss } = require('./site-css');
const { loadIndex } = require('./media-store');
const { showcaseItems } = require('./media-filter');
const { withThumbs } = require('./bento-thumbs');
const { sectionMeta } = require('./doc-store');
const { loadArticle, relatedCases } = require('./article-data');
const { escapeHtml, inline, paragraphBlocks, paragraphs } = require('./html-inline');
const bands = require('./html-bands');
const { loadRegistry } = require('./registry');
const { syncLogo } = require('./project-logo');
const { ruDate } = require('./ru-date');

const DEFAULT_ARTICLE_WIDTH = 745;
// Развилки и сравнение «было/стало» встают в раздел решений: там они и происходили.
const SPINE_SECTION = 'decisions';

// Заголовок раздела в статье — своя фраза из article.json, если она есть: «Проблема и контекст»
// ничего не говорит читателю, пробегающему глазами одни заголовки.
const articleTitle = (section, headings = {}) =>
  headings[section.key] || sectionMeta(section.key).articleTitle || section.title;

// Кадры раскладываем по разделам пропорционально объёму текста: длинному достаётся больше,
// и ни одна картинка не отрывается от абзаца, который её объясняет.
function allocate(count, weights) {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (!total) return weights.map(() => 0);

  // Доля раздела ограничена числом его абзацев: больше кадров, чем стыков, ему всё равно не расставить.
  const fair = weights.map((weight) => Math.min(weight, Math.floor((count * weight) / total)));
  return distribute(fair, weights, count - fair.reduce((sum, n) => sum + n, 0));
}

// Остаток раздаём по одному кадру за раз — туда, где свободных стыков между абзацами больше всего.
function distribute(shares, weights, rest) {
  if (rest <= 0) return shares;

  const free = shares
    .map((n, index) => ({ room: weights[index] - n, weight: weights[index], index }))
    .filter((share) => share.room > 0)
    .sort((a, b) => b.room - a.room || b.weight - a.weight)[0];

  // Свободных стыков не осталось: кадров просто больше, чем абзацев, — досыпаем самому объёмному разделу.
  const target = free ? free.index : weights.indexOf(Math.max(...weights));
  return distribute(shares.map((n, index) => (index === target ? n + 1 : n)), weights, rest - 1);
}

// Кадр встаёт после абзаца, а не перед ним: раздел начинается словами. Дальше кадры расходятся
// по стыкам как можно ровнее — слипшиеся подряд картинки это то же полотно, только мельче.
function weave(blocks, figures) {
  if (!figures.length) return blocks;

  const slots = figures.map((_, i) =>
    Math.min(blocks.length, Math.floor((i * blocks.length) / figures.length) + 1)
  );

  return blocks.flatMap((block, index) => [block, ...figures.filter((_, i) => slots[i] === index + 1)]);
}

function sectionText(section) {
  const synthesis = section.entries
    .map((entry) => entry.synthesis)
    .filter(Boolean)
    .join('\n\n');

  return (section.body || synthesis).trim();
}

// Полосы данных встают после первого абзаца: сперва раздел объясняет, о чём речь, и только
// потом показывает развилки — иначе карточки читаются до того, как понятно, к чему они.
function withExtras(blocks, extras) {
  if (!extras.length) return blocks;
  if (!blocks.length) return extras;
  return [blocks[0], ...extras, ...blocks.slice(1)];
}

function sectionHtml(section, figures, extras = [], headings = {}) {
  const blocks = withExtras(weave(paragraphBlocks(sectionText(section)), figures), extras);
  if (!blocks.length) return '';

  return `<section class="project__section">\n  <h2>${escapeHtml(articleTitle(section, headings))}</h2>\n  ${blocks.join('\n  ')}\n</section>`;
}

// Отдельная «Витрина» остаётся запасным вариантом: пока разделы не сведены, кадрам просто негде
// встать между абзацами, и без неё они не попали бы в статью вовсе.
function showcaseSection(section, figures) {
  if (!figures.length) return '';
  return `<section class="project__section">\n  <h2>${escapeHtml(articleTitle(section))}</h2>\n  ${figures.join('\n  ')}\n</section>`;
}

function bodyHtml(doc, items, article) {
  // Кадры из блока сравнения в ленте не повторяем: там они уже показаны, рядом и целиком.
  const pair = article.compare;
  const byFile = new Map(items.map((item) => [item.file, item]));
  const used = pair ? new Set([pair.before, pair.after]) : new Set();

  const figures = items.filter((item) => !used.has(item.file)).map(bands.figureBand);
  const sections = doc.sections.filter((section) => section.key !== 'showcase');
  const weights = sections.map((section) => paragraphBlocks(sectionText(section)).length);
  const shares = allocate(figures.length, weights);

  const spine = [
    bands.forksBand(article.forks),
    pair ? bands.compareBand(pair, byFile) : '',
  ].filter(Boolean);

  if (!weights.some(Boolean)) {
    const showcase = doc.sections.find((section) => section.key === 'showcase');
    return [...spine, showcase ? showcaseSection(showcase, figures) : ''].filter(Boolean).join('\n  ');
  }

  let taken = 0;
  return sections
    .map((section, index) => {
      const share = figures.slice(taken, taken + shares[index]);
      taken += shares[index];
      return sectionHtml(section, share, section.key === SPINE_SECTION ? spine : [], article.headings);
    })
    .filter(Boolean)
    .join('\n  ');
}

function rawHtml(doc) {
  const blocks = doc.sections.flatMap((section) =>
    section.entries
      .filter((entry) => entry.raw.length)
      .map((entry) => {
        const items = entry.raw.map((line) => `<li>${inline(line)}</li>`).join('\n      ');
        return `<h3>${escapeHtml(section.title)} · ${escapeHtml(entry.heading)}</h3>\n    <ul>\n      ${items}\n    </ul>`;
      })
  );

  if (!blocks.length) return '';
  return `<details class="project__raw">\n  <summary>Исходный материал</summary>\n    ${blocks.join('\n    ')}\n</details>`;
}

function loadTemplate() {
  const config = loadConfig();
  const custom = path.join(config.casesRoot, '_template.html');
  const file = fs.existsSync(custom) ? custom : path.join(config.collectorRoot, 'template.default.html');
  return fs.readFileSync(file, 'utf8');
}

// Корень проекта знает только реестр: папка кейса названа по проекту, но может лежать где угодно.
function projectRoot(caseDir) {
  const folder = path.basename(caseDir).normalize('NFC');
  const entry = loadRegistry().find((e) => (e.folderName || '').normalize('NFC') === folder);
  return entry ? entry.root : null;
}

function logoHtml(caseDir) {
  const name = syncLogo(caseDir, projectRoot(caseDir));
  return name ? `<img class="project__logo" src="media/${escapeHtml(name)}" alt="" width="48" height="48">` : '';
}

function renderHtml(caseDir, doc, meta) {
  const metaLine = [meta.kind || 'кейс', `обновлено ${ruDate(meta.updated)}`]
    .map(escapeHtml)
    .join(' · ');

  const items = showcaseItems(loadIndex(caseDir));
  const article = loadArticle(caseDir);

  const replacements = {
    '{{SITE_CSS}}': readSiteCss() || '',
    '{{ARTICLE_WIDTH}}': `${loadConfig().articleWidthPx || DEFAULT_ARTICLE_WIDTH}px`,
    '{{LOGO}}': logoHtml(caseDir),
    '{{TITLE}}': escapeHtml(doc.title),
    '{{META}}': metaLine,
    '{{LEAD}}': doc.lead ? paragraphs(doc.lead, 'project__lead') : '',
    '{{NUMBERS}}': bands.numbersBand(article.numbers),
    '{{BODY}}': bodyHtml(doc, items, article),
    '{{RELATED}}': bands.relatedBand(relatedCases(path.basename(caseDir))),
    '{{BENTO}}': bands.bentoOverlay(withThumbs(caseDir, items)),
    '{{RAW}}': rawHtml(doc),
  };

  return Object.entries(replacements).reduce(
    (html, [token, value]) => html.split(token).join(value),
    loadTemplate()
  );
}

function writeHtml(caseDir, doc, meta) {
  writeTextAtomic(path.join(caseDir, 'case-study.html'), renderHtml(caseDir, doc, meta));
}

module.exports = { renderHtml, writeHtml };

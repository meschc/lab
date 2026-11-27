// Публикация статьи кейса фрагментом сайта: тот же рендер, что и у case-study.html,
// только тема и шрифты берутся у сайта, а кадры лежат в assets/cases/<slug>/.
const fs = require('fs');
const path = require('path');
const { writeTextAtomic } = require('./fsx');
const { renderHtml } = require('./html-render');
const { icon } = require('./icons');

// Сайт сам проявляет содержимое (blur-fade по уровням DOM) и вешает на каждый узел свой переход
// на 0,8 с — он перебивал бы наведение и растворение. Поэтому вся статья помечена data-no-blur:
// шапка проявляется своей анимацией, тело — своим наблюдателем по скроллу.
const SITE_CSS = `
/* Сайт прячет каждого ребёнка #content до проявления; статья проявляется сама. Фильтр (даже blur(0))
   на предке сломал бы position: fixed у кнопки растворения и подсказки. */
#content > .case { opacity: 1; filter: none; transition: none; }
#content.blur-fade, #content.blur-fade--active { filter: none; }
.case .project, .case .bento { width: min(var(--grid-width), 100%); margin: 0; padding: var(--gap-md) 0 var(--gap-xxl); }
.case__back {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--font-size-small);
  color: var(--text-color);
  opacity: .5;
  margin: var(--gap-md) 0 0;
  transition: opacity .25s ease, color .25s ease;
  animation: rise .8s cubic-bezier(.2, .7, .2, 1) backwards;
}
.case__back:hover { opacity: 1; color: var(--accent-color-hover, var(--text-color)); }
.case__back .ico { transition: transform .25s cubic-bezier(.2, .7, .2, 1); }
.case__back:hover .ico { transform: translateX(-3px); }
/* В правом нижнем углу сайта уже живёт кнопка звука (40×40): встаём левее, в один ряд с ней. */
.case .dissolve {
  right: calc(var(--sidebar-padding) + 40px + var(--gap-sm));
  bottom: var(--sidebar-padding);
  min-height: 40px;
}
/* На телефоне переключатели сайта висят прямо над текстом статьи: под ними затемняем низ экрана,
   иначе строки просвечивают между кнопками. */
@media (max-width: 900px) {
  .case::after {
    content: '';
    position: fixed;
    inset: auto 0 0;
    height: 120px;
    z-index: 40;
    pointer-events: none;
    background: linear-gradient(transparent, var(--bg-color) 55%);
  }
}`;

function between(text, start, end) {
  const from = text.indexOf(start);
  const to = text.indexOf(end, from);
  if (from < 0 || to < 0) throw new Error(`в шаблоне нет меток ${start} … ${end}`);
  return text.slice(from + start.length, to);
}

const dropStandalone = (text, start, end) =>
  text.split(start).map((part, i) => (i === 0 ? part : part.slice(part.indexOf(end) + end.length))).join('');

function siteBody(body, slug) {
  return body
    .replace(/<details class="project__raw">[\s\S]*?<\/details>/g, '')
    .replace(/<aside class="related"[\s\S]*?<\/aside>/g, '')
    .replace(/"media\//g, `"assets/cases/${slug}/`);
}

function buildFragment(html, { slug, back }) {
  const css = dropStandalone(between(html, '/* @case-css:start */', '/* @case-css:end */'),
    '/* @standalone:start */', '/* @standalone:end */');
  const js = dropStandalone(between(html, '// @case-js:start', '// @case-js:end'),
    '// @standalone:start', '// @standalone:end');
  const body = siteBody(between(html, '<!-- @case-body:start -->', '<!-- @case-body:end -->'), slug);

  // <style> внутри обёртки: в начале фрагмента DOMParser унёс бы его в <head> и потерял.
  return [
    `<div class="case" data-case="${slug}" data-no-blur>`,
    `<style>${css}${SITE_CSS}\n</style>`,
    `<a class="case__back" href="${back.href}">${icon('arrow-left')}<span>${back.label}</span></a>`,
    body.trim(),
    `<script>${js}</script>`,
    '</div>',
    '',
  ].join('\n');
}

function referencedMedia(fragment, slug) {
  const prefix = `assets/cases/${slug}/`;
  const found = fragment.match(new RegExp(`${prefix}[^"'\\s)]+`, 'g')) || [];
  return [...new Set(found.map((ref) => ref.slice(prefix.length)))];
}

function copyMedia(caseDir, siteRoot, slug, files) {
  const target = path.join(siteRoot, 'assets', 'cases', slug);
  fs.mkdirSync(target, { recursive: true });
  const missing = files.filter((file) => !fs.existsSync(path.join(caseDir, 'media', file)));
  if (missing.length) throw new Error(`нет файлов в media/: ${missing.join(', ')}`);
  files.forEach((file) => fs.copyFileSync(path.join(caseDir, 'media', file), path.join(target, file)));
  return target;
}

// content.json правим текстом, а не через JSON.stringify: у сайта своя ручная раскладка,
// перепечатка всего файла превратила бы одну строку в дифф на сотню.
function registerEntry(siteRoot, key, file) {
  const registry = path.join(siteRoot, 'json', 'content.json');
  const text = fs.readFileSync(registry, 'utf8');
  if (JSON.parse(text).ru?.[key]) return false;

  const anchor = '  "ru": {\n';
  const at = text.indexOf(anchor);
  if (at < 0) throw new Error('в content.json нет раздела "ru"');
  const entry = `    "${key}": {\n      "type": "html",\n      "data": "${file}"\n    },\n`;
  const next = text.slice(0, at + anchor.length) + entry + text.slice(at + anchor.length);
  JSON.parse(next);
  writeTextAtomic(registry, next);
  return true;
}

function publishCase({ caseDir, doc, meta, siteRoot, slug, back }) {
  const fragment = buildFragment(renderHtml(caseDir, doc, meta), { slug, back });
  const media = referencedMedia(fragment, slug);
  const mediaDir = copyMedia(caseDir, siteRoot, slug, media);
  const file = `html/${slug}-case.html`;
  writeTextAtomic(path.join(siteRoot, file), fragment);
  const registered = registerEntry(siteRoot, `${slug}-case`, file);
  return { file: path.join(siteRoot, file), mediaDir, mediaCount: media.length, registered, hash: `#${slug}-case` };
}

module.exports = { publishCase, buildFragment };

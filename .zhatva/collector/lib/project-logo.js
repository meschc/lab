// Логотип проекта берём из его исходников на каждой пересборке статьи: сменился знак
// в проекте — сменился и в кейсе, без ручного копирования.
const fs = require('fs');
const path = require('path');
const { ensureDir } = require('./fsx');

const LOGO_NAME = 'logo';
const LOGO_EXTENSIONS = ['.svg', '.png', '.webp'];
// Сначала то, что проект сам называет логотипом, потом фавикон: он почти всегда и есть знак.
const CANDIDATES = [
  'public/logo.svg', 'logo.svg', 'assets/logo.svg', 'src/assets/logo.svg', 'static/logo.svg',
  'public/favicon.svg', 'favicon.svg', 'static/favicon.svg',
  'public/logo.png', 'logo.png', 'assets/logo.png', 'public/apple-touch-icon.png',
];
const ICON_LINK_RE = /<link\b[^>]*\brel=["'][^"']*\bicon\b[^"']*["'][^>]*>/gi;
const HREF_RE = /\bhref=["']([^"']+)["']/i;
// В исходнике комментарий допустим, а в <img> svg читается как строгий XML:
// «--» внутри комментария — и знак не рисуется вовсе.
const SVG_COMMENT_RE = /<!--[\s\S]*?-->\s*/g;

const isFile = (file) => {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
};

// Ссылка из чужого файла не должна увести за корень проекта.
function insideRoot(root, rel) {
  const file = path.resolve(root, rel);
  return file.startsWith(root + path.sep) ? file : null;
}

function declaredIcons(root) {
  const indexFile = path.join(root, 'index.html');
  if (!isFile(indexFile)) return [];
  const links = fs.readFileSync(indexFile, 'utf8').match(ICON_LINK_RE) || [];
  const hrefs = links.map((link) => (link.match(HREF_RE) || [])[1]).filter(Boolean)
    .filter((href) => LOGO_EXTENSIONS.includes(path.extname(href).toLowerCase()));
  // Абсолютный путь в вёрстке Vite и подобных указывает в public/.
  return hrefs.flatMap((href) => (href.startsWith('/')
    ? [path.join('public', href), href.slice(1)]
    : [href]));
}

function findLogo(root) {
  if (!root || !fs.existsSync(root)) return null;
  const absRoot = path.resolve(root);
  const found = [...declaredIcons(absRoot), ...CANDIDATES]
    .map((rel) => insideRoot(absRoot, rel))
    .find((file) => file && isFile(file));
  return found || null;
}

function existingCopy(caseDir) {
  const name = LOGO_EXTENSIONS.map((ext) => LOGO_NAME + ext)
    .find((file) => isFile(path.join(caseDir, 'media', file)));
  return name || null;
}

// Возвращает имя файла в media/ или null. Проект пропал с диска — остаётся прежняя копия.
function syncLogo(caseDir, root) {
  const source = findLogo(root);
  if (!source) return existingCopy(caseDir);

  const name = LOGO_NAME + path.extname(source).toLowerCase();
  const target = path.join(caseDir, 'media', name);
  const raw = fs.readFileSync(source);
  const fresh = path.extname(source).toLowerCase() === '.svg'
    ? Buffer.from(raw.toString('utf8').replace(SVG_COMMENT_RE, ''))
    : raw;
  const same = isFile(target) && fs.readFileSync(target).equals(fresh);
  if (!same) {
    ensureDir(path.dirname(target));
    fs.writeFileSync(target, fresh);
  }
  return name;
}

module.exports = { findLogo, syncLogo };

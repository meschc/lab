const fs = require('fs');
const path = require('path');
const { loadConfig } = require('./config');

const SITE_ORIGIN = 'https://kirmesch.ru';
const FILES = ['root.css', 'theme.css', 'typography.css'];

// Абсолютные пути вида url(/assets/...) ведут в корень сайта — вне его они не резолвятся,
// поэтому при инлайне разворачиваются в полный адрес.
const absolutizeUrls = (css) =>
  css.replace(/url\((['"]?)\/(?!\/)/g, (_, quote) => `url(${quote}${SITE_ORIGIN}/`);

function readSiteCss() {
  const root = loadConfig().siteCssRoot;
  const parts = FILES.map((name) => {
    const file = path.join(root, name);
    try {
      return `/* ${name} */\n${absolutizeUrls(fs.readFileSync(file, 'utf8'))}`;
    } catch {
      return null;
    }
  }).filter(Boolean);

  return parts.length ? parts.join('\n\n') : null;
}

module.exports = { readSiteCss };

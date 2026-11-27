const fs = require('fs');
const path = require('path');
const { loadConfig } = require('./config');
const { readJson, writeJsonAtomic } = require('./fsx');
const { loadRegistry } = require('./registry');
const { loadIndex } = require('./media-store');
const { showcaseItems } = require('./media-filter');

// Развилки, цифры и пара «было/стало» — это данные, а не проза: в `case-study.md` им места нет,
// его правят руками. Держим их рядом, отдельным файлом, и пересобираем на каждом апгрейде.
const FILE = 'article.json';
const EMPTY = { forks: [], numbers: [], compare: null, headings: {}, updated: null };

const articleFile = (caseDir) => path.join(caseDir, FILE);
const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const pickStrings = (obj) =>
  Object.fromEntries(Object.entries(obj).filter(([, value]) => typeof value === 'string' && value.trim()));

function loadArticle(caseDir) {
  const data = readJson(articleFile(caseDir), null);
  if (!data || typeof data !== 'object') return { ...EMPTY };
  return {
    forks: Array.isArray(data.forks) ? data.forks : [],
    numbers: Array.isArray(data.numbers) ? data.numbers : [],
    compare: data.compare && data.compare.before && data.compare.after ? data.compare : null,
    headings: isPlainObject(data.headings) ? pickStrings(data.headings) : {},
    updated: data.updated || null,
  };
}

function saveArticle(caseDir, data) {
  writeJsonAtomic(articleFile(caseDir), { ...EMPTY, ...data, updated: new Date().toISOString() });
}

const MAX_RELATED = 4;

// Ссылка на соседний кейс имеет смысл, только если там уже есть что открыть: по соседству
// обычно лежат заготовки без статьи, и мёртвая ссылка хуже её отсутствия.
function relatedCases(currentFolder) {
  const root = loadConfig().casesRoot;

  return loadRegistry()
    .filter((entry) => entry.folderName !== currentFolder && entry.tracking === 'enabled')
    .map((entry) => {
      const dir = path.join(root, entry.folderName);
      if (!fs.existsSync(path.join(dir, 'case-study.html'))) return null;

      const cover = showcaseItems(loadIndex(dir)).find((item) => item.type === 'image');
      return {
        title: entry.folderName,
        href: `../${entry.folderName}/case-study.html`,
        cover: cover ? `../${entry.folderName}/media/${cover.file}` : null,
        caption: cover ? cover.caption || '' : '',
      };
    })
    .filter(Boolean)
    .slice(0, MAX_RELATED);
}

module.exports = { loadArticle, saveArticle, relatedCases, articleFile };

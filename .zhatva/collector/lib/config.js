const fs = require('fs');
const os = require('os');
const path = require('path');

const HOME = os.homedir();
const ROOT = path.resolve(__dirname, '..');
const IS_CLOUD = process.env.ZHATVA_CLOUD === '1';

const expandHome = (p) => (p.startsWith('~/') ? path.join(HOME, p.slice(2)) : p);

const readJsonSafe = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

let cached = null;

function loadConfig() {
  if (cached) return cached;

  const defaults = readJsonSafe(path.join(ROOT, 'config.default.json'));
  if (!defaults) throw new Error('config.default.json отсутствует или повреждён');

  const overrides = readJsonSafe(path.join(ROOT, 'config.json')) || {};
  const merged = { ...defaults, ...overrides };

  cached = Object.freeze({
    ...merged,
    casesRoot: expandHome(process.env.ZHATVA_CASES_ROOT || merged.casesRoot),
    siteCssRoot: expandHome(merged.siteCssRoot),
    collectorRoot: ROOT,
  });
  return cached;
}

module.exports = { loadConfig, expandHome, readJsonSafe, HOME, ROOT, IS_CLOUD };

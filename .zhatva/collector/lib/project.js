const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { loadConfig, HOME, IS_CLOUD } = require('./config');
const { ensureDir } = require('./fsx');
const registry = require('./registry');

const MARKERS = [
  '.git',
  '.case-study-ignore',
  'package.json',
  'pyproject.toml',
  'Cargo.toml',
  'go.mod',
  'composer.json',
  'Makefile',
  'index.html',
];

const PROJECTS_DIR = path.join(HOME, 'Проекты');
const MAX_CONTAINER_DESCENT = 3;

const hash12 = (value) => crypto.createHash('sha256').update(value).digest('hex').slice(0, 12);

const hasMarker = (dir) => MARKERS.some((m) => fs.existsSync(path.join(dir, m)));

function hasRegularFiles(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).some((e) => e.isFile() && !e.name.startsWith('.'));
  } catch {
    return false;
  }
}

function ancestors(from) {
  const chain = [];
  let current = path.resolve(from);
  while (current !== path.dirname(current)) {
    chain.push(current);
    if (current === HOME) break;
    current = path.dirname(current);
  }
  return chain;
}

function projectsFallbackRoot(cwd) {
  const relative = path.relative(PROJECTS_DIR, cwd);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;

  const parts = relative.split(path.sep).filter(Boolean);
  if (parts.length === 0) return null;

  let depth = 1;
  while (depth < parts.length && depth <= MAX_CONTAINER_DESCENT) {
    const candidate = path.join(PROJECTS_DIR, ...parts.slice(0, depth));
    if (hasRegularFiles(candidate)) break;
    depth += 1;
  }
  return path.join(PROJECTS_DIR, ...parts.slice(0, depth));
}

function mainWorktreeRoot(root) {
  // Сессионные воркtree'и в `.claude/worktrees/*` — тот же проект, а не новый: ведём их в папку основного репозитория.
  try {
    const commonDir = execFileSync('git', ['-C', root, 'rev-parse', '--path-format=absolute', '--git-common-dir'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000,
    }).trim();
    if (!commonDir.endsWith(`${path.sep}.git`)) return root;
    const mainRoot = path.dirname(commonDir);
    return fs.existsSync(mainRoot) ? mainRoot : root;
  } catch {
    return root;
  }
}

function detectRoot(cwd) {
  // Домашняя папка почти всегда содержит какой-нибудь маркер, но проектом не является.
  const withMarker = ancestors(cwd).filter((dir) => dir !== HOME).find(hasMarker);
  const root = withMarker ? mainWorktreeRoot(withMarker) : projectsFallbackRoot(cwd);
  // В macOS один и тот же путь приходит то в NFC, то в NFD («Моё»), и без нормализации проект двоится.
  return root ? root.normalize('NFC') : null;
}

function normalizeRemote(url) {
  const withoutCreds = url.replace(/\/\/[^@/]+@/, '//');
  const scpStyle = withoutCreds.replace(/^([^@]+)@([^:]+):/, '$2/');
  return scpStyle
    .replace(/^[a-z+]+:\/\//i, '')
    .replace(/\.git$/, '')
    .replace(/\/+$/, '')
    .toLowerCase();
}

function gitRemote(root) {
  try {
    const url = execFileSync('git', ['-C', root, 'config', '--get', 'remote.origin.url'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000,
    }).trim();
    return url || null;
  } catch {
    return null;
  }
}

function identify(root) {
  const remote = gitRemote(root);
  const normalized = remote ? normalizeRemote(remote) : null;
  return {
    root,
    folderName: path.basename(root),
    pathHash: hash12(root),
    remote: normalized,
    remoteHash: normalized ? hash12(normalized) : null,
  };
}

function isIgnored(root) {
  return fs.existsSync(path.join(root, '.case-study-ignore'));
}

function caseDirFor(entry) {
  return path.join(loadConfig().casesRoot, entry.folderName);
}

function resolveProject(cwd, { create = false, patch = {} } = {}) {
  const root = detectRoot(cwd);
  if (!root) return { root: null, tracking: 'none' };

  const identity = identify(root);
  const ignored = isIgnored(root);

  const existing = registry.lookup(identity);
  // В облаке спросить некого и реестр каждый раз новый: проект сразу ведётся, если нет .case-study-ignore.
  const cloudPatch = IS_CLOUD && !existing && !ignored ? { tracking: 'enabled' } : {};
  if (!existing && !create && !IS_CLOUD) {
    return { root, identity, entry: null, caseDir: null, tracking: ignored ? 'disabled' : 'unknown' };
  }

  const entry = registry.upsert(identity, ignored ? { ...patch, tracking: 'disabled' } : { ...cloudPatch, ...patch });
  const caseDir = caseDirFor(entry);
  return { root, identity, entry, caseDir, tracking: entry.tracking };
}

function setTracking(cwd, tracking) {
  const resolved = resolveProject(cwd, { create: true, patch: { tracking } });
  if (!resolved.root) throw new Error('текущая папка не распознана как проект');
  if (tracking === 'enabled') ensureDir(path.join(resolved.caseDir, 'media'));
  return resolved;
}

function noteAsked(cwd) {
  const current = resolveProject(cwd, { create: true });
  if (!current.root) throw new Error('текущая папка не распознана как проект');

  const askedCount = (current.entry.askedCount || 0) + 1;
  const patch =
    askedCount >= loadConfig().maxAskCount ? { askedCount, tracking: 'disabled' } : { askedCount };

  return resolveProject(cwd, { create: true, patch });
}

module.exports = {
  detectRoot,
  mainWorktreeRoot,
  identify,
  isIgnored,
  resolveProject,
  setTracking,
  noteAsked,
  caseDirFor,
  normalizeRemote,
  hash12,
};

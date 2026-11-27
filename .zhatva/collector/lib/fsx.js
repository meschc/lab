const fs = require('fs');
const path = require('path');

const MAX_ERROR_CHARS = 2000;
const LOCK_STALE_MS = 30000;
const LOCK_RETRY_MS = 60;
const LOCK_MAX_RETRIES = 40;

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw new Error(`не удалось прочитать ${file}: ${err.message}`);
  }
}

function writeTextAtomic(file, text) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, file);
}

function writeJsonAtomic(file, value) {
  writeTextAtomic(file, `${JSON.stringify(value, null, 2)}\n`);
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function acquireLock(lockFile) {
  ensureDir(path.dirname(lockFile));
  for (let attempt = 0; attempt < LOCK_MAX_RETRIES; attempt += 1) {
    try {
      const fd = fs.openSync(lockFile, 'wx');
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      return true;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      let age = 0;
      try {
        age = Date.now() - fs.statSync(lockFile).mtimeMs;
      } catch {
        continue;
      }
      if (age > LOCK_STALE_MS) {
        try { fs.unlinkSync(lockFile); } catch {}
        continue;
      }
      sleepSync(LOCK_RETRY_MS);
    }
  }
  return false;
}

function withLock(lockFile, fn) {
  if (!acquireLock(lockFile)) {
    throw new Error(`не удалось взять блокировку ${lockFile} — другой проход ещё идёт`);
  }
  try {
    return fn();
  } finally {
    try { fs.unlinkSync(lockFile); } catch {}
  }
}

function appendError(caseDir, context, err) {
  try {
    ensureDir(caseDir);
    // В тексте ошибки execFileSync лежит вся команда, а команда — это промпт со всем сырьём: без обрезки лог растёт на сотню килобайт за запись.
    const full = err && err.stack ? err.stack : String(err);
    const message = full.length > MAX_ERROR_CHARS ? `${full.slice(0, MAX_ERROR_CHARS)}… (обрезано, всего ${full.length})` : full;
    fs.appendFileSync(
      path.join(caseDir, 'errors.log'),
      `${new Date().toISOString()} [${context}] ${message}\n`,
      'utf8'
    );
  } catch {}
}

module.exports = {
  ensureDir,
  readJson,
  writeTextAtomic,
  writeJsonAtomic,
  withLock,
  appendError,
};

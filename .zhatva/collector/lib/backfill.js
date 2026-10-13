const fs = require('fs');
const path = require('path');
const { loadConfig, HOME } = require('./config');
const { withLock, ensureDir, appendError } = require('./fsx');
const { resolveProject, detectRoot } = require('./project');
const { readEvents, countTurns, isSummaryJob } = require('./transcript');
const { collectRaw, ingestMedia, ingestInlineImages, showcaseBody, mergeCandidates } = require('./capture-pass');
const store = require('./doc-store');
const { writeHtml } = require('./html-render');

const PROJECTS_DIR = path.join(HOME, '.claude', 'projects');
const HEAD_BYTES = 64 * 1024;
const MAX_TRANSCRIPT_BYTES = 64 * 1024 * 1024;
const MEDIA_FACTOR = 3;
const MAX_SAMPLED_CWDS = 8;

function transcriptFiles() {
  let dirs;
  try {
    dirs = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw new Error(`не удалось прочитать ${PROJECTS_DIR}: ${err.message}`);
  }

  return dirs
    .filter((d) => d.isDirectory())
    .flatMap((d) => {
      const dir = path.join(PROJECTS_DIR, d.name);
      try {
        return fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).map((f) => path.join(dir, f));
      } catch {
        return [];
      }
    });
}

function readWindow(fd, size, position) {
  const buffer = Buffer.alloc(size);
  const read = fs.readSync(fd, buffer, 0, size, position);
  return buffer.subarray(0, read).toString('utf8');
}

function scanCwds(file) {
  // Имя папки транскрипта теряет кириллицу, поэтому проект опознаём по полю `cwd` внутри файла.
  // Одного первого `cwd` мало: сессия десктопного приложения нередко начинается в scratch-workspace
  // и переезжает в проект уже по ходу — по первой записи такая сессия не достанется никому.
  let fd;
  try {
    fd = fs.openSync(file, 'r');
  } catch {
    return null;
  }

  try {
    const size = fs.fstatSync(fd).size;
    const windows = [readWindow(fd, Math.min(HEAD_BYTES, size), 0)];
    if (size > HEAD_BYTES) windows.push(readWindow(fd, HEAD_BYTES, size - HEAD_BYTES));

    const cwds = new Set();
    let at = null;

    for (const window of windows) {
      for (const line of window.split('\n')) {
        if (!line.trim() || cwds.size >= MAX_SAMPLED_CWDS) continue;
        let record;
        try {
          record = JSON.parse(line);
        } catch {
          continue;
        }
        if (!record || !record.cwd) continue;
        if (!at) at = record.timestamp || null;
        cwds.add(String(record.cwd));
      }
    }

    return cwds.size ? { cwds: [...cwds], at } : null;
  } finally {
    fs.closeSync(fd);
  }
}

function matcher(root) {
  const cache = new Map();

  return (rawCwd) => {
    const cwd = rawCwd.normalize('NFC');
    // Сессионные worktree'и лежат рядом с основным репозиторием, а не внутри него, поэтому по префиксу пути
    // их не отсеять: корень каждого cwd определяет detectRoot (он сводит worktree к основному репозиторию).
    // Результат кешируется по cwd, так что диск и git опрашиваются один раз на уникальный путь.
    if (!cache.has(cwd)) {
      try {
        cache.set(cwd, detectRoot(cwd) === root);
      } catch {
        cache.set(cwd, false);
      }
    }
    return cache.get(cwd);
  };
}

function fileTime(file) {
  try {
    return new Date(fs.statSync(file).mtimeMs).toISOString();
  } catch {
    return new Date().toISOString();
  }
}

function fileSize(file) {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

function selectTranscripts(root) {
  const belongs = matcher(root);

  return transcriptFiles()
    .map((file) => ({ file, head: scanCwds(file) }))
    .filter(({ file, head }) => head && head.cwds.some(belongs) && !isSummaryJob(file))
    .map(({ file, head }) => ({
      file,
      // Живой хук режет session_id до 8 символов — ключи чекпоинтов обязаны совпасть, иначе сессия перечитается с нуля.
      sessionId: path.basename(file, '.jsonl').slice(0, 8),
      at: head.at || fileTime(file),
      size: fileSize(file),
    }))
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

function importOne(acc, transcript, ctx) {
  const known = acc.sessions[transcript.sessionId] || { lastProcessedLine: 0 };
  const { events, lastLine } = readEvents(transcript.file, known.lastProcessedLine);
  if (!events.length) return { ...acc, skipped: acc.skipped + 1 };

  const raw = collectRaw(events, ctx.root);
  const limit = ctx.limit;
  const stored =
    ingestMedia(ctx.caseDir, raw.mediaCandidates.slice(0, limit * MEDIA_FACTOR), transcript.sessionId) +
    ingestInlineImages(ctx.caseDir, events, transcript.sessionId);

  const withRaw = [
    { sectionKey: 'unexpected-moments', lines: raw.unexpected.slice(0, limit) },
    { sectionKey: 'decisions', lines: raw.decisions.slice(0, limit) },
  ].reduce(
    (doc, part) => store.appendRaw(doc, { ...part, sessionId: transcript.sessionId, at: transcript.at }),
    acc.doc
  );

  return {
    doc: withRaw,
    sessions: {
      ...acc.sessions,
      [transcript.sessionId]: { lastProcessedLine: lastLine, lastStopAt: transcript.at, backfilled: true },
    },
    candidates: mergeCandidates(acc.candidates, raw.openCandidates),
    imported: acc.imported + 1,
    skipped: acc.skipped,
    media: acc.media + stored,
    turns: acc.turns + countTurns(events),
  };
}

function refreshLock(lockFile) {
  // Импорт идёт минутами, а чужой проход считает блокировку старше 30 с протухшей.
  try {
    const now = new Date();
    fs.utimesSync(lockFile, now, now);
  } catch {}
}

const earliest = (a, b) => (a && b ? (a < b ? a : b) : a || b);

function backfill(cwd, { onProgress = () => {} } = {}) {
  const project = resolveProject(cwd);
  if (!project.root) throw new Error('текущая папка не распознана как проект');
  if (project.tracking !== 'enabled') {
    throw new Error(`проект не отслеживается (${project.tracking}). Включить: /case-study on`);
  }

  const { caseDir, root, entry } = project;
  ensureDir(path.join(caseDir, 'media'));

  const transcripts = selectTranscripts(root);
  const oversized = transcripts.filter((t) => t.size > MAX_TRANSCRIPT_BYTES);
  const usable = transcripts.filter((t) => t.size <= MAX_TRANSCRIPT_BYTES);
  const lockFile = path.join(caseDir, '.pass.lock');
  const limit = loadConfig().maxBackfillPerSession;

  return withLock(lockFile, () => {
    const state = store.loadState(caseDir, entry.pathHash);
    const now = new Date().toISOString();

    const start = {
      doc: store.loadDoc(caseDir, entry.folderName),
      sessions: { ...state.sessions },
      candidates: state.openCandidates || [],
      imported: 0,
      skipped: 0,
      media: 0,
      turns: state.turnsSinceUpgrade || 0,
    };

    const result = usable.reduce((acc, transcript, index) => {
      onProgress({ index: index + 1, total: usable.length, sessionId: transcript.sessionId });
      refreshLock(lockFile);
      try {
        return importOne(acc, transcript, { caseDir, root, limit });
      } catch (err) {
        // Один битый транскрипт не должен ронять импорт всей истории.
        appendError(caseDir, `backfill:${transcript.sessionId}`, err);
        return { ...acc, skipped: acc.skipped + 1 };
      }
    }, start);

    const created = earliest(state.created, transcripts[0] ? transcripts[0].at : null) || now;
    const meta = { pathHash: entry.pathHash, created, updated: now };
    const doc = store.setSectionBody(result.doc, 'showcase', showcaseBody(caseDir));

    store.saveDoc(caseDir, doc, meta);
    writeHtml(caseDir, doc, meta);
    store.saveState(caseDir, {
      ...state,
      created,
      // Сведение оставляем обычному апгрейду: импорт — только сырьё.
      turnsSinceUpgrade: result.turns,
      sessions: result.sessions,
      openCandidates: result.candidates,
    });

    return {
      caseDir,
      found: transcripts.length,
      imported: result.imported,
      skipped: result.skipped,
      oversized: oversized.length,
      media: result.media,
      created,
    };
  });
}

module.exports = { backfill, selectTranscripts };

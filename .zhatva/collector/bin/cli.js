#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { resolveProject, setTracking, noteAsked } = require('../lib/project');
const { backfill } = require('../lib/backfill');
const store = require('../lib/doc-store');
const { loadIndex } = require('../lib/media-store');
const { writeHtml } = require('../lib/html-render');
const { withLock } = require('../lib/fsx');

const IMPACT_RE = /(польз|выгод|бизнес|пользовател|метрик)/i;

function requireTracked() {
  const project = resolveProject(process.cwd());
  if (!project.root) throw new Error('текущая папка не распознана как проект');
  if (project.tracking !== 'enabled') {
    throw new Error(`проект не отслеживается (${project.tracking}). Включить: /case-study on`);
  }
  return project;
}

function status() {
  const project = resolveProject(process.cwd());
  if (!project.root) return 'Текущая папка не распознана как проект — кейс не ведётся.';
  if (project.tracking !== 'enabled') {
    return `Проект «${path.basename(project.root)}» не отслеживается (${project.tracking}). Включить: /case-study on`;
  }

  const doc = store.loadDoc(project.caseDir, project.entry.folderName);
  const state = store.loadState(project.caseDir, project.entry.pathHash);
  const mediaItems = loadIndex(project.caseDir);

  const rows = doc.sections.map((section) => {
    const raw = section.entries.reduce((sum, e) => sum + e.raw.length, 0);
    const synth = section.entries.some((e) => e.synthesis) || Boolean(section.body);
    return `  ${section.title}: raw ${raw}, сведено ${synth ? 'да' : 'нет'}`;
  });

  return [
    `Кейс: ${project.caseDir}`,
    `Сессий учтено: ${Object.keys(state.sessions || {}).length}. Медиа: ${mediaItems.length}. Открытых моментов: ${(state.openCandidates || []).length}.`,
    'Секции:',
    ...rows,
  ].join('\n');
}

function show(sectionTitle) {
  const project = requireTracked();
  const text = fs.readFileSync(store.docFile(project.caseDir), 'utf8');
  if (!sectionTitle) return text;

  const doc = store.parseDoc(text, project.entry.folderName);
  const section = doc.sections.find((s) => s.title.toLowerCase().startsWith(sectionTitle.toLowerCase()));
  if (!section) throw new Error(`секция «${sectionTitle}» не найдена`);

  const entries = section.entries
    .map((e) => [`### ${e.heading}`, e.raw.map((r) => `- ${r}`).join('\n'), e.synthesis].filter(Boolean).join('\n'))
    .join('\n\n');

  return `## ${section.title}\n\n${section.body || entries || '(пусто)'}`;
}

function log(note) {
  if (!note) throw new Error('нужен текст заметки: /case-study log <заметка>');
  const project = requireTracked();
  const now = new Date().toISOString();
  const sectionKey = IMPACT_RE.test(note) ? 'impact' : 'unexpected-moments';

  return withLock(path.join(project.caseDir, '.pass.lock'), () => {
    const state = store.loadState(project.caseDir, project.entry.pathHash);
    const doc = store.appendRaw(store.loadDoc(project.caseDir, project.entry.folderName), {
      sectionKey,
      sessionId: 'вручную',
      at: now,
      lines: [note],
    });

    const meta = { pathHash: project.entry.pathHash, created: state.created || now, updated: now };
    store.saveDoc(project.caseDir, doc, meta);
    writeHtml(project.caseDir, doc, meta);

    return `Записано в «${store.titleOf(sectionKey)}» → ${project.caseDir}`;
  });
}

function reportProgress({ index, total, sessionId }) {
  if (index === 1 || index === total || index % 10 === 0) {
    process.stderr.write(`  ${index}/${total} ${sessionId}\n`);
  }
}

function runBackfill() {
  const result = backfill(process.cwd(), { onProgress: reportProgress });
  if (!result.found) return 'Прошлых сессий этого проекта в ~/.claude/projects не нашлось.';

  const oversized = result.oversized ? `, пропущено крупных: ${result.oversized}` : '';
  return [
    `История импортирована в ${result.caseDir}`,
    `Сессий найдено: ${result.found}, разобрано: ${result.imported}, без нового материала: ${result.skipped}${oversized}.`,
    `Медиа добавлено: ${result.media}. Начало истории: ${result.created.slice(0, 10)}.`,
    'Связный текст появится на ближайшем LLM-апгрейде — импорт кладёт только сырьё.',
  ].join('\n');
}

const COMMANDS = {
  status,
  show: (...args) => show(args.join(' ')),
  log: (...args) => log(args.join(' ').trim()),
  on: () => `Сбор включён → ${setTracking(process.cwd(), 'enabled').caseDir}`,
  off: () => {
    setTracking(process.cwd(), 'disabled');
    return 'Сбор для этого проекта выключен.';
  },
  backfill: runBackfill,
  later: () => {
    const { tracking } = noteAsked(process.cwd());
    return tracking === 'disabled'
      ? 'Ответа так и не было — больше про этот проект не спрашиваю. Включить вручную: /case-study on'
      : 'Хорошо, спрошу в другой раз.';
  },
};

function main() {
  const [command = 'status', ...args] = process.argv.slice(2);
  const handler = COMMANDS[command];
  if (!handler) throw new Error(`неизвестная команда «${command}». Доступно: ${Object.keys(COMMANDS).join(', ')}`);
  process.stdout.write(`${handler(...args)}\n`);
}

try {
  main();
} catch (err) {
  process.stderr.write(`case-study: ${err.message}\n`);
  process.exit(1);
}

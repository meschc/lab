#!/usr/bin/env node
const path = require('path');
const { loadConfig, IS_CLOUD } = require('../lib/config');
const { ensureDir } = require('../lib/fsx');
const { resolveProject } = require('../lib/project');
const { loadState } = require('../lib/doc-store');
const { loadIndex } = require('../lib/media-store');
const { isRecursiveCall } = require('../lib/llm-upgrade');
const { runHook, emitSessionContext } = require('../lib/hook-io');

const CLI = path.join(__dirname, '..', 'bin', 'cli.js');

function askContext(root, name) {
  return [
    `Папка проекта \`${root}\` ещё не отслеживается сборщиком кейсов.`,
    'Сам вопрос задавай не сразу и не в каждой сессии: сперва посмотри, о чём просит пользователь.',
    'Если разговор не про работу над этим проектом (игры, фильмы, бытовые или справочные вопросы, разовая мелочь) — молчи и ничего не вызывай.',
    'Когда станет видно, что человек действительно работает над проектом (код, дизайн, тексты, продукт), один раз вызови инструмент AskUserQuestion:',
    `header «Кейс», вопрос «Собирать материал для статьи-кейса по проекту “${name}”?», варианты «Да, собирать» и «Нет, не нужно».`,
    `По ответу выполни \`node ${CLI} on\` или \`node ${CLI} off\`, при уходе от ответа — \`node ${CLI} later\`.`,
    'Второй раз за сессию не спрашивай.',
  ].join(' ');
}

function summaryContext(project) {
  const state = loadState(project.caseDir, project.entry.pathHash);
  const open = (state.openCandidates || []).length;
  const mediaCount = loadIndex(project.caseDir).length;

  return [
    `Сборщик кейсов пишет материал этого проекта в \`${project.caseDir}\`.`,
    `Накоплено медиа: ${mediaCount}. Открытых неожиданных моментов с прошлых сессий: ${open}.`,
    'Работай как обычно — сбор идёт фоном.',
    ...(IS_CLOUD
      ? ['Это облачная сессия: папка кейса лежит в `.zhatva/` репозитория. В конце работы добавь `.zhatva/` в коммит вместе с остальными изменениями и скажи об этом пользователю — репозиторий публичный.']
      : []),
  ].join(' ');
}

runHook('session-start', (input) => {
  if (isRecursiveCall()) return;

  const cwd = input.cwd || process.cwd();
  const project = resolveProject(cwd);
  if (!project.root || project.tracking === 'disabled') return;

  if (project.tracking === 'enabled') {
    ensureDir(path.join(project.caseDir, 'media'));
    emitSessionContext(summaryContext(project));
    return;
  }

  // Счётчик растёт не здесь, а в `cli.js later`: приглашение ещё не значит, что вопрос задали.
  const asked = project.entry ? project.entry.askedCount : 0;
  if (asked >= loadConfig().maxAskCount) return;

  emitSessionContext(askContext(project.root, path.basename(project.root)));
});

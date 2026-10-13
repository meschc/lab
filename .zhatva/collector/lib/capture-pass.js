const path = require('path');
const { loadConfig } = require('./config');
const { withLock, appendError, ensureDir } = require('./fsx');
const { resolveProject } = require('./project');
const { readEvents, countTurns, isSummaryJob } = require('./transcript');
const { collectImages } = require('./inline-images');
const { findUnexpectedMoments, findDecisionMarkers, findMediaPaths } = require('./mechanical-extract');
const media = require('./media-store');
const store = require('./doc-store');
const { showcaseItems } = require('./media-filter');
const llm = require('./llm-upgrade');
const { gitFacts } = require('./git-facts');
const { writeHtml } = require('./html-render');
const { loadArticle, saveArticle } = require('./article-data');

const lockFile = (caseDir) => path.join(caseDir, '.pass.lock');

function collectRaw(events, projectRoot) {
  const { failures, fixes } = findUnexpectedMoments(events);
  const decisions = findDecisionMarkers(events);

  return {
    unexpected: [...failures, ...fixes].map((m) => m.summary),
    decisions: decisions.map((d) => d.summary),
    mediaCandidates: findMediaPaths(events, projectRoot),
    openCandidates: failures,
  };
}

function ingestMedia(caseDir, candidates, sessionId) {
  return candidates
    .map((candidate) => media.ingestFile(caseDir, { ...candidate, sessionId }))
    .filter((result) => result.stored).length;
}

function showcaseBody(caseDir) {
  const items = showcaseItems(media.loadIndex(caseDir));
  if (!items.length) return '';

  const line = (item) =>
    item.type === 'video'
      ? `[${item.caption || 'Видео'}](media/${item.file})`
      : `![${item.caption || ''}](media/${item.file})`;

  const images = items.filter((i) => i.type === 'image');
  const videos = items.filter((i) => i.type === 'video');

  return [
    images.length ? `### Изображения\n\n${images.map(line).join('\n\n')}` : '',
    videos.length ? `### Видео\n\n${videos.map(line).join('\n\n')}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

// Кадры внутри транскрипта: живой PostToolUse их уже сохранил (дубль отсеет хеш), а сессии из облака
// и импорт истории иначе остались бы без единого снимка.
function inlineImages(events) {
  const toolNames = new Map(events.filter((e) => e.kind === 'tool_use').map((e) => [e.id, e.name]));

  return events
    .filter((e) => e.kind === 'tool_result' || e.kind === 'image')
    .flatMap((e) =>
      collectImages(e.raw).map((image) => ({
        ...image,
        at: e.at,
        // Картинки, присланные в чат, бывают и чужими референсами — храним, но в витрину не ставим.
        origin: e.kind === 'image' ? 'chat' : 'tool',
        contextExcerpt:
          e.kind === 'image' ? 'изображение из переписки' : `снимок экрана из ${toolNames.get(e.id) || 'инструмента'}`,
      }))
    );
}

function ingestInlineImages(caseDir, events, sessionId) {
  return inlineImages(events).filter((image) => {
    try {
      const { data, ...meta } = image;
      return media.storeBuffer(caseDir, Buffer.from(data, 'base64'), { ...meta, type: 'image', sessionId }).stored;
    } catch (err) {
      appendError(caseDir, 'inline-images', err);
      return false;
    }
  }).length;
}

const MAX_OPEN_CANDIDATES = 20;

function mergeCandidates(existing = [], incoming = []) {
  const byId = new Map([...existing, ...incoming].map((c) => [c.id, c]));
  return [...byId.values()].slice(-MAX_OPEN_CANDIDATES);
}

const rawCount = (section) => section.entries.reduce((sum, e) => sum + e.raw.length, 0);

// Сведение пишется по всему сырью раздела сразу, поэтому «осталось» считаем строками сырья, а не записями:
// иначе раздел из сотни записей пересводился бы сотню раз подряд по одному и тому же материалу.
function sectionsNeedingUpgrade(doc, marks) {
  return doc.sections
    .filter((s) => !store.GENERATED_SECTIONS.has(s.key))
    .map((s) => ({ section: s, pending: rawCount(s) - (marks[s.key] || 0) }))
    .filter((s) => s.pending > 0)
    .sort((a, b) => b.pending - a.pending);
}

const GOAL_MATERIAL_LINES = 60;
const GOAL_REFRESH_RATIO = 1.5;

function goalMaterial(doc) {
  const synthesis = doc.sections
    .map((s) => s.entries.map((e) => e.synthesis).filter(Boolean).join(' '))
    .filter(Boolean)
    .join('\n');
  if (synthesis) return synthesis;

  return doc.sections
    .flatMap((s) => s.entries.flatMap((e) => e.raw))
    .slice(0, GOAL_MATERIAL_LINES)
    .map((line) => `- ${line}`)
    .join('\n');
}

// Разделы сводятся поодиночке и без общей опоры расходятся в разные статьи. Цель считаем один раз
// и пересчитываем, только когда материала стало заметно больше, — она должна быть устойчивой.
function ensureGoal(doc, state, facts) {
  const total = doc.sections.reduce((sum, section) => sum + rawCount(section), 0);
  if (state.goal && total < (state.goalRawCount || 0) * GOAL_REFRESH_RATIO) {
    return { goal: state.goal, goalRawCount: state.goalRawCount };
  }

  return {
    goal: llm.writeGoal({ projectName: doc.title, material: goalMaterial(doc), facts }),
    goalRawCount: total,
  };
}

// Раздел про задачу продукта нечем подпереть из собственных заметок — что это за продукт и для кого,
// записано в «Мете», поэтому опорное сырьё берём оттуда.
function supportLines(doc, section) {
  return (store.sectionMeta(section.key).supports || []).flatMap((key) => {
    const source = doc.sections.find((s) => s.key === key);
    return source ? source.entries.flatMap((e) => e.raw) : [];
  });
}

// Развилки и цифры держатся на сыром материале решений и сбоев: именно там записано, что случилось,
// что я выбрал и чем это обошлось. Сведённый текст для них слишком гладкий — цену выбора он уже сгладил.
const ARTICLE_SOURCE_SECTIONS = ['decisions', 'unexpected-moments', 'impact'];
const ARTICLE_MATERIAL_LINES = 160;

function articleMaterial(doc, facts) {
  const lines = doc.sections
    .filter((section) => ARTICLE_SOURCE_SECTIONS.includes(section.key))
    .flatMap((section) => section.entries.flatMap((e) => e.raw))
    .slice(-ARTICLE_MATERIAL_LINES)
    .map((line) => `- ${line}`);

  return [facts, ...lines].filter(Boolean).join('\n');
}

function upgradeSection(doc, section, context) {
  const rawLines = section.entries.flatMap((e) => e.raw);
  const previous = section.entries.map((e) => e.synthesis).filter(Boolean).join('\n\n');

  const text =
    section.key === 'impact'
      ? llm.writeImpact({ rawLines, previous, facts: context.facts, goal: context.goal })
      : llm.synthesizeSection({
          sectionTitle: section.title,
          sectionBrief: store.sectionMeta(section.key).brief,
          rawLines,
          support: supportLines(doc, section),
          previous,
          goal: context.goal,
          forks: section.key === 'decisions' ? context.forks : [],
        });

  const marked = section.key === 'impact' ? `${store.DRAFT_MARK}\n${text}` : text;
  return store.setSynthesis(doc, section.key, marked);
}

function runUpgrade(doc, caseDir, projectRoot, created, marks, state) {
  const config = loadConfig();
  const targets = sectionsNeedingUpgrade(doc, marks).slice(0, config.maxSectionsPerUpgrade);
  if (!targets.length) return { doc, marks, goal: state.goal, goalRawCount: state.goalRawCount };

  const facts = gitFacts(projectRoot, created.slice(0, 10));
  const { goal, goalRawCount } = ensureGoal(doc, state, facts);

  const previousArticle = loadArticle(caseDir);
  const material = articleMaterial(doc, facts);
  const forks = llm.extractForks({ material, goal, previous: previousArticle.forks });
  const numbers = llm.extractNumbers({ material });

  const upgraded = targets.reduce((acc, { section }) => upgradeSection(acc, section, { facts, goal, forks }), doc);
  const nextMarks = targets.reduce((acc, { section }) => ({ ...acc, [section.key]: rawCount(section) }), marks);

  const uncaptioned = media.loadIndex(caseDir).filter((item) => item.copied && item.file && !item.caption);
  if (uncaptioned.length) {
    const captions = llm.captionMedia(uncaptioned);
    Object.entries(captions).forEach(([file, caption]) => media.setCaption(caseDir, file, caption));
  }

  // Пару «было/стало» выбираем по подписям, поэтому только после того, как они проставлены.
  const captioned = media.loadIndex(caseDir).filter((item) => item.copied && item.type === 'image');
  const compare = llm.pickCompare(showcaseItems(captioned));
  saveArticle(caseDir, {
    forks: forks.length ? forks : previousArticle.forks,
    numbers: numbers.length ? numbers : previousArticle.numbers,
    compare: compare || previousArticle.compare,
  });

  const summaries = upgraded.sections
    .map((s) => s.entries.map((e) => e.synthesis).filter(Boolean).join(' '))
    .filter(Boolean)
    .join('\n');

  const withLead = summaries
    ? store.setLead(upgraded, llm.writeLead({ projectName: upgraded.title, sectionSummaries: summaries, goal }))
    : upgraded;

  // Витрину пересобираем уже после подписей: тело, собранное до них, осталось бы с пустыми альтами.
  const withShowcase = store.setSectionBody(withLead, 'showcase', showcaseBody(caseDir));

  return { doc: withShowcase, marks: nextMarks, goal, goalRawCount };
}

function capturePass({ cwd, sessionId, transcriptPath, isFinal }) {
  if (llm.isRecursiveCall()) return { skipped: 'recursion' };
  if (isSummaryJob(transcriptPath)) return { skipped: 'сводка контекста' };

  const project = resolveProject(cwd);
  if (project.tracking !== 'enabled') return { skipped: project.tracking };

  const { caseDir, root, entry } = project;
  ensureDir(caseDir);

  return withLock(lockFile(caseDir), () => {
    const state = store.loadState(caseDir, entry.pathHash);
    const session = state.sessions[sessionId] || { lastProcessedLine: 0 };
    const { events, lastLine } = readEvents(transcriptPath, session.lastProcessedLine);

    if (!events.length && !isFinal) return { skipped: 'нет новых строк' };

    const now = new Date().toISOString();
    const raw = collectRaw(events, root);
    const storedMedia =
      ingestMedia(caseDir, raw.mediaCandidates, sessionId) + ingestInlineImages(caseDir, events, sessionId);

    let doc = store.loadDoc(caseDir, entry.folderName);
    doc = store.appendRaw(doc, { sectionKey: 'unexpected-moments', sessionId, at: now, lines: raw.unexpected });
    doc = store.appendRaw(doc, { sectionKey: 'decisions', sessionId, at: now, lines: raw.decisions });
    doc = store.setSectionBody(doc, 'showcase', showcaseBody(caseDir));

    const turns = (state.turnsSinceUpgrade || 0) + countTurns(events);
    const shouldUpgrade = isFinal || turns >= loadConfig().llmUpgradeEveryNTurns;

    let sectionMarks = state.sections || {};
    let goal = state.goal;
    let goalRawCount = state.goalRawCount;
    if (shouldUpgrade) {
      try {
        const upgrade = runUpgrade(doc, caseDir, root, state.created || now, sectionMarks, state);
        doc = upgrade.doc;
        sectionMarks = upgrade.marks;
        goal = upgrade.goal;
        goalRawCount = upgrade.goalRawCount;
      } catch (err) {
        appendError(caseDir, 'llm-upgrade', err);
      }
    }

    const meta = { pathHash: entry.pathHash, created: state.created || now, updated: now };
    store.saveDoc(caseDir, doc, meta);
    writeHtml(caseDir, doc, meta);

    store.saveState(caseDir, {
      ...state,
      created: meta.created,
      sections: sectionMarks,
      goal,
      goalRawCount,
      turnsSinceUpgrade: shouldUpgrade ? 0 : turns,
      sessions: { ...state.sessions, [sessionId]: { lastProcessedLine: lastLine, lastStopAt: now } },
      openCandidates: mergeCandidates(state.openCandidates, raw.openCandidates),
    });

    return { caseDir, storedMedia, upgraded: shouldUpgrade };
  });
}

module.exports = { capturePass, collectRaw, ingestMedia, ingestInlineImages, showcaseBody, mergeCandidates };

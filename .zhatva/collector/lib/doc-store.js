const path = require('path');
const { loadConfig } = require('./config');
const { readJson, writeTextAtomic, writeJsonAtomic, ensureDir } = require('./fsx');
const { redact } = require('./redact');
const fs = require('fs');

// Одного заголовка модели мало: «Проблема» без определения читается как «что у меня сломалось по ходу»,
// хотя в кейсе это задача, которую решает сам продукт. Поэтому у каждого раздела есть описание,
// а `supports` называет разделы, чьё сырьё служит ему опорой.
const SECTIONS = [
  {
    key: 'meta',
    title: 'Мета',
    brief: 'Что это за продукт, для кого он сделан, какая у меня была роль, сроки работы и на чём всё собрано.',
  },
  {
    key: 'problem-context',
    title: 'Проблема и контекст',
    brief:
      'Какую задачу продукт решает для своих пользователей и для дела: как люди обходились до него, почему так жить неудобно и в каких условиях я за это брался. Это проблема снаружи продукта, у его пользователей, а не трудности, с которыми столкнулся я, пока его делал, — тем место в «Неожиданных моментах».',
    supports: ['meta'],
  },
  {
    key: 'decisions',
    title: 'Решения',
    articleTitle: 'Развилки',
    brief:
      'Опора всей статьи: цепочка развилок, на которых я выбирал. По каждой — что было до неё, что я выбрал и чем за выбор заплатил. Пиши связкой между развилками: почему одна привела к следующей, а не списком решений.',
  },
  {
    key: 'unexpected-moments',
    title: 'Неожиданные моменты',
    brief: 'Что пошло не по плану уже в работе над продуктом и чем это кончилось.',
  },
  { key: 'showcase', title: 'Витрина' },
  { key: 'impact', title: 'Польза' },
  {
    key: 'learnings',
    title: 'Уроки',
    articleTitle: 'Что теперь делаю иначе',
    brief:
      'Что изменилось в моей работе после этого проекта: какие решения я теперь принимаю сразу, а какие больше не принимаю. Пиши правилами работы, а не выводами о себе: без «я научился», «главный вывод» и морали в конце.',
  },
];

const sectionMeta = (key) => SECTIONS.find((s) => s.key === key) || {};

const GENERATED_SECTIONS = new Set(['showcase']);
const DRAFT_MARK = '> ЧЕРНОВИК — требует твоей правки';

const docFile = (caseDir) => path.join(caseDir, 'case-study.md');
const stateFile = (caseDir) => path.join(caseDir, 'state.json');

const titleOf = (key) => SECTIONS.find((s) => s.key === key)?.title || key;
const keyOfTitle = (title) => SECTIONS.find((s) => s.title === title)?.key || null;

const emptyDoc = (projectName) => ({
  title: projectName,
  lead: '',
  sections: SECTIONS.map(({ key, title }) => ({ key, title, entries: [], body: '' })),
});

function stripFrontmatter(lines) {
  if (lines[0] !== '---') return lines;
  const end = lines.indexOf('---', 1);
  return end === -1 ? lines : lines.slice(end + 1);
}

function parseEntryBlock(lines) {
  const entry = { heading: '', sessionId: null, raw: [], synthesis: '' };
  let mode = null;

  for (const line of lines) {
    if (line.startsWith('**Raw**')) { mode = 'raw'; continue; }
    if (line.startsWith('**Synthesis**')) { mode = 'synthesis'; continue; }
    if (mode === 'raw' && line.startsWith('- ')) entry.raw.push(line.slice(2));
    else if (mode === 'synthesis') entry.synthesis += `${line}\n`;
  }

  entry.synthesis = entry.synthesis.trim();
  return entry;
}

function splitBy(lines, prefix) {
  const chunks = [];
  let current = null;
  for (const line of lines) {
    if (line.startsWith(prefix)) {
      current = { heading: line.slice(prefix.length).trim(), lines: [] };
      chunks.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  }
  return chunks;
}

function parseDoc(text, projectName) {
  if (!text || !text.trim()) return emptyDoc(projectName);

  const lines = stripFrontmatter(text.split('\n'));
  const titleIndex = lines.findIndex((l) => l.startsWith('# '));
  const title = titleIndex === -1 ? projectName : lines[titleIndex].slice(2).trim();

  const afterTitle = lines.slice(titleIndex + 1);
  const firstSection = afterTitle.findIndex((l) => l.startsWith('## '));
  const lead = (firstSection === -1 ? afterTitle : afterTitle.slice(0, firstSection)).join('\n').trim();

  const parsed = new Map(
    splitBy(firstSection === -1 ? [] : afterTitle.slice(firstSection), '## ').map((chunk) => {
      // Генерируемые секции целиком пересобираются из index.json, их «###» — это подзаголовки, а не записи.
      const isGenerated = GENERATED_SECTIONS.has(keyOfTitle(chunk.heading));
      const entryChunks = isGenerated ? [] : splitBy(chunk.lines, '### ');
      const entries = entryChunks.map((e) => {
        const match = e.heading.match(/\(сессия ([\w-]+)\)/);
        return { ...parseEntryBlock(e.lines), heading: e.heading, sessionId: match ? match[1] : null };
      });
      const body = entryChunks.length ? '' : chunk.lines.join('\n').trim();
      return [chunk.heading, { entries, body }];
    })
  );

  return {
    title,
    lead,
    sections: SECTIONS.map(({ key, title: sectionTitle }) => ({
      key,
      title: sectionTitle,
      entries: parsed.get(sectionTitle)?.entries || [],
      body: parsed.get(sectionTitle)?.body || '',
    })),
  };
}

function serializeSection(section) {
  const head = `## ${section.title}`;
  if (section.body) return `${head}\n\n${section.body}\n`;
  if (!section.entries.length) return `${head}\n`;

  const entries = section.entries.map((entry) => {
    const raw = entry.raw.length ? `**Raw**\n${entry.raw.map((r) => `- ${r}`).join('\n')}\n` : '';
    const synthesis = entry.synthesis ? `**Synthesis**\n${entry.synthesis}\n` : '';
    return [`### ${entry.heading}`, raw, synthesis].filter(Boolean).join('\n');
  });

  return `${head}\n\n${entries.join('\n')}`;
}

function serializeDoc(doc, meta) {
  const counts = doc.sections
    .map((s) => `  ${s.key}: { entryCount: ${s.entries.length} }`)
    .join('\n');

  const frontmatter = [
    '---',
    `project: ${doc.title}`,
    `projectHash: ${meta.pathHash}`,
    `created: ${meta.created}`,
    `updated: ${meta.updated}`,
    'sections:',
    counts,
    '---',
  ].join('\n');

  const body = doc.sections.map(serializeSection).join('\n');
  return `${frontmatter}\n\n# ${doc.title}\n\n${doc.lead ? `${doc.lead}\n\n` : ''}${body}`;
}

function loadDoc(caseDir, projectName) {
  try {
    return parseDoc(fs.readFileSync(docFile(caseDir), 'utf8'), projectName);
  } catch (err) {
    if (err.code === 'ENOENT') return emptyDoc(projectName);
    throw new Error(`не удалось прочитать case-study.md: ${err.message}`);
  }
}

function saveDoc(caseDir, doc, meta) {
  ensureDir(caseDir);
  writeTextAtomic(docFile(caseDir), serializeDoc(doc, meta));
}

const defaultState = (pathHash) => ({
  pathHash,
  tracking: 'enabled',
  created: new Date().toISOString(),
  sessions: {},
  sections: {},
  openCandidates: [],
});

function loadState(caseDir, pathHash) {
  return readJson(stateFile(caseDir), null) || defaultState(pathHash);
}

function saveState(caseDir, state) {
  ensureDir(caseDir);
  writeJsonAtomic(stateFile(caseDir), state);
}

function entryHeading(sessionId, at) {
  return `${at.slice(0, 16)} (сессия ${sessionId})`;
}

function appendRaw(doc, { sectionKey, sessionId, at, lines }) {
  const cleaned = lines.map((l) => redact(String(l).replace(/\s+/g, ' ').trim())).filter(Boolean);
  if (!cleaned.length) return doc;

  const limit = loadConfig().maxRawPerEntry;

  return {
    ...doc,
    sections: doc.sections.map((section) => {
      if (section.key !== sectionKey) return section;

      const last = section.entries[section.entries.length - 1];
      const canExtend = last && last.sessionId === sessionId && last.raw.length + cleaned.length <= limit;

      if (canExtend) {
        const extended = { ...last, raw: [...last.raw, ...cleaned] };
        return { ...section, entries: [...section.entries.slice(0, -1), extended] };
      }

      const fresh = {
        heading: entryHeading(sessionId, at),
        sessionId,
        raw: cleaned,
        synthesis: '',
      };
      return { ...section, entries: [...section.entries, fresh] };
    }),
  };
}

function setSynthesis(doc, sectionKey, text) {
  return {
    ...doc,
    sections: doc.sections.map((section) => {
      if (section.key !== sectionKey || !section.entries.length) return section;
      const last = section.entries[section.entries.length - 1];
      return {
        ...section,
        entries: [...section.entries.slice(0, -1), { ...last, synthesis: text.trim() }],
      };
    }),
  };
}

function setSectionBody(doc, sectionKey, body) {
  return {
    ...doc,
    sections: doc.sections.map((s) => (s.key === sectionKey ? { ...s, body } : s)),
  };
}

const setLead = (doc, lead) => ({ ...doc, lead: lead.trim() });

module.exports = {
  SECTIONS,
  sectionMeta,
  GENERATED_SECTIONS,
  DRAFT_MARK,
  docFile,
  loadDoc,
  saveDoc,
  parseDoc,
  serializeDoc,
  loadState,
  saveState,
  appendRaw,
  setSynthesis,
  setSectionBody,
  setLead,
  titleOf,
  keyOfTitle,
};

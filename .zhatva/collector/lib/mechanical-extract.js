const path = require('path');
const crypto = require('crypto');
const { redact } = require('./redact');

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);
const VIDEO_EXT = new Set(['.mp4', '.mov', '.webm', '.avi', '.mkv']);

const ERROR_RE = /(error|exception|traceback|failed|not found|cannot find|ошибк|не удалось|сломал)/i;
// «errors []», «0 errors», «без ошибок» — отчёт об успехе, а не сбой: иначе каждая зелёная проверка шла в «неожиданные моменты».
const NO_ERROR_RE = /\berrors?\s*[:=]?\s*(?:\[\s*\]|0\b|none\b)|\b0\s+errors?\b|\bno\s+errors?\b|без ошибок/gi;
// Вывод служебных инструментов — инструкции и справка самого Claude Code, к сбоям в проекте отношения не имеет.
const SERVICE_TOOLS = new Set(['ReadNotifications', 'Skill', 'ToolSearch', 'TaskOutput']);
const FIX_RE = /(исправил|починил|теперь работает|заработал|решил проблем|fixed|now works|resolved)/i;
const DECISION_RE = /(решил|выбрал|вместо того|остановился на|отказался от|decided to|chose|instead of)/i;

const MEDIA_EXT_RE = /\.(?:png|jpe?g|gif|webp|svg|mp4|mov|webm|avi|mkv)$/i;
const TOKEN_SPLIT_RE = /[\s"'`,()[\]{}<>|]+/;
const TRAILING_PUNCT_RE = /[.,;:!?]+$/;
const MAX_SCAN_CHARS = 400000;
const MAX_TOKEN_CHARS = 512;
const MAX_SUMMARY_CHARS = 220;

const looksLikeError = (text) => ERROR_RE.test(String(text || '').replace(NO_ERROR_RE, ''));

const shortId = (value) => crypto.createHash('sha256').update(value).digest('hex').slice(0, 4);

const clip = (text) =>
  text.length > MAX_SUMMARY_CHARS ? `${text.slice(0, MAX_SUMMARY_CHARS).trimEnd()}…` : text;

function describeToolUse(event) {
  if (!event) return 'инструмент';
  const input = event.input || {};
  const target = input.command || input.file_path || input.pattern || input.url || '';
  return target ? `${event.name} \`${clip(String(target))}\`` : event.name;
}

function firstMeaningfulLine(text) {
  const line = String(text || '')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l && looksLikeError(l));
  return line || String(text || '').trim().split('\n')[0] || '';
}

function findUnexpectedMoments(events) {
  const uses = new Map(events.filter((e) => e.kind === 'tool_use').map((e) => [e.id, e]));

  const isServiceResult = (e) => SERVICE_TOOLS.has((uses.get(e.id) || {}).name);

  const failures = events
    .filter((e) => e.kind === 'tool_result' && !isServiceResult(e) && (e.isError || looksLikeError(e.text)))
    .map((e) => {
      const use = uses.get(e.id);
      const summary = redact(clip(firstMeaningfulLine(e.text)));
      return {
        id: shortId(`${e.line}:${summary}`),
        type: 'unexpected-moment',
        at: e.at,
        summary: `${describeToolUse(use)} — ${summary}`,
      };
    });

  const fixes = events
    .filter((e) => e.kind === 'text' && e.role === 'assistant' && FIX_RE.test(e.text || ''))
    .map((e) => {
      const sentence = (e.text.split(/(?<=[.!?])\s+/).find((s) => FIX_RE.test(s)) || e.text).trim();
      return { type: 'resolution', at: e.at, summary: redact(clip(sentence)) };
    });

  return { failures, fixes };
}

function findDecisionMarkers(events) {
  return events
    .filter((e) => e.kind === 'text' && e.role === 'assistant' && DECISION_RE.test(e.text || ''))
    .flatMap((e) =>
      e.text
        .split(/(?<=[.!?])\s+/)
        .filter((s) => DECISION_RE.test(s))
        .map((s) => ({ at: e.at, summary: redact(clip(s.trim())) }))
    );
}

function classify(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (IMAGE_EXT.has(ext)) return { type: 'image', format: ext.slice(1) };
  if (VIDEO_EXT.has(ext)) return { type: 'video', format: ext.slice(1) };
  return null;
}

function candidateStrings(event) {
  // Длинные выводы режем: путь к скриншоту лежит в начале, а полный скан гигабайтов истории того не стоит.
  const cap = (value) => String(value).slice(0, MAX_SCAN_CHARS);

  if (event.kind === 'tool_use') {
    const input = event.input || {};
    return [input.file_path, input.command, input.path, input.notebook_path].filter(Boolean).map(cap);
  }
  if (event.kind === 'tool_result') return [cap(event.text || '')];
  return [];
}

function mediaTokens(source) {
  // Разбор по токенам, а не поиск пути regex'ом по всей строке: жадный вариант откатывался квадратично на мегабайтном выводе тула.
  return source
    .split(TOKEN_SPLIT_RE)
    .map((token) => token.replace(TRAILING_PUNCT_RE, ''))
    .filter((token) => token.length > 2 && token.length <= MAX_TOKEN_CHARS && MEDIA_EXT_RE.test(token));
}

function findMediaPaths(events, projectRoot) {
  const found = new Map();

  for (const event of events) {
    for (const source of candidateStrings(event)) {
      for (const match of mediaTokens(source)) {
        if (match.includes('://')) continue;
        const absolute = path.isAbsolute(match) ? match : path.resolve(projectRoot, match);
        const kind = classify(absolute);
        if (!kind || found.has(absolute)) continue;
        found.set(absolute, {
          sourcePath: absolute,
          ...kind,
          contextExcerpt: redact(clip(source.trim())),
          at: event.at,
        });
      }
    }
  }

  return [...found.values()];
}

module.exports = { findUnexpectedMoments, findDecisionMarkers, findMediaPaths, classify };

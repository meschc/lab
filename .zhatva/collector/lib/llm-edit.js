const { ask, stripPreamble, VOICE, NO_MORAL } = require('./llm-client');
const { lint, issuesBrief } = require('./infostyle');

const MAX_ROUNDS = 2;
// Редактура иногда выносит вместе с водой и половину фактов. Текст короче этой доли считаем
// испорченным и оставляем прежний.
const MIN_KEPT_RATIO = 0.5;

function editOnce(text, issues) {
  const prompt = [
    'Отредактируй текст по правилам инфостиля Максима Ильяхова.',
    VOICE,
    NO_MORAL,
    'Убери лишнее, факты и цифры сохрани все до одного. Смысл не меняй, новых утверждений не добавляй.',
    `Что нашёл линтер:\n${issuesBrief(issues)}`,
    `Текст:\n${text}`,
    'Верни только отредактированный текст.',
  ].join('\n\n');

  return stripPreamble(ask(prompt));
}

const isDamaged = (edited, text) => !edited || edited.length < text.length * MIN_KEPT_RATIO;

// Чистим, пока текст не пройдёт порог, но не больше двух кругов: каждый круг — отдельный вызов
// модели, а дальше оценка почти не растёт. Правку принимаем, только если она улучшила оценку.
function refine(text, round = 0) {
  if (!text || !text.trim()) return text;

  const report = lint(text);
  if (report.isClean || round >= MAX_ROUNDS) return text;

  try {
    const edited = editOnce(text, report.issues);
    if (isDamaged(edited, text)) return text;
    return lint(edited).score > report.score ? refine(edited, round + 1) : text;
  } catch {
    // Редактура — улучшение, а не условие публикации: сорвался вызов, остаётся исходный текст.
    return text;
  }
}

module.exports = { refine };

const { execFileSync } = require('child_process');
const { loadConfig } = require('./config');

const SKIP_ENV = 'CASE_STUDY_COLLECTOR_SKIP';

// Голос статьи. Требования инфостиля вынесены сюда же: дешевле не написать лишнее,
// чем вычищать его вторым проходом.
const VOICE = [
  'Пиши по-русски, от первого лица, как автор статьи о своём проекте.',
  'Только связные абзацы — без списков, заголовков и markdown-разметки.',
  'Короткие предложения: не длиннее двадцати слов.',
  'Без вводных и усилителей: «очень», «просто», «именно», «то есть», «при этом», «в целом».',
  'Без канцелярита: «является», «осуществляет», «в рамках», «данный», «позволяет».',
  'Без оценок вроде «удобный», «эффективный», «мощный» — вместо оценки ставь факт или цифру.',
  'Не пиши служебных формулировок вроде «в ходе сессии», «пользователь попросил», «агент сделал».',
  'Опирайся только на приведённые факты, ничего не выдумывай.',
  'Начинай сразу с текста, без вступления вроде «Пишу раздел» или «Вот текст».',
].join(' ');

// Рассказ о развитии легко сваливается в мораль басни — пользователь такое читать не станет.
const NO_MORAL =
  'Не подводи итогов вроде «благодаря этому я научился» и «главный вывод в том, что». Рост читается из самих решений и их цены, называть его словами не нужно.';

function isRecursiveCall() {
  return process.env[SKIP_ENV] === '1';
}

function ask(prompt, model) {
  // Дочерний claude -p сам триггерит эти же хуки — без флага получится бесконечная рекурсия.
  const config = loadConfig();
  try {
    return execFileSync('claude', ['-p', prompt, '--model', model || config.model], {
      encoding: 'utf8',
      timeout: config.llmTimeoutMs,
      env: { ...process.env, [SKIP_ENV]: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 4 * 1024 * 1024,
    }).trim();
  } catch (err) {
    const reason = String(err.stderr || '').trim() || err.message;
    throw new Error(`claude -p не отработал: ${reason}`);
  }
}

// Модель иногда начинает не с текста, а с рапорта о работе над ним — о том, что сейчас напишет
// или чего не поняла в задании. В статье такой строке не место.
const META_ACTION_RE = /(пишу|напишу|составля|составлю|продолжу|не совсем понял|не понял|вот текст|ниже текст)/i;
const META_SUBJECT_RE = /(раздел|кейс|промпт|запрос|вызов|факт|инструкц)/i;

const isMetaBlock = (block) => META_ACTION_RE.test(block) && META_SUBJECT_RE.test(block);

// Снимаем только первый абзац и только если он про работу над текстом, а не про проект:
// единственный абзац оставляем в любом случае, пустой раздел хуже неловкого зачина.
function stripPreamble(text) {
  const blocks = text.trim().split(/\n{2,}/);
  const kept = blocks.length > 1 && isMetaBlock(blocks[0]) ? blocks.slice(1) : blocks;
  return kept.join('\n\n').trim();
}

// Ответ приходит текстом, JSON в нём бывает обёрнут в ```json или пояснения. Берём самый
// внешний массив и разбираем его; не разобрался — зовущая сторона получает пустой список.
function askJsonArray(prompt, model) {
  const answer = ask(prompt, model);
  const start = answer.indexOf('[');
  const end = answer.lastIndexOf(']');
  if (start === -1 || end <= start) return [];

  try {
    const parsed = JSON.parse(answer.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

module.exports = { ask, askJsonArray, stripPreamble, isRecursiveCall, VOICE, NO_MORAL, SKIP_ENV };

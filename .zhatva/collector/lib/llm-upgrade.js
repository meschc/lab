const path = require('path');
const { loadConfig } = require('./config');
const { ask, stripPreamble, isRecursiveCall, VOICE, NO_MORAL, SKIP_ENV } = require('./llm-client');
const { refine } = require('./llm-edit');
const { extractForks, extractNumbers, pickCompare } = require('./llm-structured');

const MAX_CAPTION_CHARS = 120;
const CONTEXT_CHARS = 200;

function writeGoal({ projectName, material, facts }) {
  const prompt = [
    `Проект: «${projectName}». Сформулируй сквозную цель кейса в 2-3 предложениях: что это за проект, для кого он и какую задачу я в нём решал.`,
    VOICE,
    'Это опора для всей статьи, а не пересказ разделов: без перечислений и без технических подробностей.',
    facts ? `Факты из истории репозитория:\n${facts}` : '',
    `Материал:\n${material}`,
    'Верни только формулировку цели.',
  ]
    .filter(Boolean)
    .join('\n\n');

  return refine(stripPreamble(ask(prompt)));
}

function synthesizeSection({ sectionTitle, sectionBrief, rawLines, support = [], previous, goal, forks = [] }) {
  const prompt = [
    `Раздел статьи-кейса: «${sectionTitle}».`,
    sectionBrief ? `О чём именно этот раздел: ${sectionBrief}` : '',
    VOICE,
    NO_MORAL,
    goal ? `Сквозная цель всей статьи — держись её, раздел должен читаться как её часть, а не как отдельная заметка:\n${goal}` : '',
    // Развилки идут в статье отдельными карточками. Без этой оговорки раздел пересказывает их
    // своими словами, и читатель дважды читает одно и то же.
    forks.length
      ? `Рядом с текстом статья показывает карточки развилок. Не пересказывай их, опирайся на них:\n${forks.map((f) => `- ${f.title}: ${f.chose}`).join('\n')}`
      : '',
    'Объём — один-три абзаца.',
    // Заметки собираются механически и нередко ложатся не в тот раздел: без этой оговорки модель
    // добросовестно пересказывает всё подряд и раздел уезжает мимо своего определения.
    'Заметки собраны автоматически. Те, что не подходят под описание раздела, оставь другим разделам, а не пересказывай здесь.',
    previous ? `Предыдущая версия текста (уточни её, не переписывай с нуля):\n${previous}` : '',
    support.length ? `Факты о продукте для опоры:\n${support.map((l) => `- ${l}`).join('\n')}` : '',
    `Сырые заметки:\n${rawLines.map((l) => `- ${l}`).join('\n')}`,
    'Верни только текст раздела.',
  ]
    .filter(Boolean)
    .join('\n\n');

  return refine(stripPreamble(ask(prompt)));
}

function writeLead({ projectName, sectionSummaries, goal }) {
  const prompt = [
    `Проект: «${projectName}». Нужен лид статьи-кейса: 2-3 предложения о том, про что этот кейс.`,
    VOICE,
    NO_MORAL,
    goal ? `Сквозная цель статьи:\n${goal}` : '',
    `Содержание разделов:\n${sectionSummaries}`,
    'Верни только лид.',
  ]
    .filter(Boolean)
    .join('\n\n');

  return refine(stripPreamble(ask(prompt)));
}

function writeImpact({ rawLines, previous, facts, goal }) {
  const prompt = [
    'Раздел статьи-кейса: «Польза». Два абзаца: чем это помогает пользователю и чем — делу.',
    VOICE,
    NO_MORAL,
    goal ? `Сквозная цель всей статьи:\n${goal}` : '',
    'Не используй общие слова вроде «повысило эффективность» без опоры на факт ниже.',
    facts ? `Факты из истории репозитория:\n${facts}` : '',
    previous ? `Предыдущий черновик (уточни его):\n${previous}` : '',
    rawLines.length ? `Сырые заметки:\n${rawLines.map((l) => `- ${l}`).join('\n')}` : '',
    'Верни только текст раздела.',
  ]
    .filter(Boolean)
    .join('\n\n');

  return refine(stripPreamble(ask(prompt)));
}

function captionMedia(items) {
  if (!items.length) return {};

  // Путь к файлу говорит о кадре больше, чем обрывок вывода тула рядом с ним («before/landing/light-desktop»),
  // поэтому даём модели и то, и другое.
  const listing = items
    .map((item, index) => {
      const where = item.sourcePath ? path.join(path.basename(path.dirname(item.sourcePath)), path.basename(item.sourcePath)) : item.file;
      const context = (item.contextExcerpt || '').replace(/\s+/g, ' ').trim().slice(0, CONTEXT_CHARS);
      return `${index + 1}. [${item.type}] путь: ${where}${context ? `; рядом в логе: ${context}` : ''}`;
    })
    .join('\n');

  const prompt = [
    `Ниже ${items.length} пунктов: изображения и видео из проекта с описанием момента, в котором они появились.`,
    'Сами файлы не прилагаются и не нужны — подпись пиши по описанию, не пытайся рассматривать картинку.',
    'Для каждого пункта — одна короткая подпись на русском, до 70 символов, без кавычек, без номера и без пояснений.',
    `Ответь ровно ${items.length} строками в том же порядке. Если по описанию сказать нечего, поставь в строке прочерк.`,
    listing,
  ].join('\n\n');

  // Подпись к картинке — механика на одну строку, гонять её большой моделью незачем.
  const lines = ask(prompt, loadConfig().captionModel)
    .split('\n')
    .map((l) => l.replace(/^\d+[.)]\s*/, '').trim())
    .filter((l) => l);

  // Модель иногда отвечает не подписями, а рассуждением, и оно построчно разъезжается по файлам.
  // Порядок здесь — единственная связь строки с файлом, поэтому кривой ответ отбрасываем целиком: подписи допишет следующий проход.
  if (lines.length !== items.length) return {};

  return Object.fromEntries(
    items
      .map((item, index) => [item.file, lines[index]])
      .filter(([, caption]) => caption && caption !== '-' && caption !== '—' && caption.length <= MAX_CAPTION_CHARS)
  );
}

module.exports = {
  isRecursiveCall,
  ask,
  stripPreamble,
  writeGoal,
  synthesizeSection,
  writeLead,
  writeImpact,
  captionMedia,
  extractForks,
  extractNumbers,
  pickCompare,
  SKIP_ENV,
};

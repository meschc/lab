const { askJsonArray, VOICE, NO_MORAL } = require('./llm-client');
const { loadConfig } = require('./config');

const MAX_FORKS = 6;
const MAX_NUMBERS = 6;
const FORK_FIELD_CHARS = 110;
const NUMBER_VALUE_CHARS = 12;
const NUMBER_LABEL_CHARS = 34;

const clean = (value, limit) =>
  String(value == null ? '' : value)
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[«"]|[»"]$/g, '')
    .slice(0, limit);

// Статья держится на цепочке развилок: у каждой — что было, что выбрал и чем заплатил.
// Рост читается из того, как меняется цена выбора, поэтому морали тут не нужно.
function extractForks({ material, goal, previous = [] }) {
  const prompt = [
    'Разбери материал проекта на развилки: моменты, где я выбирал между вариантами.',
    VOICE,
    NO_MORAL,
    goal ? `Сквозная цель статьи:\n${goal}` : '',
    `Верни JSON-массив, не больше ${MAX_FORKS} объектов, в хронологическом порядке.`,
    'Поля объекта: "title" — тема развилки в одно-два слова; "before" — как было до неё; "chose" — что я выбрал; "paid" — чем за это заплатил.',
    'Каждое поле — одна фраза без точки в конце, до пятнадцати слов. Цифры из материала сохраняй.',
    'Развилка без цены выбора не развилка: если платить было нечем, такой пункт пропусти.',
    previous.length ? `Уже найденные развилки — уточни их, не выдумывай заново:\n${JSON.stringify(previous, null, 1)}` : '',
    `Материал:\n${material}`,
    'Верни только JSON-массив.',
  ]
    .filter(Boolean)
    .join('\n\n');

  return askJsonArray(prompt)
    .map((fork) => ({
      title: clean(fork.title, 40),
      before: clean(fork.before, FORK_FIELD_CHARS),
      chose: clean(fork.chose, FORK_FIELD_CHARS),
      paid: clean(fork.paid, FORK_FIELD_CHARS),
    }))
    .filter((fork) => fork.title && fork.before && fork.chose && fork.paid)
    .slice(0, MAX_FORKS);
}

// Цифры уже лежат в заметках, но внутри абзацев их не видно. Выносим их из прозы в данные.
function extractNumbers({ material }) {
  const prompt = [
    'Найди в материале проекта измеримые факты и верни их числами.',
    // Первая версия выносила всё, что считается: «13 коммитов», «228 правок в src/components».
    // Такая цифра описывает процесс, а читатель кейса ищет результат, который можно купить.
    'Это полоса цифр под заголовком кейса. Она продаёт работу: каждая цифра показывает результат для продукта, пользователя или бизнеса — охват, качество, надёжность, скорость, масштаб.',
    'Не бери цифры процесса: число коммитов, правок, сессий, файлов в папке, имена папок и файлов кода. Не бери мелкие правки вёрстки: пиксели, радиусы, высоты элементов.',
    'Переход «было→стало» пиши текстовой стрелкой «→»; в подписи повтори стрелку со словами, если без них непонятно, что с чем сравнивают: «строк → файлов».',
    `Верни JSON-массив, не больше ${MAX_NUMBERS} объектов, самые сильные первыми. Лучше четыре сильные цифры, чем шесть проходных.`,
    'Поля: "value" — само число или переход, коротко: «152», «536», «4,5→6,8»; "label" — что это, до четырёх слов, без точки, понятно человеку не из разработки.',
    'Бери только то, что прямо есть в материале. Ничего не округляй и не придумывай.',
    'Одинаковые по смыслу цифры не повторяй.',
    `Материал:\n${material}`,
    'Верни только JSON-массив.',
  ].join('\n\n');

  return askJsonArray(prompt)
    .map((item) => ({ value: clean(item.value, NUMBER_VALUE_CHARS), label: clean(item.label, NUMBER_LABEL_CHARS) }))
    .filter((item) => item.value && item.label && /\d/.test(item.value))
    .slice(0, MAX_NUMBERS);
}

// Пару «было/стало» ищем по подписям: два кадра одного экрана до и после правки. Пары нет —
// возвращаем null, и блок сравнения в статье просто не появляется.
function pickCompare(items) {
  if (items.length < 2) return null;

  const listing = items.map((item, index) => `${index + 1}. ${item.caption || item.file}`).join('\n');
  const prompt = [
    'Ниже подписи к кадрам одного проекта.',
    'Найди пару, где один и тот же экран снят до и после изменения.',
    'Верни JSON-массив ровно из двух чисел: сначала номер кадра «до», потом «после».',
    'Подходящей пары нет — верни пустой массив. Не подбирай пару приблизительно.',
    listing,
    'Верни только JSON-массив.',
  ].join('\n\n');

  const pair = askJsonArray(prompt, loadConfig().captionModel)
    .map((n) => Number(n) - 1)
    .filter((n) => Number.isInteger(n) && n >= 0 && n < items.length);

  if (pair.length !== 2 || pair[0] === pair[1]) return null;
  return { before: items[pair[0]].file, after: items[pair[1]].file };
}

module.exports = { extractForks, extractNumbers, pickCompare };

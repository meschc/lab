// Проверки текста статьи-кейса: читаемость, плотность, жаргон, канцелярит, голос автора.
// Пороги подобраны под экран телефона и читателя-нанимателя, а не под техническую документацию.
const LIMITS = {
  sentenceWords: 20,
  paragraphWords: 55,
  jargonPer100: 4,
  nominalPer100: 6,
  readingWpm: 180,
  wordsBetweenFrames: 180,
  leadWords: 45,
};

const WORD_RE = /[A-Za-zА-Яа-яЁё0-9][A-Za-zА-Яа-яЁё0-9\-–./_\[\]()#:@→]*/g;
const LATIN_RE = /[A-Za-z]/;
const VOWELS_RE = /[аеёиоуыэюяaeiouy]/gi;
const NOMINAL_RE = /(?:ние|ния|нию|нием|нии|ций|ция|ции|цию|цией|ость|ости|остью)$/i;

// Главред-подобные стоп-слова: канцелярит, ослабители, пустые связки.
const STOP_WORDS = [
  'является', 'являются', 'осуществл', 'данный', 'данного', 'данной', 'в рамках', 'в том числе',
  'достаточно', 'очень', 'весьма', 'определённ', 'различн', 'ряд ', 'в целом', 'по сути',
  'фактически', 'именно', 'при этом', 'в свою очередь', 'на данном этапе', 'сам по себе',
  'не потому что', 'а потому что', 'тем самым', 'так называем',
];

// Рост показываем выбором, а не декларацией «я понял».
const DECLARED_GROWTH = ['научил', 'понял', 'осознал', 'больше не ', 'теперь я', 'я теперь', 'урок'];

// Следы того, что текст писал агент о своей сессии, а не автор о своём проекте. Сами слова
// «владелец» и «агент» не ловим: владелец склада — предмет кейса, а про работу с ИИ автор вправе сказать сам.
const AGENT_VOICE = [
  'владелец продукта', 'владельца продукта', 'владельцу продукта', 'владельцем продукта',
  'токен', 'сесси', 'claude', 'пользовател', 'задача недели',
];

const words = (text) => text.match(WORD_RE) || [];
const sentences = (text) => text.split(/(?<=[.!?…])\s+(?=[«А-ЯЁA-Z0-9])/).filter((s) => words(s).length);
const syllables = (word) => Math.max(1, (word.match(VOWELS_RE) || []).length);
const isJargon = (word) => LATIN_RE.test(word) || /[/_\[\]#]|--|\(\)/.test(word);
const hits = (text, list) => list.filter((needle) => text.toLowerCase().includes(needle));
const per100 = (count, total) => (total ? Math.round((count / total) * 1000) / 10 : 0);

// Индекс Флеша в адаптации Оборневой для русского: 80+ легко, 50–80 нормально, ниже 30 — тяжело.
function fleschRu(text) {
  const w = words(text);
  const s = sentences(text);
  if (!w.length || !s.length) return 0;
  const asl = w.length / s.length;
  const asw = w.reduce((sum, word) => sum + syllables(word), 0) / w.length;
  return Math.round(206.835 - 1.52 * asl - 65.14 * asw);
}

function checkParagraph(text) {
  const w = words(text);
  const long = sentences(text).filter((s) => words(s).length > LIMITS.sentenceWords);
  const jargon = w.filter(isJargon);
  const nominal = w.filter((word) => NOMINAL_RE.test(word));
  return {
    words: w.length,
    flesch: fleschRu(text),
    longSentences: long.map((s) => `${words(s).length} сл.: ${s.slice(0, 70)}…`),
    jargon: [...new Set(jargon)],
    jargonPer100: per100(jargon.length, w.length),
    nominalPer100: per100(nominal.length, w.length),
    numbers: (text.match(/\d+/g) || []).length,
    stopWords: hits(text, STOP_WORDS),
    declaredGrowth: hits(text, DECLARED_GROWTH),
    agentVoice: hits(text, AGENT_VOICE),
  };
}

function problemsOf(report) {
  return [
    report.words > LIMITS.paragraphWords && `абзац ${report.words} сл. (порог ${LIMITS.paragraphWords})`,
    report.longSentences.length && `длинные предложения: ${report.longSentences.length}`,
    report.jargonPer100 > LIMITS.jargonPer100 && `жаргон ${report.jargonPer100}/100: ${report.jargon.slice(0, 6).join(', ')}`,
    report.nominalPer100 > LIMITS.nominalPer100 && `отглагольные сущ. ${report.nominalPer100}/100`,
    report.stopWords.length && `стоп-слова: ${report.stopWords.join(', ')}`,
    report.declaredGrowth.length && `рост декларацией: ${report.declaredGrowth.join(', ')}`,
    report.agentVoice.length && `голос агента: ${report.agentVoice.join(', ')}`,
  ].filter(Boolean);
}

// blocks: [{kind: 'lead'|'h2'|'p'|'frame'|'fork', text}] в порядке чтения.
function checkArticle(blocks) {
  const prose = blocks.filter((b) => b.kind === 'p' || b.kind === 'lead' || b.kind === 'fork');
  const allText = prose.map((b) => b.text).join(' ');
  const totalWords = words(allText).length;

  const gaps = blocks.reduce((acc, b) => {
    if (b.kind === 'frame') return { ...acc, runs: [...acc.runs, acc.run], run: 0 };
    // Карточки развилок — сами по себе визуальная полоса, сплошным текстом они не читаются.
    if (b.kind === 'fork') return acc.run ? { ...acc, runs: [...acc.runs, acc.run], run: 0 } : acc;
    return { ...acc, run: acc.run + (b.kind === 'h2' ? 0 : words(b.text).length) };
  }, { run: 0, runs: [] });
  const lead = blocks.find((b) => b.kind === 'lead');

  return {
    totalWords,
    readingMinutes: Math.round((totalWords / LIMITS.readingWpm) * 10) / 10,
    flesch: fleschRu(allText),
    leadWords: lead ? words(lead.text).length : 0,
    headings: blocks.filter((b) => b.kind === 'h2').map((b) => b.text),
    longestTextRun: Math.max(...gaps.runs, gaps.run),
    paragraphs: prose.map((b) => ({ kind: b.kind, head: b.text.slice(0, 60), ...checkParagraph(b.text) }))
      .map((r) => ({ ...r, problems: problemsOf(r) })),
    // Скан-тест: заголовки, первые фразы абзацев и цифры — то, что видит пробегающий глазами.
    skim: blocks.filter((b) => b.kind !== 'frame')
      .map((b) => (b.kind === 'h2' ? `\n## ${b.text}` : `  ${sentences(b.text)[0] || ''}`)),
  };
}

module.exports = { LIMITS, checkArticle, checkParagraph, fleschRu };

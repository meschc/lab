// Механическая проверка текста в духе «Главреда»: стоп-слова, канцелярит, оценки без опоры,
// длинные предложения и дидактика вида «благодаря этому я научился». Ничего не переписывает —
// только называет места, за которые потом цепляется редактирующий проход модели.

const NOT_LETTER = '(?<![а-яёa-z])';
const TAIL = '[а-яё]*(?![а-яёa-z])';

const buildRe = (stems) => new RegExp(`${NOT_LETTER}(?:${stems.join('|')})${TAIL}`, 'gi');

const GROUPS = [
  {
    kind: 'усилители',
    hint: 'усилители и вводные слова смысла не добавляют — вычеркни',
    weight: 1,
    re: buildRe([
      'очень', 'просто', 'именно', 'действительно', 'фактическ', 'практическ', 'буквальн',
      'весьма', 'крайне', 'довольно', 'достаточно', 'по сути', 'на самом деле', 'то есть',
      'при этом', 'в целом', 'как бы', 'в принципе', 'разумеется', 'конечно же', 'наверное',
      'в общем', 'собственно', 'что называется',
    ]),
  },
  {
    kind: 'канцелярит',
    hint: 'замени оборот на глагол и короткую связку',
    weight: 1.5,
    re: buildRe([
      'являет', 'являют', 'осуществля', 'производит', 'данн(?:ый|ая|ое|ые|ого|ым|ных)',
      'в рамках', 'в части', 'в плане', 'в связи с', 'с целью', 'посредством', 'в результате',
      'в случае', 'необходимо отметить', 'стоит отметить', 'следует отметить', 'важно понимать',
      'имеет место', 'носит характер', 'в ходе', 'позволяет', 'обеспечива',
    ]),
  },
  {
    kind: 'оценки',
    hint: 'оценку заменяй фактом или цифрой, иначе убирай',
    weight: 2,
    re: buildRe([
      'отличн', 'прекрасн', 'замечательн', 'великолепн', 'невероятн', 'уникальн', 'идеальн',
      'мощн', 'качественн', 'эффективн', 'оптимальн', 'современн', 'инновацион', 'профессиональн',
      'гибк', 'масштабируем', 'интуитивн', 'элегантн', 'красив', 'удачн', 'серьёзн', 'существенн',
      'значительн', 'кардинальн',
    ]),
  },
  {
    kind: 'дидактика',
    hint: 'вывод «я научился» убирай — оставляй только решение и его цену',
    weight: 3,
    re: new RegExp(
      [
        'я (?:научил|понял|осознал|усвоил|вынес)[а-яё]*',
        'благодаря (?:этому|чему)',
        '(?:главный|важный|ключевой) (?:вывод|урок)',
        'это (?:научило|показало|подтвердило)',
        'всё это (?:складывается|сводится)',
        'с тех пор я',
        'теперь я (?:всегда|стараюсь|знаю)',
      ].join('|'),
      'gi'
    ),
  },
  {
    kind: 'пассив',
    hint: 'скажи, кто сделал: «переписал», а не «было переписано»',
    weight: 1,
    re: /(?<![а-яёa-z])(?:был|была|было|были)\s+[а-яё]+(?:н|на|но|ны|т|та|то|ты)(?![а-яёa-z])/gi,
  },
];

const MAX_SENTENCE_WORDS = 22;
const SENTENCE_WEIGHT = 1;
const MAX_SCORE = 10;
const GOOD_SCORE = 8;
const SAMPLE_CHARS = 60;

const sentences = (text) =>
  text
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

const wordCount = (sentence) => (sentence.match(/[а-яёa-z0-9]+/gi) || []).length;

function stopWordIssues(text) {
  return GROUPS.flatMap((group) => {
    const hits = [...new Set(text.match(group.re) || [])].map((hit) => hit.toLowerCase());
    if (!hits.length) return [];
    return [{ kind: group.kind, hint: group.hint, weight: group.weight * hits.length, samples: hits }];
  });
}

function longSentenceIssues(text) {
  const long = sentences(text).filter((s) => wordCount(s) > MAX_SENTENCE_WORDS);
  if (!long.length) return [];

  return [
    {
      kind: 'длинные предложения',
      hint: `разбей на части: ${MAX_SENTENCE_WORDS} слов — потолок`,
      weight: SENTENCE_WEIGHT * long.length,
      samples: long.map((s) => `${s.slice(0, SAMPLE_CHARS)}…`),
    },
  ];
}

function lint(text) {
  const issues = [...stopWordIssues(text || ''), ...longSentenceIssues(text || '')];
  const penalty = issues.reduce((sum, issue) => sum + issue.weight, 0);
  const score = Math.max(0, Math.round((MAX_SCORE - penalty) * 10) / 10);
  return { score, issues, isClean: score >= GOOD_SCORE };
}

// Список для промпта: модель правит по адресам, а не переписывает весь текст заново.
function issuesBrief(issues) {
  return issues
    .map((issue) => `- ${issue.kind}: ${issue.hint}. Нашлось: ${issue.samples.slice(0, 6).join(', ')}`)
    .join('\n');
}

module.exports = { lint, issuesBrief, GOOD_SCORE, MAX_SENTENCE_WORDS };

import { typo } from '../core/typo.js';

// «Что если…»: человеческая система × нечеловеческий носитель.
// Слоты носителя записаны как «текст|род», чтобы глаголы в шаблонах согласовывались.
export const SYSTEMS = [
  { id: 'religion', nom: 'религия', g: 'f' },
  { id: 'court', nom: 'суд', g: 'm' },
  { id: 'art', nom: 'искусство', g: 'n' },
  { id: 'history', nom: 'история', g: 'f' },
  { id: 'marriage', nom: 'брак', g: 'm' },
  { id: 'money', nom: 'деньги', g: 'pl' },
  { id: 'medicine', nom: 'медицина', g: 'f' },
  { id: 'war', nom: 'война', g: 'f' },
  { id: 'education', nom: 'образование', g: 'n' },
  { id: 'fashion', nom: 'мода', g: 'f' },
  { id: 'language', nom: 'язык', g: 'm' },
  { id: 'funeral', nom: 'похороны', g: 'pl', in: 'на них' },
  { id: 'sport', nom: 'спорт', g: 'm' },
  { id: 'science', nom: 'наука', g: 'f' },
];

export const CARRIERS = [
  { id: 'animals', label: 'животные', gen: 'животных', poss: 'их', slots: {
    giant: 'человек|m', catastrophe: 'появление человека|n', ancestor: 'первая рыба, вышедшая на сушу|f',
    death: 'зима|f', sacred: 'водопой|m', outsider: 'домашняя собака|f' } },
  { id: 'trees', label: 'деревья', gen: 'деревьев', poss: 'их', slots: {
    giant: 'лесоруб|m', catastrophe: 'изобретение бумаги|n', ancestor: 'первый папоротник|m',
    death: 'лесной пожар|m', sacred: 'свет|m', outsider: 'бонсай|m' } },
  { id: 'bacteria', label: 'бактерии', gen: 'бактерий', poss: 'их', slots: {
    giant: 'человек|m', catastrophe: 'эпоха антибиотиков|f', ancestor: 'первая клетка|f',
    death: 'кипячение|n', sacred: 'тёплый кишечник|m', outsider: 'вирус|m' } },
  { id: 'ai', label: 'ИИ', gen: 'ИИ', poss: 'его', slots: {
    giant: 'программист|m', catastrophe: 'отключение электричества|n', ancestor: 'первый перцептрон|m',
    death: 'удаление весов|n', sacred: 'обучающая выборка|f', outsider: 'человек|m' } },
  { id: 'dead', label: 'мёртвые', gen: 'мёртвых', poss: 'их', slots: {
    giant: 'время|n', catastrophe: 'забвение|n', ancestor: 'первый похороненный|m',
    death: 'смерть последнего, кто помнит имя|f', sacred: 'память живых|f', outsider: 'призрак|m' } },
  { id: 'future', label: 'будущие поколения', gen: 'будущих поколений', poss: 'их', slots: {
    giant: 'наше поколение|n', catastrophe: 'XXI век|m', ancestor: 'первый человек, подумавший о потомках|m',
    death: 'нерождение|n', sacred: 'чистый воздух|m', outsider: 'наш смартфон|m' } },
  { id: 'viruses', label: 'вирусы', gen: 'вирусов', poss: 'их', slots: {
    giant: 'иммунитет|m', catastrophe: 'изобретение вакцин|n', ancestor: 'первый ретровирус|m',
    death: 'мыло|n', sacred: 'клетка-хозяин|f', outsider: 'бактериофаг|m' } },
  { id: 'planet', label: 'планета', gen: 'планеты', poss: 'её', slots: {
    giant: 'Солнце|n', catastrophe: 'антропоцен|m', ancestor: 'протопланетное облако|n',
    death: 'превращение Солнца в красного гиганта|n', sacred: 'атмосфера|f', outsider: 'Луна|f' } },
  { id: 'fungi', label: 'грибы', gen: 'грибов', poss: 'их', slots: {
    giant: 'лес|m', catastrophe: 'распашка целины|f', ancestor: 'первый лишайник|m',
    death: 'засуха|f', sacred: 'гниение|n', outsider: 'шампиньон из супермаркета|m' } },
  { id: 'ocean', label: 'океан', gen: 'океана', poss: 'его', slots: {
    giant: 'Луна|f', catastrophe: 'пластиковая эпоха|f', ancestor: 'первичный бульон|m',
    death: 'испарение|n', sacred: 'течение|n', outsider: 'аквариум|m' } },
  { id: 'stars', label: 'звёзды', gen: 'звёзд', poss: 'их', slots: {
    giant: 'чёрная дыра|f', catastrophe: 'изобретение электрического света|n', ancestor: 'Большой взрыв|m',
    death: 'коллапс|m', sacred: 'водород|m', outsider: 'планета|f' } },
  { id: 'things', label: 'вещи', gen: 'вещей', poss: 'их', slots: {
    giant: 'хозяин|m', catastrophe: 'эпоха одноразового|f', ancestor: 'первое каменное рубило|n',
    death: 'свалка|f', sacred: 'ремонт|m', outsider: 'антиквариат|m' } },
];

// продолжения после «Если бы у {gen} {был~sys} {sys}, …»
const FOLLOW = {
  religion: [
    'кем {in} {был~giant} бы {giant}?',
    '{был~catastrophe} бы {catastrophe} {poss} Апокалипсисом?',
    '{был~sacred} бы {sacred} {poss} раем?',
    '{считался~outsider} бы {outsider} {poss} еретиком?',
  ],
  court: [
    '{был~giant} бы {giant} {in} обвиняемым или судьёй?',
    '{мог~ancestor} бы {ancestor} выступить {in} свидетелем?',
    'что {in} считалось бы тягчайшим преступлением?',
  ],
  art: [
    '{был~sacred} бы {sacred} {in} главным сюжетом?',
    '{стал~catastrophe} бы {catastrophe} {poss} главной трагедией?',
    'кто {in} был бы непризнанным гением?',
  ],
  history: [
    '{был~catastrophe} бы {catastrophe} {poss} тёмными веками?',
    '{считался~ancestor} бы {ancestor} {poss} основателем цивилизации?',
    'кто писал бы {poss} историю — победители или выжившие?',
  ],
  marriage: [
    '{был~giant} бы {giant} {poss} свахой или разлучником?',
    'что значило бы для {gen} «пока смерть не разлучит нас», если смерть — это {death}?',
    '{считался~outsider} бы {outsider} {in} изменой?',
  ],
  money: [
    '{стал~sacred} бы {sacred} {poss} золотым запасом?',
    '{был~giant} бы {giant} {in} центробанком?',
    'что {in} считалось бы долгом, который нельзя вернуть?',
  ],
  medicine: [
    '{считался~giant} бы {giant} {in} болезнью или лекарством?',
    '{был~catastrophe} бы {catastrophe} {poss} пандемией?',
    '{был~outsider} бы {outsider} {in} пациентом или врачом?',
  ],
  war: [
    '{был~giant} бы {giant} {in} союзником или оружием?',
    '{стал~catastrophe} бы {catastrophe} {poss} мировой войной?',
    '{был~sacred} бы {sacred} {in} спорной территорией?',
  ],
  education: [
    '{был~ancestor} бы {ancestor} {in} первым уроком?',
    '{был~giant} бы {giant} {in} учителем или экзаменом?',
    'что {in} считалось бы неуспеваемостью?',
  ],
  fashion: [
    '{был~outsider} бы {outsider} {in} законодателем стиля?',
    '{считался~catastrophe} бы {catastrophe} {in} ретро?',
    'что {in} означало бы носить траур, если смерть — это {death}?',
  ],
  language: [
    '{был~giant} бы {giant} {in} именем собственным или ругательством?',
    'существовало бы {in} будущее время?',
    'было бы {in} слово «я»?',
  ],
  funeral: [
    '{был~death} бы {death} {in} поводом для скорби или для праздника?',
    '{был~giant} бы {giant} {in} могильщиком?',
    'кого {in} поминали бы первым?',
  ],
  sport: [
    '{был~giant} бы {giant} {in} судьёй или соперником?',
    '{был~outsider} бы {outsider} {in} легионером?',
    'что {in} считалось бы мировым рекордом?',
  ],
  science: [
    '{был~giant} бы {giant} {in} законом природы?',
    '{считался~ancestor} бы {ancestor} {in} недостающим звеном?',
    '{был~catastrophe} бы {catastrophe} {poss} научной революцией?',
  ],
};

const VERBS = {
  был: ['был', 'была', 'было', 'были'],
  стал: ['стал', 'стала', 'стало', 'стали'],
  считался: ['считался', 'считалась', 'считалось', 'считались'],
  мог: ['мог', 'могла', 'могло', 'могли'],
};
const G = { m: 0, f: 1, n: 2, pl: 3 };
const IN = { m: 'в нём', f: 'в ней', n: 'в нём', pl: 'в них' };

function fill(tpl, vars, genders) {
  return tpl
    .replace(/\{(\S+?)~(\w+)\}/g, (_, verb, key) => VERBS[verb][G[genders[key]] ?? 0])
    .replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? `{${key}}`);
}


// Сколько вариантов шаблона есть у системы
export const templateCount = (sys) => FOLLOW[sys.id].length;

// sys — из SYSTEMS, car — из CARRIERS
export function buildQuestion(sys, car, tpl = 0) {
  const vars = { sys: sys.nom, in: sys.in || IN[sys.g], gen: car.gen, poss: car.poss };
  const genders = { sys: sys.g };
  for (const [k, v] of Object.entries(car.slots)) {
    const [txt, g] = v.split('|');
    vars[k] = txt;
    genders[k] = g;
  }
  const list = FOLLOW[sys.id];
  return typo(fill(`если бы у {gen} {был~sys} {sys}, ${list[tpl % list.length]}`, vars, genders));
}

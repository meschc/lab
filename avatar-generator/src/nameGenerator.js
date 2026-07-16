'use strict';

// Русские прилагательные — регулярные, твёрдая основа.
// Окончания: муж. "ый", жен. "ая", ср. "ое".
const RU_ADJ_STEMS = [
  'Молчалив', 'Храбр', 'Быстр', 'Ленив', 'Горд',
  'Хитр', 'Весёл', 'Сонн', 'Мудр', 'Свиреп',
  'Загадочн', 'Упрям', 'Смел', 'Спокойн', 'Задумчив',
  'Пушист', 'Грозн', 'Забавн', 'Суров', 'Игрив',
  'Добр', 'Умн', 'Сильн', 'Слаб', 'Серьёзн',
  'Нагл', 'Вежлив', 'Бодр', 'Хмур', 'Честн',
  'Верн', 'Шустр', 'Скромн', 'Важн', 'Славн',
  'Отважн', 'Бесстрашн', 'Нежн', 'Мрачн', 'Резв',
  'Буйн', 'Задорн', 'Пуглив', 'Величав', 'Статн',
  'Румян', 'Космат', 'Ушаст', 'Полосат', 'Пятнист',
  'Крылат', 'Зубаст', 'Клыкаст', 'Носат', 'Лохмат',
  'Мохнат', 'Рогат', 'Хвостат'
];

const RU_ENDINGS = { m: 'ый', f: 'ая', n: 'ое' };

// Животные с указанием рода.
const RU_ANIMALS = [
  { word: 'Носорог', gender: 'm' }, { word: 'Волк', gender: 'm' },
  { word: 'Медведь', gender: 'm' }, { word: 'Тигр', gender: 'm' },
  { word: 'Лев', gender: 'm' }, { word: 'Барсук', gender: 'm' },
  { word: 'Слон', gender: 'm' }, { word: 'Заяц', gender: 'm' },
  { word: 'Кот', gender: 'm' }, { word: 'Лис', gender: 'm' },
  { word: 'Барс', gender: 'm' }, { word: 'Бобр', gender: 'm' },
  { word: 'Крот', gender: 'm' }, { word: 'Хорёк', gender: 'm' },
  { word: 'Олень', gender: 'm' }, { word: 'Лось', gender: 'm' },
  { word: 'Морж', gender: 'm' }, { word: 'Пёс', gender: 'm' },
  { word: 'Бык', gender: 'm' }, { word: 'Баран', gender: 'm' },
  { word: 'Козёл', gender: 'm' }, { word: 'Осёл', gender: 'm' },
  { word: 'Дятел', gender: 'm' }, { word: 'Филин', gender: 'm' },
  { word: 'Бегемот', gender: 'm' }, { word: 'Верблюд', gender: 'm' },
  { word: 'Дельфин', gender: 'm' }, { word: 'Пингвин', gender: 'm' },
  { word: 'Ястреб', gender: 'm' }, { word: 'Орёл', gender: 'm' },
  { word: 'Сокол', gender: 'm' }, { word: 'Ворон', gender: 'm' },
  { word: 'Кабан', gender: 'm' }, { word: 'Ёж', gender: 'm' },

  { word: 'Лиса', gender: 'f' }, { word: 'Сова', gender: 'f' },
  { word: 'Выдра', gender: 'f' }, { word: 'Рысь', gender: 'f' },
  { word: 'Пантера', gender: 'f' }, { word: 'Черепаха', gender: 'f' },
  { word: 'Белка', gender: 'f' }, { word: 'Кошка', gender: 'f' },
  { word: 'Змея', gender: 'f' }, { word: 'Утка', gender: 'f' },
  { word: 'Лань', gender: 'f' }, { word: 'Норка', gender: 'f' },
  { word: 'Ласка', gender: 'f' }, { word: 'Куница', gender: 'f' },
  { word: 'Росомаха', gender: 'f' }, { word: 'Антилопа', gender: 'f' },
  { word: 'Газель', gender: 'f' }, { word: 'Зебра', gender: 'f' },
  { word: 'Корова', gender: 'f' }, { word: 'Овца', gender: 'f' },
  { word: 'Коза', gender: 'f' }, { word: 'Свинья', gender: 'f' },
  { word: 'Синица', gender: 'f' }, { word: 'Ласточка', gender: 'f' },
  { word: 'Чайка', gender: 'f' }, { word: 'Акула', gender: 'f' },
  { word: 'Щука', gender: 'f' }, { word: 'Пчела', gender: 'f' },
  { word: 'Бабочка', gender: 'f' }, { word: 'Лягушка', gender: 'f' },
  { word: 'Мышь', gender: 'f' }, { word: 'Крыса', gender: 'f' },
  { word: 'Панда', gender: 'f' }, { word: 'Обезьяна', gender: 'f' }
];

const EN_ADJECTIVES = [
  'Silent', 'Brave', 'Swift', 'Lazy', 'Proud',
  'Sly', 'Cheerful', 'Sleepy', 'Wise', 'Fierce',
  'Mysterious', 'Stubborn', 'Bold', 'Calm', 'Thoughtful',
  'Fluffy', 'Grim', 'Funny', 'Stern', 'Playful',
  'Gentle', 'Clever', 'Strong', 'Serious', 'Cocky',
  'Polite', 'Cheeky', 'Grumpy', 'Honest', 'Loyal',
  'Nimble', 'Modest', 'Noble', 'Fearless', 'Tender',
  'Gloomy', 'Frisky', 'Rowdy', 'Curious', 'Timid',
  'Stately', 'Furry', 'Striped', 'Spotted', 'Winged',
  'Toothy', 'Fanged', 'Horned', 'Shaggy', 'Mighty',
  'Quiet', 'Snappy', 'Jolly', 'Dapper', 'Restless',
  'Wild', 'Fuzzy', 'Scruffy', 'Feisty', 'Regal'
];

const EN_ANIMALS = [
  'Rhino', 'Wolf', 'Bear', 'Tiger', 'Lion',
  'Badger', 'Elephant', 'Hare', 'Cat', 'Fox',
  'Owl', 'Otter', 'Lynx', 'Panther', 'Turtle',
  'Squirrel', 'Snake', 'Duck', 'Eagle', 'Falcon',
  'Leopard', 'Cheetah', 'Jaguar', 'Cougar', 'Bison',
  'Moose', 'Elk', 'Deer', 'Boar', 'Walrus',
  'Seal', 'Dolphin', 'Whale', 'Shark', 'Penguin',
  'Hawk', 'Raven', 'Crow', 'Sparrow', 'Swan',
  'Heron', 'Crane', 'Frog', 'Toad', 'Lizard',
  'Gecko', 'Beaver', 'Mole', 'Weasel', 'Ferret',
  'Mongoose', 'Raccoon', 'Panda', 'Koala', 'Sloth',
  'Marten', 'Stoat', 'Bat', 'Hedgehog', 'Mouse'
];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateName(lang) {
  if (lang === 'ru') {
    const stem = pick(RU_ADJ_STEMS);
    const animal = pick(RU_ANIMALS);
    const adj = stem + RU_ENDINGS[animal.gender];
    return `${adj} ${animal.word}`;
  }
  // en по умолчанию
  return `${pick(EN_ADJECTIVES)} ${pick(EN_ANIMALS)}`;
}

module.exports = { generateName };

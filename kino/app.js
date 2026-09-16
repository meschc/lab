'use strict';

const DATA_URL = 'data.json';
const LOGLINE_URL = 'loglines.json';
const PAGE_SIZE = 45;
const RECENT_LIMIT = 25;
const SPIN_FRAMES = 12;
const SPIN_START_MS = 45;
const SPIN_EASE = 1.18;
const TENS_LIMIT = 20;
const TOP_GENRES = 8;
const MOOD_ORDER = [
  'осенний', 'зимний', 'посмеяться', 'поплакать', 'пощекотать нервы', 'вынести мозг',
  'под попкорн', 'для своих', 'аниме', 'наше', 'классика', 'свежак', 'высший балл',
  'жемчужина', 'короткое', 'на весь вечер', 'документальное', 'космос',
];
const MOOD_EMOJI = {
  'осенний': '🍂', 'зимний': '❄️', 'посмеяться': '😂', 'поплакать': '😭',
  'пощекотать нервы': '😱', 'вынести мозг': '🌀', 'под попкорн': '🍿', 'для своих': '👨‍👩‍👧',
  'аниме': '🎌', 'наше': '🇷🇺', 'классика': '🎞️', 'свежак': '✨', 'высший балл': '🏆',
  'жемчужина': '💎', 'короткое': '⏱️', 'на весь вечер': '🌙', 'документальное': '🎓', 'космос': '🚀',
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const state = {
  movies: [],
  done: new Set(),
  kind: 'all',
  mood: null,
  scope: 'watch',
  query: '',
  shown: PAGE_SIZE,
  current: null,
  spinning: false,
  sheet: null,
};

/* ——— утилиты ——— */

const posterUrl = (m, size) =>
  m.p ? `https://avatars.mds.yandex.net/get-kinopoisk-image/${m.p}/${size}`
      : `https://st.kp.yandex.net/images/film_iphone/iphone360_${m.i}.jpg`;

const fallbackUrl = (m) => `https://st.kp.yandex.net/images/film_iphone/iphone360_${m.i}.jpg`;

/* зеркало Кинопоиска — открывается без VPN, структура путей та же */
const kpUrl = (m) => `https://sspoisk.ru/${m.s ? 'series' : 'film'}/${m.i}/`;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const plural = (n, forms) => {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1];
  return forms[2];
};

const runtime = (min) => {
  if (!min) return null;
  if (min < 60) return `${min} мин`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} ч ${m} мин` : `${h} ч`;
};

const readRecent = () => {
  try {
    return JSON.parse(localStorage.getItem('kino_recent') || '[]');
  } catch (err) {
    return [];
  }
};

const pushRecent = (id) => {
  try {
    const next = [id, ...readRecent().filter((x) => x !== id)].slice(0, RECENT_LIMIT);
    localStorage.setItem('kino_recent', JSON.stringify(next));
  } catch (err) {
    /* приватный режим — просто живём без истории */
  }
};

const buzz = (ms) => {
  if (navigator.vibrate) navigator.vibrate(ms);
};

/* ——— локальные отметки «посмотрел» ———
   Кинопоиск не отдаёт запись без авторизации, поэтому отметки живут в браузере
   и накладываются поверх выгрузки при каждом запуске. */

const readDone = () => {
  try {
    return new Set(JSON.parse(localStorage.getItem('kino_done') || '[]'));
  } catch (err) {
    return new Set();
  }
};

const saveDone = (set) => {
  try {
    localStorage.setItem('kino_done', JSON.stringify([...set]));
  } catch (err) {
    /* приватный режим — отметка проживёт до перезагрузки */
  }
};

const isDone = (m) => state.done.has(m.i);

const applyDone = () => {
  state.movies.forEach((m) => {
    m.w0 = m.w || 0;
    m.seen0 = m.seen || 0;
    if (!state.done.has(m.i)) return;
    m.seen = 1;
    m.w = 0;
  });
};

const toggleDone = (m) => {
  const next = new Set(state.done);
  if (next.has(m.i)) {
    next.delete(m.i);
    m.seen = m.seen0;
    m.w = m.w0;
  } else {
    next.add(m.i);
    m.seen = 1;
    m.w = 0;
  }
  state.done = next;
  saveDone(next);
};

/* ——— выборка ——— */

const matchesKind = (m) => state.kind === 'all' || (state.kind === 'series' ? m.s === 1 : !m.s);

const pool = () => state.movies.filter(
  (m) => m.w && matchesKind(m) && (!state.mood || (m.tg || []).includes(state.mood)),
);

const pickRandom = (list) => {
  if (!list.length) return null;
  const recent = readRecent();
  const fresh = list.filter((m) => !recent.includes(m.i));
  const source = fresh.length ? fresh : list;
  return source[Math.floor(Math.random() * source.length)];
};

/* ——— карточка ——— */

const metaLine = (m) => {
  const parts = [];
  if (m.y) parts.push(m.y);
  if (m.s) parts.push('сериал');
  if (m.d) parts.push(runtime(m.d));
  const genres = (m.g || []).slice(0, 2).join(', ');
  if (genres) parts.push(genres);
  return parts.filter(Boolean).join(' · ');
};

const ratesMarkup = (m) => {
  const rates = [];
  if (m.kp) rates.push(`<span class="rate"><i></i>КП <b>${m.kp.toFixed(1)}</b></span>`);
  if (m.im) rates.push(`<span class="rate"><i></i>IMDb <b>${m.im.toFixed(1)}</b></span>`);
  if (m.v) rates.push(`<span class="rate rate--mine"><i></i>моя <b>${m.v}</b></span>`);
  return rates.length ? `<div class="rates">${rates.join('')}</div>` : '';
};

const cardMarkup = (m) => {
  const rates = ratesMarkup(m);
  return `
    <div class="poster">
      <img src="${posterUrl(m, '600x900')}" alt="" loading="eager"
           onerror="this.onerror=null;this.src='${fallbackUrl(m)}'">
      ${m.v ? `<span class="poster__vote">${m.v}</span>` : ''}
    </div>
    <div class="info">
      <h2 class="film">${esc(m.t)}</h2>
      ${m.e ? `<p class="orig">${esc(m.e)}</p>` : ''}
      <p class="meta">${metaLine(m)}</p>
      ${rates}
    </div>`;
};

const setAmbient = (m) => {
  const art = $('#ambientArt');
  art.style.backgroundImage = `url("${posterUrl(m, '300x450')}")`;
  art.parentElement.classList.add('is-on');
};

const showCard = (m, isFinal) => {
  const card = $('#card');
  card.classList.remove('card--empty');
  card.innerHTML = cardMarkup(m);
  card.classList.toggle('is-rolling', !isFinal);
  if (!isFinal) return;
  document.body.classList.add('is-picked');
  setAmbient(m);
  card.classList.remove('is-in');
  void card.offsetWidth;
  card.classList.add('is-in');
};

/* ——— рулетка ——— */

const syncSeenBtn = () => {
  const btn = $('#seenBtn');
  const m = state.current;
  btn.disabled = !m;
  btn.classList.toggle('is-on', !!m && isDone(m));
  btn.title = m && isDone(m) ? 'Убрать отметку' : 'Смотрел';
};

const spin = async () => {
  if (state.spinning) return;
  const list = pool();
  if (!list.length) {
    $('#poolInfo').textContent = 'Под этот фильтр ничего нет — сними настроение';
    buzz(40);
    return;
  }

  state.spinning = true;
  $('#rollBtn').querySelector('.btn__label').textContent = 'Ищу…';
  buzz(12);

  let delay = SPIN_START_MS;
  for (let i = 0; i < SPIN_FRAMES; i += 1) {
    showCard(list[Math.floor(Math.random() * list.length)], false);
    await new Promise((resolve) => setTimeout(resolve, delay));
    delay *= SPIN_EASE;
  }

  const chosen = pickRandom(list);
  state.current = chosen;
  pushRecent(chosen.i);
  showCard(chosen, true);
  buzz([18, 40, 26]);

  $('#kpBtn').disabled = false;
  syncSeenBtn();
  $('#rollBtn').querySelector('.btn__label').textContent = 'Ещё раз';
  state.spinning = false;
};

/* ——— настроения ——— */

const renderMoods = () => {
  const counts = {};
  state.movies.filter((m) => m.w).forEach((m) => (m.tg || []).forEach((t) => {
    counts[t] = (counts[t] || 0) + 1;
  }));
  $('#moods').innerHTML = MOOD_ORDER.filter((t) => counts[t]).map((t) => `
    <button class="mood${state.mood === t ? ' is-on' : ''}" data-mood="${t}">
      <span class="mood__ico">${MOOD_EMOJI[t] || ''}</span>${t}<small>${counts[t]}</small>
    </button>`).join('');
};

const updatePoolInfo = () => {
  const n = pool().length;
  const word = plural(n, ['вариант', 'варианта', 'вариантов']);
  $('#poolInfo').textContent = state.mood
    ? `${n} ${word} · ${state.mood}`
    : `${n} ${word} в списке «Буду смотреть»`;
};

/* ——— каталог ——— */

const tileMarkup = (m) => `
  <a class="tile${isDone(m) ? ' is-done' : ''}" data-id="${m.i}" href="${kpUrl(m)}" target="_blank" rel="noopener">
    <span class="tile__art">
      ${isDone(m) ? '<span class="tile__done">✓</span>' : ''}
      <span class="tile__ph">${esc(m.t)}</span>
      <img src="${posterUrl(m, '300x450')}" alt="" loading="lazy"
           onerror="this.onerror=null;this.src='${fallbackUrl(m)}'">
      ${m.v ? `<span class="tile__vote">${m.v}</span>` : ''}
    </span>
    <span class="tile__name">${esc(m.t)}</span>
    ${m.y ? `<span class="tile__year">${m.y}</span>` : ''}
  </a>`;

const filteredList = () => {
  const q = state.query.trim().toLowerCase();
  return state.movies
    .filter((m) => (state.scope === 'watch' ? m.w : m.seen))
    .filter((m) => {
      if (!q) return true;
      const hay = `${m.t} ${m.e || ''} ${m.y || ''} ${(m.g || []).join(' ')}`;
      return hay.toLowerCase().includes(q);
    })
    .sort((a, b) => (b.kp || 0) - (a.kp || 0));
};

const renderList = () => {
  const list = filteredList();
  const slice = list.slice(0, state.shown);
  $('#grid').innerHTML = slice.map(tileMarkup).join('');
  $('#listMeta').textContent = `${list.length} ${plural(list.length, ['фильм', 'фильма', 'фильмов'])} · по рейтингу КП`;
  $('#moreBtn').hidden = slice.length >= list.length;
};

/* ——— шторка с карточкой фильма ——— */

const SHEET_ANIM_MS = 340;

const sheetMarkup = (m) => {
  const tags = (m.tg || []).map((t) => `<span class="sheet__tag">${MOOD_EMOJI[t] || ''} ${t}</span>`).join('');
  return `
    <div class="sheet__top">
      <img class="sheet__art" src="${posterUrl(m, '300x450')}" alt=""
           onerror="this.onerror=null;this.src='${fallbackUrl(m)}'">
      <div class="sheet__head">
        <h3 class="sheet__title">${esc(m.t)}</h3>
        ${m.e ? `<p class="sheet__orig">${esc(m.e)}</p>` : ''}
        <p class="sheet__meta">${metaLine(m)}</p>
        ${ratesMarkup(m)}
      </div>
    </div>
    ${m.o ? `<p class="sheet__text">${esc(m.o)}</p>` : ''}
    ${tags ? `<div class="sheet__tags">${tags}</div>` : ''}
    <div class="sheet__acts">
      <button class="btn btn--fill${isDone(m) ? ' is-on' : ''}" id="sheetSeen">${isDone(m) ? 'Просмотрено' : 'Смотрел'}</button>
      <a class="btn btn--fill" href="${kpUrl(m)}" target="_blank" rel="noopener">Открыть</a>
    </div>`;
};

const openSheet = (m) => {
  if (!m) return;
  state.sheet = m;
  $('#sheetBody').innerHTML = sheetMarkup(m);
  const sheet = $('#sheet');
  sheet.hidden = false;
  document.body.classList.add('is-sheet');
  requestAnimationFrame(() => sheet.classList.add('is-in'));
  buzz(8);
};

const closeSheet = () => {
  const sheet = $('#sheet');
  if (sheet.hidden) return;
  sheet.classList.remove('is-in');
  document.body.classList.remove('is-sheet');
  state.sheet = null;
  setTimeout(() => {
    if (!sheet.classList.contains('is-in')) sheet.hidden = true;
  }, SHEET_ANIM_MS);
};

/* пересчёт всего, что зависит от отметок «смотрел» */
const refreshDoneViews = () => {
  syncSeenBtn();
  renderMoods();
  updatePoolInfo();
  renderList();
};

/* ——— профиль ——— */

const renderSync = () => {
  const n = state.done.size;
  $('#syncBox').innerHTML = n
    ? `<div class="sync">
         <p class="sync__txt">Отмечено здесь: <b>${n}</b> ${plural(n, ['фильм', 'фильма', 'фильмов'])}.
         Живёт в этом браузере — скопируй список, если пора обновить выгрузку.</p>
         <button class="sync__btn" id="syncCopy">Копировать</button>
       </div>`
    : '';
};

const copyDone = async (btn) => {
  const payload = JSON.stringify([...state.done]);
  try {
    await navigator.clipboard.writeText(payload);
    btn.textContent = 'Готово';
  } catch (err) {
    btn.textContent = 'Не вышло';
  }
  setTimeout(() => { btn.textContent = 'Копировать'; }, 1600);
};

const renderProfile = () => {
  const seen = state.movies.filter((m) => m.seen);
  const rated = state.movies.filter((m) => m.v);
  const watch = state.movies.filter((m) => m.w);
  const avg = rated.reduce((sum, m) => sum + m.v, 0) / (rated.length || 1);
  const hours = Math.round(seen.reduce((sum, m) => sum + (m.d || 0), 0) / 60);

  $('#stats').innerHTML = [
    [seen.length, 'просмотрено'],
    [watch.length, 'в очереди'],
    [avg.toFixed(1), 'средняя оценка'],
    [`${hours}+`, 'часов у экрана'],
  ].map(([num, cap]) => `<div class="stat"><div class="stat__num">${num}</div><div class="stat__cap">${cap}</div></div>`).join('');

  renderSync();

  const genres = {};
  state.movies.forEach((m) => (m.g || []).forEach((g) => {
    genres[g] = (genres[g] || 0) + 1;
  }));
  const top = Object.entries(genres).sort((a, b) => b[1] - a[1]).slice(0, TOP_GENRES);
  const max = top.length ? top[0][1] : 1;
  $('#genreBars').innerHTML = top.map(([name, n], i) => `
    <div class="bar">
      <span class="bar__name">${esc(name)}</span>
      <span class="bar__track"><span class="bar__fill" style="width:${(n / max) * 100}%;animation-delay:${i * 60}ms"></span></span>
      <span class="bar__val">${n}</span>
    </div>`).join('');

  const tens = rated.filter((m) => m.v === 10).sort((a, b) => (b.kp || 0) - (a.kp || 0)).slice(0, TENS_LIMIT);
  $('#tens').innerHTML = tens.map(tileMarkup).join('');

  const buckets = Array.from({ length: 10 }, (_, i) => rated.filter((m) => m.v === i + 1).length);
  const peak = Math.max(...buckets, 1);
  $('#voteBars').innerHTML = buckets.map((n, i) => `
    <div class="vb${n === peak ? ' vb--top' : ''}">
      <span class="vb__bar" style="height:${(n / peak) * 100}%;animation-delay:${i * 45}ms"></span>
      <span class="vb__lb">${i + 1}</span>
    </div>`).join('');
};

/* ——— навигация и события ——— */

const switchScreen = (name) => {
  $$('.screen').forEach((el) => el.classList.toggle('is-active', el.id === `screen-${name}`));
  $$('.tabbar__btn').forEach((el) => el.classList.toggle('is-on', el.dataset.screen === name));
  window.scrollTo({ top: 0 });
  if (name === 'me') renderProfile();
};

const bindEvents = () => {
  $('#rollBtn').addEventListener('click', spin);

  $('#seenBtn').addEventListener('click', () => {
    if (!state.current) return;
    toggleDone(state.current);
    refreshDoneViews();
    buzz(isDone(state.current) ? [14, 30, 14] : 10);
  });

  /* тап по фильму — карточка с логлайном: и по плитке в списке, и по карточке рулетки */
  document.addEventListener('click', (e) => {
    const tile = e.target.closest('.tile');
    if (!tile) return;
    e.preventDefault();
    openSheet(state.movies.find((m) => m.i === Number(tile.dataset.id)));
  });

  $('#card').addEventListener('click', () => {
    if (state.current && !state.spinning) openSheet(state.current);
  });

  $('#sheet').addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) {
      closeSheet();
      return;
    }
    const btn = e.target.closest('#sheetSeen');
    if (!btn || !state.sheet) return;
    toggleDone(state.sheet);
    const on = isDone(state.sheet);
    btn.classList.toggle('is-on', on);
    btn.textContent = on ? 'Просмотрено' : 'Смотрел';
    refreshDoneViews();
    buzz(on ? [14, 30, 14] : 10);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSheet();
  });

  $('#kpBtn').addEventListener('click', () => {
    if (state.current) window.open(kpUrl(state.current), '_blank', 'noopener');
  });

  $('#kindSeg').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-kind]');
    if (!btn) return;
    state.kind = btn.dataset.kind;
    $$('#kindSeg .seg__btn').forEach((el) => el.classList.toggle('is-on', el === btn));
    updatePoolInfo();
  });

  $('#moods').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-mood]');
    if (!btn) return;
    state.mood = state.mood === btn.dataset.mood ? null : btn.dataset.mood;
    renderMoods();
    updatePoolInfo();
    buzz(8);
  });

  $('#listSeg').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-scope]');
    if (!btn) return;
    state.scope = btn.dataset.scope;
    state.shown = PAGE_SIZE;
    $$('#listSeg .seg__btn').forEach((el) => el.classList.toggle('is-on', el === btn));
    renderList();
  });

  $('#q').addEventListener('input', (e) => {
    state.query = e.target.value;
    state.shown = PAGE_SIZE;
    renderList();
  });

  $('#moreBtn').addEventListener('click', () => {
    state.shown += PAGE_SIZE;
    renderList();
  });

  $('#syncBox').addEventListener('click', (e) => {
    if (e.target.closest('#syncCopy')) copyDone(e.target.closest('#syncCopy'));
  });

  $$('.tabbar__btn').forEach((btn) => btn.addEventListener('click', () => switchScreen(btn.dataset.screen)));
};

/* описания живут отдельным файлом — грузим фоном, старт не ждёт */
const loadLoglines = async () => {
  try {
    const res = await fetch(LOGLINE_URL);
    if (!res.ok) return;
    const map = await res.json();
    state.movies.forEach((m) => {
      const text = map[m.i];
      if (text) m.o = text;
    });
    if (state.sheet) openSheet(state.sheet);
  } catch (err) {
    /* нет файла — карточка просто без описания */
  }
};

const showError = (message) => {
  $('#poolInfo').textContent = message;
  $('#card').innerHTML = `<div class="card__hint"><p>${message}</p></div>`;
};

const init = async () => {
  try {
    const res = await fetch(DATA_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    state.movies = data.movies || [];
    if (!state.movies.length) throw new Error('пустой список');
    state.done = readDone();
    applyDone();
  } catch (err) {
    showError('Не удалось загрузить список фильмов. Обнови страницу.');
    return;
  }

  renderMoods();
  updatePoolInfo();
  renderList();
  bindEvents();
  loadLoglines();
};

init();

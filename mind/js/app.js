// «Загадка»: три ветки — термин, «что если», теория
import { TERMS, AREAS, termById } from './data/terms.js';
import { SYSTEMS, CARRIERS, buildQuestion, templateCount } from './data/whatif.js';
import { createVisual, drawVisual } from './engines/index.js';
import { hashStr } from './core/rng.js';
import { exportCard } from './card.js';

const COLORS = { paper: '#F3F0E8', ink: '#1F1F1F' };
const RECENT_LIMIT = 24;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const $ = (sel) => document.querySelector(sel);
const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
const sysById = (id) => SYSTEMS.find((s) => s.id === id);
const carById = (id) => CARRIERS.find((c) => c.id === id);

const AXES = [
  { key: 'sys', label: 'Система', list: SYSTEMS, byId: sysById, name: (s) => s.nom },
  { key: 'car', label: 'Носитель', list: CARRIERS, byId: carById, name: (c) => c.label },
  { key: 'lens', label: 'Линза', list: TERMS, byId: termById, name: (t) => t.title },
];

const state = {
  branch: 'term',
  area: null,
  term: null,
  theory: { term: null, idx: 0 },
  wf: {
    sys: { id: rand(SYSTEMS).id, lock: false, on: true },
    car: { id: rand(CARRIERS).id, lock: false, on: true },
    lens: { id: rand(TERMS).id, lock: false, on: false },
    tpl: 0,
  },
  revealed: false,
  recent: [],
  visual: null,
  visualKey: '',
  view: null,
};

/* ——— выбор ——— */

function pickTerm() {
  const pool = TERMS.filter((t) => !state.area || t.area === state.area);
  const fresh = pool.filter((t) => !state.recent.includes(t.id) && t.id !== state.term);
  const t = rand(fresh.length ? fresh : pool);
  state.recent = [t.id, ...state.recent].slice(0, RECENT_LIMIT);
  return t.id;
}

function wfParts() {
  const { wf } = state;
  return {
    sys: wf.sys.on ? sysById(wf.sys.id) : null,
    car: wf.car.on ? carById(wf.car.id) : null,
    lens: wf.lens.on ? termById(wf.lens.id) : null,
  };
}

function shuffleWhatIf() {
  for (const ax of AXES) {
    const a = state.wf[ax.key];
    if (!a.lock) a.id = rand(ax.list.filter((x) => x.id !== a.id)).id;
  }
  state.wf.tpl = Math.floor(Math.random() * 12);
}

/* ——— что показывать ——— */

function currentView() {
  if (state.branch === 'term') {
    const t = termById(state.term);
    return {
      eyebrow: t.area, headline: t.title, card: t.title, cardArea: t.area,
      engine: t.engine, params: t.params, seed: hashStr(t.id), ref: t,
    };
  }
  if (state.branch === 'theory') {
    const t = termById(state.theory.term);
    const idx = state.theory.idx % t.theories.length;
    return {
      eyebrow: `Теория · ${t.title}`, headline: t.theories[idx], card: t.title, cardArea: t.area,
      engine: t.engine, params: t.params, seed: hashStr(t.id), ref: t,
    };
  }
  const p = wfParts();
  const q = buildQuestion(p, state.wf.tpl);
  const axes = [p.sys?.nom, p.car?.label].filter(Boolean).join(' × ');
  const v = {
    eyebrow: `Что если · ${[axes, p.lens && `линза: ${p.lens.title}`].filter(Boolean).join(' · ')}`,
    headline: q, card: q, cardArea: `что если · ${axes || p.lens.area}`,
    ref: p.lens, wf: p,
  };
  if (p.lens) Object.assign(v, { engine: p.lens.engine, params: p.lens.params, seed: hashStr(p.lens.id) });
  else Object.assign(v, { engine: 'symbol', params: { mode: 'auto' }, seed: hashStr(`${p.sys?.id}·${p.car?.id}`) });
  return v;
}

/* ——— визуал ——— */

const canvas = $('#stage');
const ctx = canvas.getContext('2d');

function setVisual(engine, params, seed) {
  const key = `${engine}|${JSON.stringify(params)}|${seed}`;
  if (key === state.visualKey) return;
  state.visualKey = key;
  state.visual = createVisual(engine, params, seed);
  if (reducedMotion) for (let i = 0; i < 900; i++) state.visual.engine.step(state.visual.state, 1 / 30);
}

function fitCanvas() {
  const r = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const size = Math.round(r.width * dpr);
  if (canvas.width !== size) { canvas.width = size; canvas.height = size; }
}

function paint() {
  if (!state.visual) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = COLORS.paper;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  drawVisual(ctx, state.visual, 0, 0, canvas.width, COLORS);
}

let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (state.visual && !reducedMotion) state.visual.engine.step(state.visual.state, dt);
  paint();
  requestAnimationFrame(loop);
}

/* ——— интерфейс ——— */

const ICONS = {
  shuffle: '<svg viewBox="0 0 24 24"><path d="M3 7h3.5c4 0 6 10 10 10H21M3 17h3.5c1.6 0 2.8-1.6 3.9-3.6M13.6 9.6C14.7 8 15.6 7 17 7h4M18 4l3 3-3 3M18 14l3 3-3 3"/></svg>',
  lock: '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  power: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M8.5 15.5l7-7"/></svg>',
};

function buildAreas() {
  const box = $('#areas');
  const chips = [{ id: null, label: 'Все области' }, ...AREAS.map((a) => ({ id: a, label: a }))];
  box.innerHTML = '';
  for (const c of chips) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.textContent = c.label;
    b.dataset.area = c.id ?? '';
    b.addEventListener('click', () => {
      state.area = c.id;
      if (state.branch === 'theory') state.theory = { term: pickTerm(), idx: 0 };
      else state.term = pickTerm();
      state.revealed = false;
      render();
    });
    box.append(b);
  }
}

function buildAxes() {
  const box = $('#axes');
  box.innerHTML = '';
  for (const ax of AXES) {
    const row = document.createElement('div');
    row.className = 'axis';
    row.dataset.axis = ax.key;
    const sel = document.createElement('select');
    sel.className = 'axis__select';
    sel.setAttribute('aria-label', ax.label);
    if (ax.key === 'lens') {
      for (const area of AREAS) {
        const g = document.createElement('optgroup');
        g.label = area;
        for (const t of TERMS.filter((x) => x.area === area)) g.append(new Option(t.title, t.id));
        sel.append(g);
      }
    } else for (const x of ax.list) sel.append(new Option(ax.name(x), x.id));
    sel.addEventListener('change', () => {
      Object.assign(state.wf[ax.key], { id: sel.value, lock: true });
      state.revealed = false;
      render();
    });
    row.innerHTML = `<span class="axis__label">${ax.label}</span>`;
    row.append(sel);
    const mk = (act, title, icon) => {
      const b = document.createElement('button');
      b.className = 'ico';
      b.dataset.act = act;
      b.title = title;
      b.setAttribute('aria-label', `${title}: ${ax.label.toLowerCase()}`);
      b.innerHTML = icon;
      row.append(b);
      return b;
    };
    mk('shuffle', 'Перемешать', ICONS.shuffle).addEventListener('click', () => {
      const a = state.wf[ax.key];
      a.id = rand(ax.list.filter((x) => x.id !== a.id)).id;
      a.on = true;
      state.revealed = false;
      render();
    });
    mk('lock', 'Зафиксировать', ICONS.lock).addEventListener('click', () => {
      state.wf[ax.key].lock = !state.wf[ax.key].lock;
      renderAxes();
    });
    mk('toggle', 'Выключить ось', ICONS.power).addEventListener('click', () => {
      const a = state.wf[ax.key];
      a.on = !a.on;
      state.revealed = false;
      render();
    });
    box.append(row);
  }
}

function renderAxes() {
  const onCount = AXES.filter((ax) => state.wf[ax.key].on).length;
  for (const ax of AXES) {
    const a = state.wf[ax.key];
    const row = document.querySelector(`.axis[data-axis="${ax.key}"]`);
    row.classList.toggle('is-off', !a.on);
    row.querySelector('select').value = a.id;
    row.querySelector('[data-act="lock"]').setAttribute('aria-pressed', String(a.lock));
    const tg = row.querySelector('[data-act="toggle"]');
    tg.setAttribute('aria-pressed', String(!a.on));
    tg.title = a.on ? 'Выключить ось' : 'Включить ось';
    // меньше двух осей — вопроса не получится
    tg.disabled = a.on && onCount <= 2;
  }
}

function linkBtn(label, fn) {
  const b = document.createElement('button');
  b.className = 'link';
  b.textContent = label;
  b.addEventListener('click', fn);
  return b;
}

function renderLinks(v) {
  const box = $('#links');
  box.innerHTML = '';
  if (state.branch === 'term') {
    box.append(
      linkBtn('→ Вывести теорию', () => go('theory', () => { state.theory = { term: state.term, idx: 0 }; })),
      linkBtn('→ Сделать линзой в «Что если»', () => go('whatif', () => {
        Object.assign(state.wf.lens, { id: state.term, on: true, lock: true });
      })),
    );
  } else if (state.branch === 'theory') {
    const t = v.ref;
    if (t.theories.length > 1) box.append(linkBtn('Другой тезис', () => { state.theory.idx = (state.theory.idx + 1) % t.theories.length; render(); }));
    box.append(linkBtn('→ К термину', () => go('term', () => { state.term = t.id; })));
  } else {
    const n = templateCount(v.wf);
    if (n > 1) box.append(linkBtn('Переформулировать', () => { state.wf.tpl = (state.wf.tpl + 1) % n; render(); }));
    if (v.wf.lens) box.append(linkBtn('→ Термин-линза', () => go('term', () => { state.term = v.wf.lens.id; })));
  }
}

const searchLinks = (queries) => queries.map((q) =>
  `<a href="https://ru.wikipedia.org/w/index.php?search=${encodeURIComponent(q)}" target="_blank" rel="noopener">Википедия: ${q}</a>`).join('');

function renderReveal(v) {
  const box = $('#reveal');
  const btn = $('#revealBtn');
  box.hidden = !state.revealed;
  btn.setAttribute('aria-expanded', String(state.revealed));
  btn.textContent = state.revealed ? 'Спрятать' : 'Раскрыть';
  if (!state.revealed) return;
  if (v.ref) {
    $('#revealTitle').textContent = v.ref.title;
    $('#revealText').textContent = v.ref.ref;
    $('#revealMore').innerHTML = searchLinks([v.ref.title]) +
      `<a href="https://yandex.ru/search/?text=${encodeURIComponent(v.ref.title)}" target="_blank" rel="noopener">Искать в Яндексе</a>`;
  } else {
    $('#revealTitle').textContent = 'Готового ответа нет';
    $('#revealText').textContent = 'Это вопрос для размышления. Начни с того, как на самом деле устроена жизнь носителя, — и сравни с тем, как устроена человеческая система.';
    $('#revealMore').innerHTML = searchLinks([v.wf.car?.label, v.wf.sys?.nom].filter(Boolean));
  }
}

function writeHash() {
  let h;
  if (state.branch === 'term') h = `t/${state.term}`;
  else if (state.branch === 'theory') h = `th/${state.theory.term}/${state.theory.idx}`;
  else {
    const { sys, car, lens, tpl } = state.wf;
    h = `w/${sys.on ? sys.id : '-'}/${car.on ? car.id : '-'}/${lens.on ? lens.id : '-'}/${tpl}`;
  }
  history.replaceState(null, '', `#${h}`);
}

function readHash() {
  const [kind, a, b, c, d] = location.hash.slice(1).split('/');
  if (kind === 't' && termById(a)) { state.branch = 'term'; state.term = a; return true; }
  if (kind === 'th' && termById(a)) { state.branch = 'theory'; state.theory = { term: a, idx: +b || 0 }; return true; }
  if (kind === 'w') {
    const set = (key, id, byId) => {
      if (id && id !== '-' && byId(id)) Object.assign(state.wf[key], { id, on: true, lock: true });
      else state.wf[key].on = false;
    };
    set('sys', a, sysById);
    set('car', b, carById);
    set('lens', c, termById);
    if (AXES.filter((ax) => state.wf[ax.key].on).length < 2) return false;
    state.wf.tpl = +d || 0;
    state.branch = 'whatif';
    return true;
  }
  return false;
}

function render() {
  for (const b of document.querySelectorAll('.seg__btn')) {
    const on = b.dataset.branch === state.branch;
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-selected', String(on));
  }
  $('#areas').hidden = state.branch === 'whatif';
  $('#axes').hidden = state.branch !== 'whatif';
  for (const c of document.querySelectorAll('.chip')) c.classList.toggle('is-on', (c.dataset.area || null) === state.area);
  if (state.branch === 'whatif') renderAxes();

  const v = currentView();
  state.view = v;
  $('#eyebrow').textContent = v.eyebrow;
  const h = $('#headline');
  h.textContent = v.headline;
  h.classList.toggle('is-long', v.headline.length > 34 && v.headline.length <= 90);
  h.classList.toggle('is-xlong', v.headline.length > 90);
  canvas.setAttribute('aria-label', `Визуализация: ${v.ref ? v.ref.title : v.headline}`);
  setVisual(v.engine, v.params, v.seed);
  renderLinks(v);
  renderReveal(v);
  writeHash();
}

function go(branch, mutate) {
  state.branch = branch;
  mutate?.();
  state.revealed = false;
  render();
  window.scrollTo({ top: 0, behavior: reducedMotion ? 'auto' : 'smooth' });
}

function next() {
  state.revealed = false;
  if (state.branch === 'term') state.term = pickTerm();
  else if (state.branch === 'theory') {
    const id = pickTerm();
    state.theory = { term: id, idx: Math.floor(Math.random() * termById(id).theories.length) };
  } else shuffleWhatIf();
  render();
}

function toast(msg) {
  const t = Object.assign(document.createElement('div'), { className: 'toast', textContent: msg });
  document.body.append(t);
  setTimeout(() => t.remove(), 2200);
}

/* ——— старт ——— */

buildAreas();
buildAxes();
state.term = pickTerm();
state.theory = { term: state.term, idx: 0 };
readHash();

document.querySelectorAll('.seg__btn').forEach((b) => b.addEventListener('click', () => {
  if (b.dataset.branch === state.branch) return;
  go(b.dataset.branch, () => {
    // ветки связаны: открытая теория продолжает текущий термин
    if (b.dataset.branch === 'theory' && state.term) state.theory = { term: state.term, idx: 0 };
  });
}));
$('#nextBtn').addEventListener('click', next);
$('#revealBtn').addEventListener('click', () => { state.revealed = !state.revealed; renderReveal(state.view); });
$('#cardBtn').addEventListener('click', async () => {
  const btn = $('#cardBtn');
  btn.disabled = true;
  try {
    const v = state.view;
    const res = await exportCard({ title: v.card, area: v.cardArea, visual: state.visual, colors: COLORS });
    if (res === 'downloaded') toast('Карточка сохранена');
  } catch (e) {
    console.error(e);
    toast('Не получилось сохранить карточку');
  } finally {
    btn.disabled = false;
  }
});
document.addEventListener('keydown', (e) => {
  if (e.target !== document.body || e.metaKey || e.ctrlKey) return;
  if (e.code === 'Space') { e.preventDefault(); next(); }
  if (e.key === 'r' || e.key === 'к') { state.revealed = !state.revealed; renderReveal(state.view); }
});
window.addEventListener('hashchange', () => { if (readHash()) render(); });

new ResizeObserver(() => { fitCanvas(); paint(); }).observe(canvas);
fitCanvas();
render();
requestAnimationFrame(loop);
document.fonts?.ready.then(paint);

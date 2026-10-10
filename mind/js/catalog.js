// Главный экран-каталог: швейцарская сетка живых схем и теорий
import { TERMS, AREAS } from './data/terms.js';
import { createVisual, drawVisual } from './engines/index.js';
import { hashStr } from './core/rng.js';

// Асимметричный ритм строк: [колонка, ширина] для каждой плитки в строке.
// Пустые колонки между плитками — намеренно: воздух важнее плотности.
const ROWS = {
  d: [ // ПК, 12 колонок: в строке от одной до четырёх плиток
    [[1, 5], [7, 3], [11, 2]],
    [[2, 2], [5, 2], [8, 2], [11, 2]],
    [[4, 6]],
    [[1, 3], [6, 4]],
    [[2, 2], [5, 3], [10, 2]],
    [[1, 2], [4, 2], [7, 2], [10, 3]],
    [[2, 4], [8, 4]],
    [[7, 5]],
    [[1, 3], [5, 2], [8, 2], [11, 2]],
  ],
  t: [ // планшет, 8 колонок
    [[1, 4], [6, 3]],
    [[2, 2], [5, 2], [7, 2]],
    [[3, 5]],
    [[1, 3], [5, 4]],
    [[1, 2], [4, 2], [7, 2]],
    [[2, 4]],
  ],
  m: [ // телефон, 6 колонок
    [[1, 4]],
    [[1, 3], [4, 3]],
    [[2, 5]],
    [[1, 2], [3, 2], [5, 2]],
    [[3, 4]],
    [[1, 3], [4, 3]],
  ],
};
const HOVER_SPEED = 2.5;
// единый кегль сайта — и для подписей внутри схем
const fs = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--fs')) || 15;
const STORE_KEY = 'mind.catalog.view';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const num = (i) => String(i + 1).padStart(2, '0');

function readView() {
  try { return localStorage.getItem(STORE_KEY) === 'text' ? 'text' : 'anim'; } catch { return 'anim'; }
}
function saveView(v) {
  try { localStorage.setItem(STORE_KEY, v); } catch { /* приватный режим */ }
}

export function initCatalog({ root, colors, reducedMotion, onOpen, onGo }) {
  const grid = root.querySelector('#grid');
  const filterBox = root.querySelector('#filter');
  const tiles = [];
  let view = readView();
  let area = null;
  let running = false;
  let last = 0;

  /* ——— плитки ——— */

  TERMS.forEach((t, i) => {
    const a = document.createElement('a');
    a.className = 'tile';
    a.href = `#t/${t.id}`;
    a.dataset.id = t.id;
    a.innerHTML = `
      <div class="tile__vis"><canvas></canvas></div>
      <div class="tile__body">
        <h3 class="tile__title">${esc(t.title)}</h3><span class="tile__go" aria-hidden="true">→</span>
        <p class="tile__meta">${num(i)} · ${esc(t.area)}</p>
        <p class="tile__thesis">${esc(t.theories[0])}</p>
      </div>`;
    const canvas = a.querySelector('canvas');
    const tile = { t, el: a, canvas, ctx: canvas.getContext('2d'), visual: null, visible: false, hover: false, acc: 0, cost: 0, wait: 0 };
    a.addEventListener('mouseenter', () => { tile.hover = true; });
    a.addEventListener('mouseleave', () => { tile.hover = false; });
    a.addEventListener('click', (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      ensureVisual(tile);
      onOpen({ id: t.id, mode: view === 'text' ? 'theory' : 'term', fromEl: view === 'text' ? a.querySelector('.tile__title') : a.querySelector('.tile__vis'), visual: tile.visual });
    });
    tiles.push(tile);
    grid.append(a);
  });

  function layout() {
    const shown = [];
    for (const tile of tiles) {
      const on = !area || tile.t.area === area;
      tile.el.hidden = !on;
      if (on) shown.push(tile);
    }
    // раскладываем по ритму строк — отдельно для каждой ширины экрана
    for (const [key, rows] of Object.entries(ROWS)) {
      let r = 0, slot = 0;
      shown.forEach((tile, k) => {
        const [col, span] = rows[r % rows.length][slot];
        tile.el.style.setProperty(`--c${key}`, `${col} / span ${span}`);
        tile.el.style.setProperty(`--r${key}`, String(r + 1));
        tile.el.style.setProperty('--i', k);
        if (++slot >= rows[r % rows.length].length) { slot = 0; r++; }
      });
    }
  }

  // плавная перестройка сетки (View Transitions), если браузер умеет
  function morph(apply, animate = true) {
    if (!animate || !document.startViewTransition || reducedMotion) { apply(); return; }
    tiles.forEach((tile) => { if (!tile.el.hidden) tile.el.style.viewTransitionName = `tile-${tile.t.id}`; });
    const vt = document.startViewTransition(apply);
    vt.finished.finally(() => tiles.forEach((tile) => { tile.el.style.viewTransitionName = ''; }));
  }

  /* ——— визуал: создаётся лениво, рисуются только видимые плитки ——— */

  function ensureVisual(tile) {
    if (tile.visual) return;
    tile.visual = createVisual(tile.t.engine, tile.t.params, hashStr(tile.t.id));
    // небольшой разгон, чтобы плитка не появлялась пустой
    const t0 = performance.now();
    const steps = reducedMotion ? 600 : 90;
    for (let i = 0; i < steps && performance.now() - t0 < (reducedMotion ? 120 : 18); i++) tile.visual.engine.step(tile.visual.state, 1 / 30);
  }

  function fit(tile) {
    const r = tile.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
    if (tile.canvas.width !== w || tile.canvas.height !== h) { tile.canvas.width = w; tile.canvas.height = h; }
  }

  function paint(tile) {
    const { canvas, ctx } = tile;
    if (!canvas.width || !canvas.height || !tile.visual) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = colors.paper;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const size = Math.min(canvas.width, canvas.height);
    drawVisual(ctx, tile.visual, (canvas.width - size) / 2, (canvas.height - size) / 2, size, colors, { frame: false, textPx: fs * canvas.width / (canvas.clientWidth || canvas.width) });
  }

  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const tile = tiles.find((x) => x.el === e.target);
      tile.visible = e.isIntersecting;
      if (tile.visible) { ensureVisual(tile); fit(tile); paint(tile); }
    }
  }, { rootMargin: '120px 0px' });
  tiles.forEach((tile) => io.observe(tile.el));

  const ro = new ResizeObserver((entries) => {
    for (const e of entries) {
      const tile = tiles.find((x) => x.canvas === e.target);
      if (tile?.visible) { fit(tile); paint(tile); }
    }
  });
  tiles.forEach((tile) => ro.observe(tile.canvas));

  function frame(now) {
    if (!running) return;
    const dt = Math.min(0.05, (now - (last || now)) / 1000);
    last = now;
    if (view === 'anim') {
      for (const tile of tiles) {
        if (!tile.visible || !tile.visual || tile.el.hidden) continue;
        if (!reducedMotion) {
          tile.acc += dt * (tile.hover ? HOVER_SPEED : 1);
          // тяжёлые схемы (фракталы, поля) шагают реже, но с тем же временем
          if (--tile.wait <= 0) {
            const t0 = performance.now();
            tile.visual.engine.step(tile.visual.state, Math.min(tile.acc, 0.12));
            tile.acc = 0;
            tile.cost = tile.cost * 0.8 + (performance.now() - t0) * 0.2;
            tile.wait = tile.cost > 2.5 ? Math.ceil(tile.cost / 2.5) : 1;
          }
        }
        paint(tile);
      }
    }
    requestAnimationFrame(frame);
  }

  /* ——— переключатели ——— */

  function setView(v, animate = true) {
    morph(() => {
      view = v;
      saveView(v);
      root.classList.toggle('is-text', v === 'text');
      for (const b of root.querySelectorAll('[data-view]')) {
        const on = b.dataset.view === v;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-selected', String(on));
      }
      if (v === 'anim') tiles.forEach((tile) => { if (tile.visible) { ensureVisual(tile); fit(tile); paint(tile); } });
    }, animate);
  }

  function buildFilter() {
    const items = [{ id: null, label: 'Все', n: TERMS.length }, ...AREAS.map((a) => ({ id: a, label: a, n: TERMS.filter((t) => t.area === a).length }))];
    filterBox.innerHTML = '';
    for (const it of items) {
      const b = document.createElement('button');
      b.className = 'filter__btn';
      b.innerHTML = `${esc(it.label)}<span class="n">${it.n}</span>`;
      b.dataset.area = it.id ?? '';
      b.addEventListener('click', () => setArea(it.id));
      filterBox.append(b);
    }
  }

  function setArea(a, animate = true) {
    morph(() => {
      area = a;
      for (const b of filterBox.children) b.classList.toggle('is-on', (b.dataset.area || null) === area);
      layout();
    }, animate);
  }

  for (const b of root.querySelectorAll('[data-view]')) b.addEventListener('click', () => setView(b.dataset.view));
  for (const b of root.querySelectorAll('[data-go]')) b.addEventListener('click', () => onGo(b.dataset.go));

  buildFilter();
  setArea(null, false);
  setView(view, false);

  return {
    show() {
      root.hidden = false;
      // каскадное появление плиток — только при первом показе
      if (!root.dataset.shown) {
        root.dataset.shown = '1';
        root.classList.add('is-intro');
        setTimeout(() => root.classList.remove('is-intro'), 1800);
      }
      if (!running) { running = true; last = 0; requestAnimationFrame(frame); }
    },
    hide() {
      root.hidden = true;
      running = false;
    },
    // элемент, в который «приземляется» переход из генератора
    targetFor(id) {
      const tile = tiles.find((x) => x.t.id === id);
      if (!tile || tile.el.hidden) return null;
      return tile.el.querySelector(view === 'text' ? '.tile__title' : '.tile__vis');
    },
    visualOf(id) {
      return tiles.find((x) => x.t.id === id)?.visual || null;
    },
  };
}

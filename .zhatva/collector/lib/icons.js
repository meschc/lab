// Иконки статьи — те же контуры Tabler, что и в дереве сайта: обводка цветом текста, толщина 2.
// Цвет берут от родителя (currentColor), поэтому одна иконка годится и на плашке, и в ссылке.
const PATHS = {
  'arrow-left': 'M5 12h14M5 12l6 6M5 12l6-6',
  'arrow-right': 'M5 12h14M13 18l6-6M13 6l6 6',
  'layout-grid': 'M4 5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zm10 0a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1zM4 15a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zm10 0a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1z',
  'align-left': 'M4 6h16M4 12h10M4 18h14',
  photo: 'M15 8h.01M3 6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3zm0 10l5-5c.928-.893 2.072-.893 3 0l5 5m-2-2l1-1c.928-.893 2.072-.893 3 0l3 3',
};

const ICON_NAMES = Object.keys(PATHS);

function icon(name) {
  const d = PATHS[name];
  if (!d) throw new Error(`нет иконки «${name}»`);
  return `<svg class="ico ico--${name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" `
    + `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="${d}"/></svg>`;
}

module.exports = { icon, ICON_NAMES };

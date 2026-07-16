'use strict';

const express = require('express');
const { generateName } = require('./nameGenerator');
const { generateAvatar, renderImg } = require('./asciiGenerator');

const app = express();
const PORT = process.env.PORT || 3000;

// Демо-интерфейс: компактная карточка (иконка + имя), кнопки генерации, смена темы.
app.get('/', (req, res) => {
  res.type('html').send(`<!doctype html>
<html lang="ru" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Генератор аватарок</title>
<style>
  :root {
    --bg: #eeeeec; --card: #ffffff; --text: #14141a; --muted: #8a8a92;
    --line: #ececec; --pill: #f2f2f0; --pill-text: #14141a;
    --primary: #14141a; --primary-text: #ffffff; --shadow: 0 12px 40px rgba(0,0,0,.10);
  }
  :root[data-theme="dark"] {
    --bg: #0d0d11; --card: #17171d; --text: #f2f2f4; --muted: #8a8a94;
    --line: #26262e; --pill: #23232b; --pill-text: #f2f2f4;
    --primary: #f2f2f4; --primary-text: #14141a; --shadow: 0 12px 40px rgba(0,0,0,.45);
  }
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, sans-serif; background: var(--bg);
         color: var(--text); margin: 0; min-height: 100vh; display: flex;
         align-items: center; justify-content: center; padding: 24px;
         transition: background .25s, color .25s; }

  .wrap { display: flex; flex-direction: column; gap: 12px; width: 340px; }
  .card { background: var(--card); border-radius: 24px;
          box-shadow: var(--shadow); padding: 22px; transition: background .25s; }

  .hero { display: flex; gap: 16px; align-items: center; }
  .icon { width: 96px; height: 96px; border-radius: 50%; flex: none; overflow: hidden;
          background: #000; }
  .icon img { width: 100%; height: 100%; object-fit: cover; display: block;
              image-rendering: auto; }
  .meta { min-width: 0; }
  .meta .label { font-size: 11px; letter-spacing: .1em; text-transform: uppercase;
                 color: var(--muted); font-weight: 600; }
  .meta .name { font-size: 24px; font-weight: 700; line-height: 1.1; margin-top: 3px;
                word-break: break-word; }

  .actions { display: flex; gap: 8px; margin-top: 22px; }
  .btn { border: 0; border-radius: 999px; cursor: pointer; font-size: 14px;
         font-weight: 600; transition: transform .05s, filter .2s; }
  .btn:active { transform: scale(.97); }
  .btn:hover { filter: brightness(.96); }
  .btn.primary { flex: 1; padding: 12px 0; background: var(--primary); color: var(--primary-text); }
  .btn.ghost { flex: 1; padding: 12px 0; background: var(--pill); color: var(--pill-text); }
  .btn.round { flex: none; width: 46px; height: 46px; padding: 0; font-size: 17px;
               background: var(--pill); color: var(--pill-text); display: grid;
               place-items: center; }

  .usage { background: var(--card); border-radius: 18px; box-shadow: var(--shadow);
           padding: 16px 18px; font-size: 12px; line-height: 1.5;
           transition: background .25s; }
  .usage .u-title { font-size: 11px; letter-spacing: .1em; text-transform: uppercase;
                    color: var(--muted); font-weight: 600; margin-bottom: 8px; }
  .usage code { font-family: ui-monospace, Menlo, monospace; background: var(--pill);
                color: var(--pill-text); padding: 2px 6px; border-radius: 6px;
                font-size: 12px; }
  .usage .row { margin-top: 8px; color: var(--muted); }
  .usage .row b { color: var(--text); font-weight: 600; }
</style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="hero">
        <div class="icon"><img id="art" alt="avatar"></div>
        <div class="meta">
          <div class="label">Аватар</div>
          <div class="name" id="name">…</div>
        </div>
      </div>

      <div class="actions">
        <button class="btn primary" onclick="load('ru')">Новый · RU</button>
        <button class="btn ghost" onclick="load('en')">Новый · EN</button>
        <button class="btn round" id="theme" title="Сменить тему">☾</button>
      </div>
    </div>

    <div class="usage">
      <div class="u-title">Использование · API</div>
      <code>GET /api/avatar?lang=ru|en</code>
      <div class="row"><b>lang</b> — язык имени: <code>ru</code> или <code>en</code> (по умолчанию <code>en</code>). Цвета случайны и в запросе не задаются.</div>
      <div class="row"><b>Ответ:</b> <code>{ name, img, lang }</code> — <code>img</code> это data-URI картинки (SVG), готовый для <code>&lt;img src&gt;</code>.</div>
      <div class="row"><b>Пример:</b> <code>curl "http://localhost:3000/api/avatar?lang=ru"</code></div>
    </div>
  </div>

<script>
  async function load(lang) {
    const r = await fetch('/api/avatar?lang=' + lang);
    const d = await r.json();
    document.getElementById('name').textContent = d.name;
    document.getElementById('art').src = d.img;
  }

  // Тема
  const root = document.documentElement;
  const themeBtn = document.getElementById('theme');
  function applyTheme(t) {
    root.setAttribute('data-theme', t);
    themeBtn.textContent = t === 'dark' ? '☀' : '☾';
    localStorage.setItem('theme', t);
  }
  themeBtn.onclick = () =>
    applyTheme(root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
  applyTheme(localStorage.getItem('theme') || 'light');

  load('ru');
</script>
</body>
</html>`);
});

app.get('/api/avatar', (req, res) => {
  // Невалидный lang -> en по умолчанию.
  const lang = req.query.lang === 'ru' ? 'ru' : 'en';
  const avatar = generateAvatar();
  res.json({
    name: generateName(lang),
    img: renderImg(avatar.ascii, avatar.colors),
    lang
  });
});

app.listen(PORT, () => {
  console.log(`Avatar generator running on http://localhost:${PORT}`);
});

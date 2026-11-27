# <a href='https://create.kirmesch.ru'>create.kirmesch.ru</a>

Small, hand-built web tools by [Kirill Mescheryakov](https://kirmesch.ru). Plain HTML, CSS and JavaScript — no frameworks, no build step — hosted on GitHub Pages. This repository is the home page and the source of every project on it.

## <a href='https://create.kirmesch.ru/mind'>Мысль · Mysl'</a> — featured

A living catalogue of **124 ideas from science and philosophy**, each drawn as a single-line animated diagram: Hilbert curves, strange attractors, cellular automata, prisoner's dilemmas. Eight simulation engines on `<canvas>`, a "what if…" question generator and a 9:16 card exporter for reels.

<a href="https://create.kirmesch.ru/mind/"><img src="mind/docs/demo.gif" alt="Mysl' — catalogue, term page and diagrams in motion" width="720"></a>

**[Live site](https://create.kirmesch.ru/mind/) · [Project page with screenshots and architecture →](mind/README.md)**

## <a href='https://create.kirmesch.ru/cover'>Cover generator</a>

Creates realistic book covers in the style of Apple Books.

## Other projects

- [`kino/`](kino/) — "What to watch": a movie picker with a spinning reel, genres and moods.
- [`avatar-generator/`](avatar-generator/) — a small Node.js + Express service that returns a random name and a generated SVG avatar ([README](avatar-generator/README.md), in Russian).

## Run locally

```bash
git clone https://github.com/meschc/lab.git
cd lab
python3 -m http.server 8000   # then open http://localhost:8000/
```

#!/usr/bin/env python3
"""Собирает автономную версию ЗЕРНО для публикации:
демо-кадр вшивается в разметку, ссылки на манифест и иконки убираются,
внешняя обёртка документа снимается — страница вставляется как есть."""
import base64, os, re, sys

repo = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = open(os.path.join(repo, 'zerno', 'index.html'), encoding='utf-8').read()
out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(repo, 'zerno', 'artifact.html')

demo = base64.b64encode(open(os.path.join(repo, 'zerno', 'img', 'demo.jpg'), 'rb').read()).decode()
src = src.replace("demoImg.src = 'img/demo.jpg';",
                  f"demoImg.src = 'data:image/jpeg;base64,{demo}';")

# манифеста и сервис-воркера на чужом хосте нет
src = re.sub(r'\n\s*<link rel="manifest"[^>]*>', '', src)
src = re.sub(r'\n\s*<link rel="icon"[^>]*>', '', src)
src = re.sub(r'\n\s*<link rel="apple-touch-icon"[^>]*>', '', src)
src = src.replace("""if('serviceWorker' in navigator && location.protocol === 'https:')
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));

""", '')

# страница публикуется без собственной обёртки документа
for tag in ('<!doctype html>', '<html lang="ru">', '<head>', '</head>',
            '<body>', '</body>', '</html>'):
    src = src.replace(tag + '\n', '').replace(tag, '')

open(out, 'w', encoding='utf-8').write(src)
print(out, len(src) // 1024, 'KB')

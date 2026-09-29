#!/bin/zsh
# Обновить Колсона: свежий код, зависимости, модель — и перезапустить, если он работает.
set -euo pipefail
cd "$(dirname "$0")/.."
eval "$(/opt/homebrew/bin/brew shellenv)"

git pull --ff-only
uv sync
uv run python -c 'from coulson import config; c = config.load(); print(c.llm.model); print((c.get("memory") or {}).get("embed_model") or "")' |
  while read -r m; do [[ -n "$m" ]] && ollama pull "$m"; done
uv run --group dev pytest -q

if pgrep -f "python -m coulson" >/dev/null; then
  # Лаунчер Coulson.app сам поднимет Колсона заново уже с новым кодом (через ~3 с)
  pkill -TERM -f "python -m coulson"
  echo "Колсон перезапускается с новой версией"
else
  echo "Готово. Запуск: open ~/Applications/Coulson.app"
fi

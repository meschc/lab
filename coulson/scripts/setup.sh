#!/bin/zsh
# Полная установка Колсона на Mac (Apple Silicon). Повторный запуск безопасен.
set -euo pipefail
cd "$(dirname "$0")/.."
PROJECT="$(pwd)"
MODEL="${COULSON_MODEL:-qwen3-vl:8b-instruct}"

say_step() { print -P "\n%F{cyan}==> $1%f"; }

[[ "$(uname -m)" == "arm64" ]] || { echo "Нужен Mac на Apple Silicon"; exit 1; }

say_step "Homebrew"
if ! command -v brew >/dev/null; then
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  eval "$(/opt/homebrew/bin/brew shellenv)"
fi
eval "$(/opt/homebrew/bin/brew shellenv)"

say_step "uv, Ollama"
brew list uv >/dev/null 2>&1 || brew install uv
brew list ollama >/dev/null 2>&1 || brew install ollama
brew upgrade ollama >/dev/null 2>&1 || true

say_step "Настройки Ollama для 16 ГБ (переживают перезагрузку)"
# Flash Attention + кэш контекста в q8_0 (вдвое меньше памяти), один слот,
# две модели в памяти одновременно: мозг + маленькая модель поиска по смыслу (иначе они вытесняют друг друга).
ENV_PLIST="$HOME/Library/LaunchAgents/local.coulson.ollama-env.plist"
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$ENV_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>local.coulson.ollama-env</string>
  <key>ProgramArguments</key><array>
    <string>/bin/sh</string><string>-c</string>
    <string>launchctl setenv OLLAMA_FLASH_ATTENTION 1; launchctl setenv OLLAMA_KV_CACHE_TYPE q8_0; launchctl setenv OLLAMA_NUM_PARALLEL 1; launchctl setenv OLLAMA_MAX_LOADED_MODELS 2</string>
  </array>
  <key>RunAtLoad</key><true/>
</dict></plist>
PLIST
launchctl unload "$ENV_PLIST" >/dev/null 2>&1 || true
launchctl load "$ENV_PLIST"
sleep 1
if pgrep -xq Ollama; then
  # Уже работает приложение Ollama.app — перезапускаем его, чтобы оно подхватило настройки
  osascript -e 'quit app "Ollama"' >/dev/null 2>&1 || true
  sleep 3
  open -a Ollama
else
  brew services restart ollama >/dev/null 2>&1 || brew services start ollama >/dev/null 2>&1 || true
fi
for i in {1..60}; do curl -s http://127.0.0.1:11434/api/version >/dev/null && break; sleep 1; done
curl -s http://127.0.0.1:11434/api/version >/dev/null || { echo "Ollama не запустилась — см. brew services list"; exit 1; }
ollama --version

say_step "Модели: $MODEL (~6 ГБ) и поиск по смыслу (~0.6 ГБ), один раз"
ollama pull "$MODEL"
ollama pull "${COULSON_EMBED_MODEL:-qwen3-embedding:0.6b}"

say_step "Claude Code (для сложных задач и самопочинки)"
if ! command -v claude >/dev/null && [[ ! -x "$HOME/.local/bin/claude" ]]; then
  brew install --cask claude-code || curl -fsSL https://claude.ai/install.sh | bash || true
fi
command -v claude >/dev/null && claude --version || echo "Claude Code не установился — поставь вручную: https://code.claude.com"
echo "Войди в Claude Code один раз (нужен VPN не в России): запусти  claude  и выполни вход."

say_step "Python-окружение"
uv sync
if [[ "${COULSON_QWEN3TTS:-0}" == "1" ]]; then
  uv sync --extra qwen3tts
fi

say_step "Скачиваю модели распознавания речи и голоса"
uv run python -m coulson --prefetch

say_step "Собираю Coulson.app"
./scripts/make_app.sh

say_step "Диагностика"
uv run python -m coulson --check || true

say_step "Замер скорости"
uv run python -m coulson --bench || true

cat <<MSG

Готово. Дальше:
  1) Запусти:  open ~/Applications/Coulson.app
  2) Разреши доступ к Микрофону (и позже — Запись экрана, Камера, Универсальный доступ, Автоматизация).
     Чтобы не было десятков запросов про папки: Настройки → Конфиденциальность → Полный доступ к диску → Колсон.
  3) Автозапуск при входе:  ./scripts/autostart.sh on
Лог: ~/Library/Logs/Coulson.log
MSG

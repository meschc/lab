#!/bin/zsh
# Для экспериментального голоса Qwen3-TTS: делает образец британского тембра (Daniel),
# который затем «клонируется» и говорит по-русски. Можно подложить и свой WAV (5–15 секунд).
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="${1:-voices/butler_ref.wav}"
TEXT="Good evening, sir. All systems are online. Shall I prepare the usual setup for tonight?"
mkdir -p "$(dirname "$OUT")"
say -v Daniel -o /tmp/coulson_ref.aiff "$TEXT"
afconvert -f WAVE -d LEI16@24000 -c 1 /tmp/coulson_ref.aiff "$OUT"
cat <<MSG
Образец: $OUT
Добавь в config.local.yaml:
tts:
  engine: qwen3
  qwen3_ref_audio: $(pwd)/$OUT
  qwen3_ref_text: "$TEXT"
MSG

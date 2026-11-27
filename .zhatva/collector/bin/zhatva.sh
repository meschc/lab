#!/bin/sh
# Один вход для скилла «жатва»: на Маке — локальный сборщик и ~/Проекты/Кейсы, в облаке — копия в репозитории и .zhatva/cases.
LOCAL="$HOME/.claude/case-study-collector/bin/cli.js"
if [ -f "$LOCAL" ] && [ "$CLAUDE_CODE_REMOTE" != true ]; then
  exec node "$LOCAL" "$@"
fi
R="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
ZHATVA_CLOUD=1 ZHATVA_CASES_ROOT="$R/.zhatva/cases" exec node "$R/.zhatva/collector/bin/cli.js" "$@"

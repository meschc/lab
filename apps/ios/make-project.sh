#!/usr/bin/env bash
# Собирает ZERNO.xcodeproj из project.yml.
# Проект не хранится в репозитории: его описывает project.yml, а XcodeGen
# разворачивает описание в настоящий .xcodeproj.
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v xcodegen >/dev/null 2>&1; then
  echo "Ставлю XcodeGen…"
  brew install xcodegen
fi

xcodegen generate
echo
echo "Готово: $(pwd)/ZERNO.xcodeproj"
echo "Открыть:  open ZERNO.xcodeproj"

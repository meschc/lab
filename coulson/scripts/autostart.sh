#!/bin/zsh
# ./scripts/autostart.sh on|off — запуск Колсона при входе в систему
APP="$HOME/Applications/Coulson.app"
case "${1:-on}" in
  on)  osascript -e 'tell application "System Events" to delete (every login item whose path contains "Coulson.app")' >/dev/null 2>&1
       osascript -e "tell application \"System Events\" to make login item at end with properties {path:\"$APP\", hidden:true}" >/dev/null
       echo "Автозапуск включён";;
  off) osascript -e 'tell application "System Events" to delete (every login item whose path contains "Coulson.app")' >/dev/null 2>&1
       echo "Автозапуск выключен";;
esac

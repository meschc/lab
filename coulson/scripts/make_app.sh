#!/bin/zsh
# Собирает ~/Applications/Coulson.app — нативную обёртку, чтобы macOS спрашивала разрешения
# (микрофон, камера, экран) от имени «Колсон», а не терминала или python.
# Лаунчер запускает python ДОЧЕРНИМ процессом (не exec): так разрешения приложения
# наследуются, как у Terminal → python.
set -euo pipefail
cd "$(dirname "$0")/.."
PROJECT="$(pwd)"
APP="$HOME/Applications/Coulson.app"
PY="$PROJECT/.venv/bin/python"
[[ -x "$PY" ]] || { echo "Сначала: uv sync"; exit 1; }

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Coulson</string>
  <key>CFBundleDisplayName</key><string>Колсон</string>
  <key>CFBundleIdentifier</key><string>local.coulson.assistant</string>
  <key>CFBundleExecutable</key><string>Coulson</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleVersion</key><string>0.1.0</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSMicrophoneUsageDescription</key><string>Колсон слушает голосовые команды.</string>
  <key>NSCameraUsageDescription</key><string>Колсон смотрит в камеру, когда вы просите.</string>
  <key>NSAppleEventsUsageDescription</key><string>Колсон управляет приложениями по вашим командам.</string>
  <key>NSCalendarsFullAccessUsageDescription</key><string>Колсон напоминает о событиях и днях рождения.</string>
  <key>NSCalendarsUsageDescription</key><string>Колсон напоминает о событиях и днях рождения.</string>
  <key>NSLocationWhenInUseUsageDescription</key><string>Колсон узнаёт погоду и транспорт там, где вы.</string>
  <key>NSLocationUsageDescription</key><string>Колсон узнаёт погоду и транспорт там, где вы.</string>
</dict></plist>
PLIST

cat > "$APP/Contents/Resources/launcher.c" <<C
#include <spawn.h>
#include <signal.h>
#include <stdlib.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>
extern char **environ;
static pid_t child = 0;
static volatile sig_atomic_t stopping = 0;
static void forward(int sig) { stopping = 1; if (child > 0) kill(child, sig); }
int main(void) {
  if (chdir("$PROJECT") != 0) return 1;
  setenv("PATH", "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin", 1);
  setenv("PYTHONUNBUFFERED", "1", 1);
  setenv("PYTHONUTF8", "1", 1);
  setenv("LANG", "en_US.UTF-8", 1);
  setenv("LC_ALL", "en_US.UTF-8", 1);
  char *argv[] = {"$PY", "-m", "coulson", NULL};
  signal(SIGTERM, forward); signal(SIGINT, forward); signal(SIGHUP, forward);
  time_t window_start = time(NULL);
  int crashes = 0;
  for (;;) {  /* упал — перезапускаем; штатный выход (код 0) или 5 падений за 2 минуты — стоп */
    if (posix_spawn(&child, argv[0], NULL, NULL, argv, environ) != 0) return 1;
    int status = 0;
    while (waitpid(child, &status, 0) < 0) {}
    child = 0;
    if (stopping || (WIFEXITED(status) && WEXITSTATUS(status) == 0)) return 0;
    if (time(NULL) - window_start > 120) { window_start = time(NULL); crashes = 0; }
    if (++crashes >= 5) return 1;
    sleep(3);
  }
}
C
# Иконка: градиентный шар из assets/icon.png
ICONSET="$(mktemp -d)/AppIcon.iconset"
mkdir -p "$ICONSET"
for sz in 16 32 128 256 512; do
  sips -z $sz $sz assets/icon.png --out "$ICONSET/icon_${sz}x${sz}.png" >/dev/null
  sips -z $((sz*2)) $((sz*2)) assets/icon.png --out "$ICONSET/icon_${sz}x${sz}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"

clang -O2 -o "$APP/Contents/MacOS/Coulson" "$APP/Contents/Resources/launcher.c"
codesign --force --deep --sign - "$APP" >/dev/null 2>&1 || true
echo "Собрано: $APP"

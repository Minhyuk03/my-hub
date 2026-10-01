#!/bin/bash
# 네이티브 도우미를 빌드해 허브 전용 runtime 폴더에 둔다
#  - hub-materialize: iCloud 파일 내려받기
#  - HubCalendar.app: Mac 캘린더 앱 일정 읽기 (권한은 이 앱에 따로 준다)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
RT="$HOME/Library/Application Support/my-hub/runtime"
clang -O2 -Wall -o "$RT/hub-materialize" "$ROOT/native/materialize.c"
echo "빌드 완료: $RT/hub-materialize"

APP="$RT/HubCalendar.app"
mkdir -p "$APP/Contents/MacOS"
cp "$ROOT/native/HubCalendar/Info.plist" "$APP/Contents/Info.plist"
swiftc -O -o "$APP/Contents/MacOS/HubCalendar" "$ROOT/native/HubCalendar/main.swift"
codesign --force --sign - "$APP" >/dev/null
echo "빌드 완료: $APP"

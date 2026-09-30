#!/bin/bash
# 허브를 launchd LaunchAgent 로 등록한다 (로그인하면 자동 시작, 죽으면 다시 시작)
#   npm run service:install
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
NODE="$HOME/Library/Application Support/my-hub/runtime/current/bin/node"
LOGS="$HOME/Library/Logs/my-hub"
AGENTS="$HOME/Library/LaunchAgents"
UID_=$(id -u)

if [ ! -x "$NODE" ]; then
  echo "허브 전용 Node 가 없습니다: $NODE" >&2
  exit 1
fi
mkdir -p "$LOGS" "$AGENTS"

echo "1/3 운영용 빌드"
(cd "$ROOT" && "$NODE" node_modules/next/dist/bin/next build > "$LOGS/build.log" 2>&1) || { echo "빌드 실패: $LOGS/build.log 확인" >&2; exit 1; }
echo "2/3 DB 준비"
(cd "$ROOT" && "$NODE" --import tsx scripts/migrate.ts)

write_plist() { # 이름, 실행할 파일
  cat > "$AGENTS/com.myhub.$1.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.myhub.$1</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>--import</string>
    <string>tsx</string>
    <string>$2</string>
  </array>
  <key>WorkingDirectory</key><string>$ROOT</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_ENV</key><string>production</string>
    <key>PATH</key><string>/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$LOGS/$1.log</string>
  <key>StandardErrorPath</key><string>$LOGS/$1.log</string>
</dict>
</plist>
PLIST
}

echo "3/3 LaunchAgent 등록"
write_plist web server.ts
write_plist worker worker/index.ts
for n in web worker; do
  launchctl bootout "gui/$UID_/com.myhub.$n" 2>/dev/null || true
  launchctl bootstrap "gui/$UID_" "$AGENTS/com.myhub.$n.plist"
done
echo "완료. 로그: $LOGS  /  http://127.0.0.1:3000"

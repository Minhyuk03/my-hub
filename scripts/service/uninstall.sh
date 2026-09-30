#!/bin/bash
# LaunchAgent 등록 해제 (데이터·백업은 그대로 둔다)
set -uo pipefail
for n in web worker; do
  launchctl bootout "gui/$(id -u)/com.myhub.$n" 2>/dev/null && echo "멈춤: com.myhub.$n"
  rm -f "$HOME/Library/LaunchAgents/com.myhub.$n.plist"
done
echo "등록 해제 완료"

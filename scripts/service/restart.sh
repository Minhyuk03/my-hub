#!/bin/bash
# 코드 변경 후: 빌드 → DB 준비 → 서비스 다시 시작
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
NODE="$HOME/Library/Application Support/my-hub/runtime/current/bin/node"
if [ "${1:-}" != "--no-build" ]; then
  (cd "$ROOT" && "$NODE" node_modules/next/dist/bin/next build > "$HOME/Library/Logs/my-hub/build.log" 2>&1) || { echo "빌드 실패: ~/Library/Logs/my-hub/build.log" >&2; exit 1; }
fi
(cd "$ROOT" && "$NODE" --import tsx scripts/migrate.ts)
for n in worker web; do launchctl kickstart -k "gui/$(id -u)/com.myhub.$n"; done
echo "다시 시작했습니다."

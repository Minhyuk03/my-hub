#!/bin/bash
# iCloud 내려받기 도우미를 빌드해 허브 전용 runtime 폴더에 둔다
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$HOME/Library/Application Support/my-hub/runtime/hub-materialize"
clang -O2 -Wall -o "$OUT" "$ROOT/native/materialize.c"
echo "빌드 완료: $OUT"

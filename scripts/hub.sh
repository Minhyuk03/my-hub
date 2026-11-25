#!/bin/bash
# my-hub 관리 명령 (한 곳에서 상태 확인·재시작·로그·위치·백업·모델)
#   처음 한 번:  bash scripts/hub.sh setup   (또는 npm run hub:setup)
#   그다음부터:  hub status | restart | update | stop | start | logs | where | backup | models | open
set -uo pipefail

# ~/.local/bin/hub 같은 바로가기로 실행돼도 실제 저장소 위치를 찾는다
SRC="${BASH_SOURCE[0]}"
while [ -L "$SRC" ]; do
  DIR="$(cd -P "$(dirname "$SRC")" && pwd)"
  SRC="$(readlink "$SRC")"
  case "$SRC" in /*) ;; *) SRC="$DIR/$SRC" ;; esac
done
ROOT="$(cd -P "$(dirname "$SRC")/.." && pwd)"

APP_DATA="$HOME/Library/Application Support/my-hub"
NODE="$APP_DATA/runtime/current/bin/node"
LOGS="$HOME/Library/Logs/my-hub"
AGENTS="$HOME/Library/LaunchAgents"
DISK="/Volumes/Dev"
BACKUPS="/Volumes/Backup/hub-backups"
MODELS="$DISK/ollama/models"
OLLAMA_LOGS="$HOME/.ollama/logs"
OLLAMA_URL="${OLLAMA_URL:-http://127.0.0.1:11434}"
TAILSCALE="/Applications/Tailscale.app/Contents/MacOS/Tailscale"
LINKS="$HOME/my-hub"
BIN_DIR="$HOME/.local/bin"
UID_=$(id -u)
# 허브가 기본으로 쓰는 모델 (태그·요약 / 임베딩 / 채팅)
HUB_MODELS="gemma4:e4b bge-m3:latest"

if [ -t 1 ]; then G=$'\033[32m'; R=$'\033[31m'; Y=$'\033[33m'; B=$'\033[1m'; D=$'\033[2m'; N=$'\033[0m'; else G=; R=; Y=; B=; D=; N=; fi
ok()   { echo "  ${G}✓${N} $*"; }
bad()  { echo "  ${R}✗${N} $*"; }
warn() { echo "  ${Y}!${N} $*"; }
head_() { echo; echo "${B}$*${N}"; }
size() { [ -e "$1" ] && du -sh "$1" 2>/dev/null | awk '{print $1}' || echo "-"; }
need_node() { [ -x "$NODE" ] || { echo "허브 전용 Node 가 없습니다: $NODE" >&2; exit 1; }; }

svc_state() { # web | worker → "running (pid 123)" / "등록 안 됨"
  launchctl print "gui/$UID_/com.myhub.$1" 2>/dev/null |
    awk -F'= ' '!s && /^\tstate/{s=$2} !p && /^\tpid/{p=$2} END{ if (s=="") print "등록 안 됨"; else print s (p ? " (pid " p ")" : "") }'
}

cmd_status() {
  head_ "서비스"
  for n in web worker; do
    st=$(svc_state $n)
    label=$([ $n = web ] && echo "웹 서버 " || echo "워커    ")
    case "$st" in running*) ok "$label $st" ;; *) bad "$label $st" ;; esac
  done
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://127.0.0.1:3000/ 2>/dev/null)
  if [ -n "$code" ] && [ "$code" != "000" ]; then ok "웹 응답   http://127.0.0.1:3000 (HTTP $code)"; else bad "웹 응답   http://127.0.0.1:3000 응답 없음"; fi
  if [ -x "$TAILSCALE" ]; then
    ts=$(TERM=${TERM:-xterm} "$TAILSCALE" serve status 2>/dev/null | awk '/https:\/\//{print $1; exit}')
    if [ -n "$ts" ]; then ok "외부 접속 $ts (Tailscale)"; else warn "외부 접속 tailscale serve 설정 없음"; fi
  fi

  head_ "로컬 AI (Ollama)"
  if ver=$(curl -s --max-time 3 "$OLLAMA_URL/api/version" 2>/dev/null) && [ -n "$ver" ]; then
    ok "Ollama    켜짐 $(echo "$ver" | sed -E 's/.*"version":"([^"]*)".*/v\1/')"
    if [ -x "$NODE" ]; then
      loaded=$(curl -s --max-time 3 "$OLLAMA_URL/api/ps" | "$NODE" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log((JSON.parse(s).models||[]).map(m=>m.name).join(", "))}catch{}})')
      echo "    ${D}메모리에 올라간 모델: ${loaded:-없음}${N}"
    fi
  else
    bad "Ollama    꺼짐 (Ollama 앱을 실행하세요)"
  fi

  head_ "외장 디스크·백업"
  if mount | grep -q " on $DISK "; then
    ok "SSD       연결됨 (남은 공간 $(df -h "$DISK" | awk 'NR==2{print $4}'))"
  else
    bad "Disk      연결 안 됨 → AI 모델 없음, 백업은 임시 보관"
  fi
  last=$(ls -t "$BACKUPS"/hub-*.db 2>/dev/null | head -1)
  if [ -n "$last" ]; then
    hrs=$(( ( $(date +%s) - $(stat -f %m "$last") ) / 3600 ))
    if [ $hrs -le 30 ]; then ok "마지막 백업 ${hrs}시간 전 ($(basename "$last"))"; else warn "마지막 백업 ${hrs}시간 전 ($(basename "$last"))"; fi
  else
    warn "백업 파일을 찾지 못함 ($BACKUPS)"
  fi

  head_ "소스 연결 (워커 로그 기준 최근 상태)"
  if [ -f "$LOGS/worker.log" ] && [ -x "$NODE" ]; then
    tail -n 5000 "$LOGS/worker.log" | "$NODE" -e '
      let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
        const last=new Map();
        for (const l of s.split("\n")) {
          const m=l.match(/\[worker\] 스캔 종료 (.+?) (ok|offline|error|failed|[a-z_]+)(?: +(.*))?$/);
          if (m) last.set(m[1], [m[2], (m[3]||"").trim()]);
        }
        if (!last.size) { console.log("    (최근 스캔 기록 없음)"); return; }
        const G="\x1b[32m",R="\x1b[31m",N="\x1b[0m", tty=process.stdout.isTTY;
        let bad=0;
        for (const [name,[st,msg]] of last) if (st!=="ok") { bad++; console.log("  "+(tty?R:"")+"✗"+(tty?N:"")+" "+name+" — "+(msg||st)); }
        const good=[...last.values()].filter(([st])=>st==="ok").length;
        console.log("  "+(tty?G:"")+"✓"+(tty?N:"")+" 정상 "+good+"개"+(bad?" / 문제 "+bad+"개":""));
      })'
  else
    echo "    (워커 로그 없음)"
  fi
  echo
}

cmd_where() {
  row() { echo "  ${B}$1${N} ${D}($2)${N}"; echo "    $3"; }
  head_ "my-hub 가 쓰는 위치"
  row "코드"            "$(size "$ROOT")"             "$ROOT"
  row "데이터·DB"       "hub.db $(size "$APP_DATA/hub.db")" "$APP_DATA"
  row "실행용 Node"     "$(size "$APP_DATA/runtime")" "$APP_DATA/runtime"
  row "로그"            "$(size "$LOGS")"             "$LOGS"
  row "백업 (외장)"     "$(size "$BACKUPS")"          "$BACKUPS"
  row "AI 모델 (외장)"  "$(size "$MODELS")"           "$MODELS"
  row "Ollama 로그"     "$(size "$OLLAMA_LOGS")"      "$OLLAMA_LOGS"
  row "자동 실행"       "launchd"                     "$AGENTS/com.myhub.web.plist, com.myhub.worker.plist"
  row "토큰"            "출력 안 함"                  "$ROOT/.env.local  +  키체인 my-hub.google-drive"
  echo
  echo "  ${D}백업 위치를 허브 설정에서 바꿨다면 그쪽이 맞습니다. 한 폴더에서 보기: hub open${N}"
  echo
}

cmd_models() {
  head_ "Ollama 모델 ($MODELS, $(size "$MODELS"))"
  json=$(curl -s --max-time 3 "$OLLAMA_URL/api/tags" 2>/dev/null)
  if [ -z "$json" ]; then bad "Ollama 가 꺼져 있어 목록을 못 읽습니다"; echo; return 1; fi
  need_node
  echo "$json" | HUB_MODELS="$HUB_MODELS" "$NODE" -e '
    let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
      const used=new Set(process.env.HUB_MODELS.split(" "));
      const role={"gemma4:e4b":"태그·요약·채팅","bge-m3:latest":"검색 임베딩"};
      for (const m of JSON.parse(s).models||[]) {
        const gb=(m.size/1e9).toFixed(1)+"GB";
        console.log("  "+(used.has(m.name)?"●":"○")+" "+m.name.padEnd(26)+gb.padStart(7)+"  "+(role[m.name]||""));
      }
      console.log("\n  ● 허브가 쓰는 모델   ○ 안 쓰는 모델 (지우기: ollama rm 이름)");
    })'
  echo
}

cmd_logs() {
  case "${1:-}" in
    web|worker|build) tail -n 50 -f "$LOGS/$1.log" ;;
    ollama) tail -n 50 -f "$OLLAMA_LOGS/server.log" ;;
    "") tail -n 20 -f "$LOGS/web.log" "$LOGS/worker.log" ;;
    *) echo "hub logs [web|worker|build|ollama]"; exit 1 ;;
  esac
}

cmd_restart() { # 빌드 없이 다시 시작
  for n in worker web; do launchctl kickstart -k "gui/$UID_/com.myhub.$n" && echo "다시 시작: com.myhub.$n"; done
}
cmd_stop() {
  for n in web worker; do launchctl bootout "gui/$UID_/com.myhub.$n" 2>/dev/null && echo "멈춤: com.myhub.$n"; done
  echo "다시 켜기: hub start   (로그인하면 자동으로도 켜집니다)"
}
cmd_start() {
  for n in web worker; do
    if launchctl print "gui/$UID_/com.myhub.$n" >/dev/null 2>&1; then echo "이미 실행 중: com.myhub.$n"
    elif [ -f "$AGENTS/com.myhub.$n.plist" ]; then launchctl bootstrap "gui/$UID_" "$AGENTS/com.myhub.$n.plist" && echo "시작: com.myhub.$n"
    else echo "등록 안 됨: npm run service:install 을 먼저 실행하세요" >&2; exit 1; fi
  done
}
cmd_backup() { need_node; (cd "$ROOT" && "$NODE" --import tsx scripts/backup-now.ts); }

cmd_setup() {
  echo "1/2 바로가기 폴더 $LINKS"
  mkdir -p "$LINKS/자동 실행"
  link() { # 대상, 이름
    if [ -e "$LINKS/$2" ] && [ ! -L "$LINKS/$2" ]; then echo "  건너뜀 (같은 이름의 실제 파일/폴더 있음): $2"; return; fi
    ln -sfn "$1" "$LINKS/$2" && echo "  $2 → $1"
  }
  link "$ROOT"        "코드"
  link "$APP_DATA"    "데이터"
  link "$LOGS"        "로그"
  link "$BACKUPS"     "백업 (외장)"
  link "$MODELS"      "AI 모델 (외장)"
  link "$OLLAMA_LOGS" "Ollama 로그"
  link "$AGENTS/com.myhub.web.plist"    "자동 실행/com.myhub.web.plist"
  link "$AGENTS/com.myhub.worker.plist" "자동 실행/com.myhub.worker.plist"
  cat > "$LINKS/사용법.txt" <<TXT
my-hub 관리 폴더 (바로가기 모음 — 실제 파일은 원래 위치에 있습니다)

  코드            $ROOT
  데이터          $APP_DATA   (hub.db: 내장 디스크에 있어야 안전)
  로그            $LOGS
  백업 (외장)     $BACKUPS     (DB와 다른 디스크여야 의미가 있음)
  AI 모델 (외장)  $MODELS      (용량 때문에 외장)
  Ollama 로그     $OLLAMA_LOGS
  자동 실행       launchd 설정 (macOS가 정한 위치)

터미널 명령
  hub status          웹·워커·Ollama·외장 디스크·백업·소스 연결 상태 한 번에
  hub restart         빌드 없이 다시 시작
  hub update          코드 바꾼 뒤: 빌드 → DB 준비 → 다시 시작
  hub stop / start    멈춤 / 시작
  hub logs [web|worker|build|ollama]   로그 실시간 보기 (Ctrl+C 로 끝)
  hub where           모든 위치와 용량
  hub models          Ollama 모델 목록, 허브가 쓰는 모델 표시
  hub backup          지금 바로 백업
  hub open            이 폴더 열기  /  hub web : 허브 화면 열기

주의: 바로가기 폴더 안의 파일을 지우면 원본이 지워집니다.
TXT
  echo "  사용법.txt"

  echo "2/2 hub 명령 설치 $BIN_DIR/hub"
  mkdir -p "$BIN_DIR"
  name=hub
  other=$(command -v hub 2>/dev/null || true)
  if [ -n "$other" ] && [ "$other" != "$BIN_DIR/hub" ]; then
    name=myhub; echo "  'hub' 이름을 다른 프로그램($other)이 쓰고 있어 'myhub' 로 설치합니다"
  fi
  ln -sfn "$ROOT/scripts/hub.sh" "$BIN_DIR/$name"
  chmod +x "$ROOT/scripts/hub.sh"
  case ":$PATH:" in
    *":$BIN_DIR:"*) echo "  완료: 이제 어디서든 '$name status'" ;;
    *)
      rc="$HOME/.zshrc"
      if ! grep -q 'my-hub: hub 명령' "$rc" 2>/dev/null; then
        printf '\n# my-hub: hub 명령\nexport PATH="$HOME/.local/bin:$PATH"\n' >> "$rc"
        echo "  ~/.zshrc 에 ~/.local/bin 경로를 추가했습니다"
      fi
      echo "  완료: 새 터미널 창을 열고 '$name status'" ;;
  esac
  open "$LINKS" 2>/dev/null || true
}

usage() { sed -n '1,/^#   그다음부터/p' "$SRC" | sed 's/^# \{0,1\}//' | tail -n +2; [ -f "$LINKS/사용법.txt" ] && sed -n '/^터미널 명령/,/^  hub open/p' "$LINKS/사용법.txt"; return 0; }

case "${1:-status}" in
  status|st)  cmd_status ;;
  where)      cmd_where ;;
  models)     cmd_models ;;
  logs|log)   shift; cmd_logs "${1:-}" ;;
  restart)    cmd_restart ;;
  update)     shift; bash "$ROOT/scripts/service/restart.sh" "$@" ;;
  stop)       cmd_stop ;;
  start)      cmd_start ;;
  backup)     cmd_backup ;;
  open)       [ -d "$LINKS" ] || cmd_setup; open "$LINKS" ;;
  web)        open "http://127.0.0.1:3000" ;;
  setup)      cmd_setup ;;
  help|-h|--help) usage ;;
  *) echo "모르는 명령: $1"; usage; exit 1 ;;
esac

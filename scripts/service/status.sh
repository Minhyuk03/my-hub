#!/bin/bash
for n in web worker; do
  if launchctl print "gui/$(id -u)/com.myhub.$n" >/dev/null 2>&1; then
    st=$(launchctl print "gui/$(id -u)/com.myhub.$n" | awk -F'= ' '/^\tstate/{print $2; exit}')
    pid=$(launchctl print "gui/$(id -u)/com.myhub.$n" | awk -F'= ' '/^\tpid/{print $2; exit}')
    echo "com.myhub.$n: ${st:-?} ${pid:+(pid $pid)}"
  else
    echo "com.myhub.$n: 등록 안 됨"
  fi
done
echo "--- 최근 로그"
tail -n 5 "$HOME/Library/Logs/my-hub/web.log" "$HOME/Library/Logs/my-hub/worker.log" 2>/dev/null

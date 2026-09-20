#!/usr/bin/env bash
# 端對端測試：以全新資料庫啟動伺服器，用 headless Chrome 跑過完整流程。
# 用法：scripts/e2e.sh <探針檔.js>
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${BTMS_E2E_DIR:-/tmp/btms-e2e}"
PORT="${BTMS_E2E_PORT:-8935}"
# 測試密碼每次隨機產生，倉庫內不留任何密碼字串。
# 探針以 window.__E2E_PW 取用。
# （用 openssl 而非 tr </dev/urandom | head：後者會讓上游收到 SIGPIPE，
#   在 set -o pipefail 之下整支腳本會就地結束。）
rand16() { openssl rand -hex 8; }
ADMIN_PW="Ev1dence-$(rand16)"
NEW_PW="Hunt1ng-$(rand16)"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
PROBE="${1:?請指定探針檔}"

cleanup() {
  [[ -n "${SRV_PID:-}" ]] && kill "$SRV_PID" 2>/dev/null || true
  rm -f "$ROOT/public/__probe.html"
}
trap cleanup EXIT

rm -rf "$WORK"
node "$ROOT/scripts/build-client.mjs" >/dev/null

BTMS_DATA_DIR="$WORK" BTMS_PORT="$PORT" BTMS_ADMIN_PASSWORD="$ADMIN_PW" BTMS_SEED_DEMO=true \
  node "$ROOT/src/server.js" > "$WORK.log" 2>&1 &
SRV_PID=$!

for _ in $(seq 1 40); do
  if curl -sf "http://127.0.0.1:$PORT/api/v1/healthz" >/dev/null 2>&1; then break; fi
  perl -e 'select undef,undef,undef,0.25'
done

# SSE 是長連線，headless 的虛擬時間不會結束，測試時以空殼取代
{
  cat "$ROOT/public/index.html"
  printf '%s\n' '<script>window.EventSource=function(){return{close(){},addEventListener(){},set onerror(v){}};};</script>'
  printf '<script>window.__E2E_PW="%s";window.__E2E_NEW_PW="%s";</script>\n' \
    "$ADMIN_PW" "$NEW_PW"
  cat "$PROBE"
} > "$ROOT/public/__probe.html"

"$CHROME" --headless --disable-gpu --virtual-time-budget=30000 \
  --dump-dom "http://127.0.0.1:$PORT/__probe.html" 2>/dev/null \
  | python3 -c "
import sys,re,html,io
sys.stdout=io.TextIOWrapper(sys.stdout.buffer,encoding='utf-8')
h=sys.stdin.read()
m=re.search(r'id=\"__report\"[^>]*>(.*?)</div>',h,re.S)
print(html.unescape(m.group(1)) if m else 'NO REPORT')
"

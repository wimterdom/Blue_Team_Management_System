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
  rm -f "$ROOT/public/__probe.html" "$ROOT/public/__app.html"
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

# 探針是獨立的模組，看不到 app 模組的頂層繫結。這裡在 app 模組收尾前插入
# 一個測試把手——屬於測試設施，不會進到產品輸出。
# SSE 是長連線，headless 的虛擬時間不會結束，測試時另以空殼取代。
python3 - "$ROOT/public/index.html" > "$ROOT/public/__app.html" <<'PYEOF'
import sys
src = open(sys.argv[1], encoding='utf-8').read()
handle = (
    "\n/* e2e 測試把手 */\nwindow.__T = {\n"
    "  get ASSETS(){return ASSETS}, get ADETAIL(){return ADETAIL},\n"
    "  get CASES(){return CASES}, get DETAIL(){return DETAIL},\n"
    "  get S(){return S}, get STORE(){return STORE},\n"
    "  buildXlsx, buildCsv, parseCsv, assetCsvTemplate, validateAssetRows,\n"
    "  commitAssetImport, ASSET_COLUMNS, assetCellValue, svgToPng, printDoc,\n"
    "};\n"
)
i = src.rindex('</script>')
sys.stdout.write(src[:i] + handle + src[i:])
PYEOF

{
  cat "$ROOT/public/__app.html"
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
# 探針若附帶二進位輸出，另存到檔案供驗證
x=re.search(r'id=\"__xlsx\"[^>]*>([A-Za-z0-9+/=]*)</div>',h,re.S)
if x and x.group(1):
    import base64, os
    out=os.environ.get('BTMS_E2E_DIR','/tmp/btms-e2e')+'.xlsx'
    open(out,'wb').write(base64.b64decode(x.group(1)))
    print(f'（已存出 {out}）')
"

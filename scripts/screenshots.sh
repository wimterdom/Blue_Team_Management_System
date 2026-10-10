#!/usr/bin/env bash
# 產生 README 用的系統畫面截圖。
#
# 以全新資料庫 + 示範資料啟動一個暫時的實例，用 headless Chrome 逐一拍攝，
# 輸出到 docs/screenshots/。改版後重跑即可更新，不必手動截圖。
#
#   scripts/screenshots.sh            # 全部重拍
#   scripts/screenshots.sh intel      # 只拍指定的幾張
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/docs/screenshots"
WORK="${BTMS_SHOT_DIR:-/tmp/btms-shots}"
PORT="${BTMS_SHOT_PORT:-8977}"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
W="${SHOT_W:-1480}"
H="${SHOT_H:-980}"

# 截圖用的實例不走強制改密，否則每張都得先過一次改密畫面
PW="Shot0nly-$(openssl rand -hex 6)"

ALL=(login cases caseDetail requests assets assetImport topology intel matrix audit archive archiveRestore light)
SHOTS=("${@:-${ALL[@]}}")
[[ $# -gt 0 ]] && SHOTS=("$@")

cleanup() {
  [[ -n "${SRV_PID:-}" ]] && kill "$SRV_PID" 2>/dev/null || true
  rm -f "$ROOT/public/__shot.html"
}
trap cleanup EXIT

mkdir -p "$OUT"
rm -rf "$WORK"
node "$ROOT/scripts/build-client.mjs" >/dev/null

BTMS_DATA_DIR="$WORK" BTMS_PORT="$PORT" BTMS_ADMIN_PASSWORD="$PW" \
BTMS_SEED_DEMO=true BTMS_FORCE_PW_CHANGE=false \
  node "$ROOT/src/server.js" > "$WORK.log" 2>&1 &
SRV_PID=$!

for _ in $(seq 1 60); do
  curl -sf "http://127.0.0.1:$PORT/api/v1/healthz" >/dev/null 2>&1 && break
  perl -e 'select undef,undef,undef,0.25'
done

# 匯入預覽那張要餵一份 nmap 報告進去
NMAP_FIXTURE="$ROOT/tests/fixtures/scan.xml"

for name in "${SHOTS[@]}"; do
  printf '  %-14s ' "$name"
  python3 - "$ROOT" "$name" "$PW" "$NMAP_FIXTURE" <<'PYEOF'
import json, sys
root, shot, pw, fixture = sys.argv[1:5]
src = open(f'{root}/public/index.html', encoding='utf-8').read()
try:
    nmap = open(fixture, encoding='utf-8').read()
except OSError:
    nmap = ''
# SSE 是長連線，headless 的虛擬時間不會結束，截圖時以空殼取代
stub = '<script>window.EventSource=function(){return{close(){},addEventListener(){},set onerror(v){}};};</script>\n'
cfg = ('<script>window.__SHOT=%s;window.__SHOT_PW=%s;window.__SHOT_NMAP=%s;</script>\n'
       % (json.dumps(shot), json.dumps(pw), json.dumps(nmap)))
# 截圖腳本是獨立模組，看不到 app 模組的頂層繫結。需要 STORE 的畫面
# （例如封存還原，得先產生一份封存檔當輸入）靠這個把手取用。
handle = '\n/* 截圖把手 */\nwindow.__T_STORE = STORE;\nwindow.saveBlob = saveBlob;\n'
i = src.rindex('</script>')
src = src[:i] + handle + src[i:]
probe = open(f'{root}/tests/shots.js', encoding='utf-8').read()
open(f'{root}/public/__shot.html', 'w', encoding='utf-8').write(src + stub + cfg + probe)
PYEOF

  "$CHROME" --headless --disable-gpu --hide-scrollbars \
    --window-size="$W,$H" --virtual-time-budget="${SHOT_BUDGET:-25000}" \
    --screenshot="$OUT/$name.png" "http://127.0.0.1:$PORT/__shot.html" 2>/dev/null

  if [[ -f "$OUT/$name.png" ]]; then
    printf '%s\n' "$(du -h "$OUT/$name.png" | cut -f1)"
  else
    printf 'FAILED\n'
  fi
done

echo
echo "截圖輸出於 docs/screenshots/"

# 維運手冊

## 資料放在哪裡

全部在容器的 `/data` 磁碟區底下，搬機器時整個磁碟區帶走即可：

```
/data
├── btms.sqlite           資料庫（案件、請求、資產、情資、帳號、稽核）
├── btms.sqlite-wal       WAL 日誌
├── btms.sqlite-shm       共享記憶體索引
├── attachments/          附件實體檔案，依 SHA-256 前四碼分層存放
└── backups/              自動備份
```

附件以內容雜湊命名，相同檔案只存一份。刪除附件是軟刪除，
資料庫標記 `deleted=1`，實體檔案保留，以便誤刪時還原。

## 備份與還原

系統預設每 24 小時做一次線上備份（SQLite 原生 backup API，不必停機），
保留 7 份，都在 `/data/backups/`。以 `BTMS_BACKUP_*` 系列變數調整。

### 手動備份

```bash
docker exec btms node -e "
  import('./src/db/index.js').then(m =>
    m.backupTo('/data/backups/manual-' + Date.now() + '.sqlite'))
"
```

### 取出備份

```bash
docker cp btms:/data/backups ./btms-backups
```

### 還原

```bash
docker compose down
docker run --rm -v btms-data:/data -v "$PWD:/restore" alpine \
  sh -c 'cp /restore/btms-20260913.sqlite /data/btms.sqlite &&
         rm -f /data/btms.sqlite-wal /data/btms.sqlite-shm'
docker compose up -d
```

還原時務必一併刪掉 `-wal` 與 `-shm`，否則 SQLite 會拿舊的 WAL 去套新的資料庫，
結果是資料毀損。附件另外還原 `/data/attachments`。

## 帳號出了狀況

| 情況 | 處理方式 |
|---|---|
| 使用者忘記密碼 | 管理員於「使用者管理」→ 編輯 → 填新密碼。該帳號所有登入立即失效，下次登入須自行變更 |
| 連續輸錯被鎖定 | 等 `BTMS_LOCKOUT_MIN`（預設 15 分鐘）自動解鎖，或由管理員編輯該帳號時勾選解鎖 |
| 管理員自己被鎖在外面 | 見下方「救援管理員帳號」 |
| 人員離職 | 停用而非刪除。名下仍有紀錄的帳號，系統會自動改為停用，以保住報告作者與稽核鏈 |

### 救援管理員帳號

沒有任何啟用中的管理員時，重啟容器會自動重建一個：

```bash
docker compose down
docker volume inspect btms_btms-data >/dev/null   # 確認資料還在
docker run --rm -v btms_btms-data:/data alpine \
  sh -c "apk add -q sqlite && sqlite3 /data/btms.sqlite \
    \"UPDATE users SET disabled=1 WHERE perm='admin';\""
docker compose up -d
docker logs btms | grep -A6 '首次啟動'
```

最後一行會印出新產生的隨機管理員密碼。此密碼只顯示一次。

## 稽核紀錄

所有登入、建立、修改、刪除都會留痕，含異動欄位的前後值。
管理員可由帳號選單進入「稽核紀錄」查詢，或匯出 CSV：

```bash
curl -b cookies.txt https://btms.example.com/api/v1/audit.csv -o audit.csv
```

預設永久保留。要設定保留期限請調整 `BTMS_AUDIT_RETENTION_DAYS`，
系統每小時清理一次過期紀錄。

## 監控

| 端點 | 用途 | 正常回應 |
|---|---|---|
| `/api/v1/healthz` | 存活檢查，行程還在就回 200 | `{"status":"ok"}` |
| `/api/v1/readyz` | 就緒檢查，會實際碰一次資料庫 | `{"status":"ready"}` |
| `/api/v1/version` | 版本與目前 SSE 連線數 | `{"version":"1.0.0",…}` |

Docker 的 `HEALTHCHECK` 打的是 `/readyz`。`docker ps` 的 STATUS 欄位會顯示
`healthy` / `unhealthy`。

日誌是結構化 JSON（pino），密碼、權杖與 Cookie 一律遮蔽為 `[已遮蔽]`。

```bash
docker logs -f btms | jq 'select(.level >= 40)'    # 只看警告以上
```

## 升級

```bash
git pull
docker compose build
docker compose up -d
```

資料庫遷移在啟動時自動執行，已套用的遷移不會重複執行。
升級前建議先手動備份一份。

## 效能

規格的目標是約 30 人同時使用、無感延遲。實測上瓶頸不在此規模，
但有兩點值得留意：

- **附件目錄會持續長大。** 影像不會自動清理，定期檢查 `du -sh /data/attachments`。
- **SQLite 的 WAL 檔案**在長時間高頻寫入後會變大。系統關閉時會做一次
  `wal_checkpoint(TRUNCATE)`；若長期不重啟，可手動執行一次。

## 反向代理注意事項

置於 Nginx／Caddy 之後時：

1. 設定 `BTMS_TRUST_PROXY=true`，稽核紀錄才會記到真實來源 IP 而非代理位址
2. 以 HTTPS 對外時設定 `BTMS_COOKIE_SECURE=true`
3. **即時推播（SSE）必須關閉緩衝**，否則其他人的異動不會即時出現：

```nginx
location /api/v1/events {
    proxy_pass http://btms:8080;
    proxy_http_version 1.1;
    proxy_set_header Connection '';
    proxy_buffering off;
    proxy_read_timeout 3600s;
}
```

Caddy 用 `flush_interval -1`，倉庫內的 `Caddyfile` 已經設好。

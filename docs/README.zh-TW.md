# 藍隊管理系統 Blue Team Management System

> 繁體中文版說明文件。English: [`README.md`](../README.md)

威脅獵補團隊的日常作業平台。五套子系統共用同一組帳號與同一份資料，
分析員寫下的證據與時間軸，其他隊員立刻就看得到。

單一 Docker 映像檔即可部署——目標主機只需要裝好 Ubuntu 與 Docker，
不依賴任何外部託管服務。

---

## 目錄

- [系統介紹](#系統介紹)
- [系統架構](#系統架構)
- [系統需求](#系統需求)
- [安裝方式](#安裝方式)
- [對外開放前的四件事](#對外開放前的四件事)
- [首次登入](#首次登入)
- [組態](#組態)
- [API](#api)
- [開發](#開發)
- [授權](#授權)

---

## 系統介紹

### 五套子系統

| 子系統 | 做什麼 |
|---|---|
| **獵補案件簿** | 調查報告的建立、查閱與結案。含案發時間軸、連線紀錄、IOC、MITRE TTP、附圖與處置建議 |
| **請求管理系統** | RFI（資訊請求）與 CR（變更請求）的申請、指派與追蹤 |
| **資產管理系統** | 主機與網通設備清冊。含 IPv4／IPv6／MAC、製造商國別、上層網通設備與 VLAN、已知漏洞與附件 |
| **主機標定系統** | 網路拓樸圖。以攻擊流向標出受害主機與橫向移動路徑，並管理感測器的佈署位置 |
| **情資管理系統** | APT 組織報告、情資報告、威脅獵補計畫，以及 ATT&CK 熱圖與受檢環境風險評估 |

左上角可隨時切換子系統。五套系統互相引用——案件連到資產、資產連到拓樸、
情資連到獵補計畫，跨系統跳轉後可一鍵返回原畫面。

### 功能重點

**調查與協作**

- 調查報告支援 Markdown 撰寫，附圖可上傳並於燈箱中放大檢視
- 每筆紀錄各自獨立寫入並帶版本號，多人同時編輯不同資料不會互相覆蓋；
  編輯同一筆時後存檔者會收到提示，而非無聲蓋掉對方的成果
- 任何人存檔後，其他線上成員的畫面即時更新（Server-Sent Events），不必重新整理
- 首頁案件清單依**案發時間**排序，而非紀錄建立時間
- 儀表板統計由資料庫即時彙算，新建或改判的案件立刻反映

**權限與稽核**

- 三級權限：系統管理員／案件管理（隊長、副隊長）／一般分析員
- 一般分析員只能修改自己建立的紀錄——這條規則在伺服器端強制執行，
  不是只把按鈕藏起來
- 所有登入、建立、修改、刪除都寫入稽核紀錄，含異動欄位的前後值，
  管理員可查詢並匯出 CSV

**安全**

- 密碼以 argon2id 雜湊保存，系統任何畫面都不顯示明文
- 會話 Cookie 為 HttpOnly，資料庫只存權杖的 SHA-256；閒置逾時與絕對逾時雙重限制
- 登入失敗次數上限與帳號鎖定；寫入類請求需帶 CSRF 權杖
- 附件以實際位元組嗅探型別，不信任副檔名
- 認證抽離為獨立的 Provider 介面，日後接 OIDC SSO 不需更動任何呼叫端
  （見 [docs/SSO.md](SSO.md)）

**匯出與匯入**

- **報告匯出 PDF**：調查報告、請求表、資產明細、情資報告、獵補計畫與 APT 報告皆可，
  走瀏覽器列印，在對話框選「另存為 PDF」即得檔案。自行產生 PDF 位元組就得內嵌一套
  中日韓字型（完整 Noto Sans TC 約 8 MB），排版品質還不如瀏覽器本身。
  列印版是另外編排的：標頭、中繼資料表與各段落，不含畫面上的按鈕
- **圖表匯出 PNG 或 SVG**：拓撲圖、TTP 熱圖與各儀表板圖表皆可。
  PNG 為 2 倍解析度；SVG 放大不失真、文字仍是文字（可搜尋、可複製、可再編輯），
  檔案通常也小得多——示範資料的拓撲圖 PNG 約 690 KB、SVG 約 175 KB。
  兩者都匯出**完整的圖**，依內容實際邊界取景，不受畫面上縮放與平移影響；
  顏色於匯出時自 CSS 變數解析，SVG 另帶同色底，離開系統也不會變色
- **資產匯出 XLSX**：可選目前篩選或全部。單一工作表、首列凍結、含自動篩選。
  OOXML 為自行組出，不引入試算表函式庫
- **資產以 CSV 匯入**：批次建立或更新，提供範本下載。**匯入前一定先預覽**，
  逐列標出將新建還是更新；主機名稱重複、IPv4／MAC／網段格式不符、重要性無效、
  資產編號不存在、檔案內自己重複——都會標出且該列不寫入，其餘正常的列照常匯入。
  匯入走與手動編輯相同的路徑，因此一樣有稽核紀錄與權限檢查

**介面**

- 繁體中文介面，日間／夜間／跟隨系統三種佈景
- 所有列表都有篩選器、排序與每頁筆數設定
- 手機寬度可用

---

## 系統架構

```
┌─────────────────────────────────────────────────────────┐
│                  瀏覽器（單頁應用）                        │
│   五套子系統共用同一份畫面程式碼與同一個資料存取層            │
└───────────────┬─────────────────────────┬───────────────┘
                │ REST /api/v1            │ SSE /api/v1/events
                │                         │ （即時推播他人的異動）
┌───────────────▼─────────────────────────▼───────────────┐
│                    Fastify（Node.js 24）                 │
│                                                          │
│  認證        AuthProvider 介面 → Local（argon2id）        │
│                                → OIDC（接縫已備）          │
│  存取控制    伺服器端強制；分析員僅能改自己的紀錄            │
│  稽核        所有寫入留痕，含欄位前後值                     │
│  附件        串流寫入、型別嗅探、SHA-256 去重               │
└───────────────┬──────────────────────────────────────────┘
                │
┌───────────────▼──────────────────────────────────────────┐
│              SQLite（WAL 模式，行程內）                    │
│                                                           │
│  records     業務資料。集合 + JSON 文件 + 版本號（樂觀鎖）   │
│  users       帳號、雜湊密碼、權限、鎖定狀態                 │
│  sessions    會話（存權杖雜湊，不存原值）                   │
│  audit       稽核紀錄                                      │
│  attachments 附件中繼資料                                  │
└───────────────────────────────────────────────────────────┘
                │
        /data 磁碟區（資料庫、附件、備份）
```

### 為什麼是這個組合

**單一行程、嵌入式資料庫。** 規格要求單一跨平台映像檔、可快速重新部署、
不依賴外部託管服務。SQLite 在 WAL 模式下讀取不被寫入阻塞，
30 人並行綽綽有餘，而且備份就是複製一個檔案。

**業務資料採「集合 + JSON 文件」。** 五套子系統的欄位仍在演進，
JSON 讓欄位增修不必每次改結構；需要排序與判權的熱欄位另以產生欄位
（generated column）外露並建索引，查詢效能與正規化資料表相當。
帳號、會話、稽核這些系統級資料則是正規化欄位。

**樂觀鎖而非悲觀鎖。** 30 人的團隊裡兩人同時編輯同一份報告是少數情形，
為此鎖定整筆紀錄代價太高。改為更新時比對版本號，衝突時提示重新載入。

### 目錄結構

```
.
├── client/              UI 單一來源
│   ├── index.html       五套子系統的完整畫面程式碼
│   ├── datalayer.js     資料存取層（server／demo 兩種實作）
│   ├── prod-views.js    正式版專屬畫面：變更密碼、稽核紀錄
│   └── prod.css
├── src/
│   ├── server.js        進入點：安全標頭、CSRF、速率限制、路由掛載
│   ├── config.js        組態（一律由環境變數注入）
│   ├── auth/            密碼雜湊、認證 Provider、會話
│   ├── db/              連線、遷移
│   ├── lib/             紀錄倉儲、稽核、推播、儀表板彙算、初始化
│   ├── middleware/      存取控制
│   ├── routes/          auth／collections／attachments／users／audit／events／health
│   └── openapi.js       API 文件
├── public/index.html    建置產出：正式版（不含任何示範資料）
├── dist/demo.html       建置產出：展示版（localStorage，含示範資料）
├── seed/                參照資料與示範資料
├── scripts/             建置、種子抽取、端對端測試
├── docs/                SSO 接法、維運手冊
├── Dockerfile
└── docker-compose.yml
```

`client/index.html` 是唯一的畫面來源，`scripts/build-client.mjs` 由它產生兩份輸出：
正式版走 API，展示版走 localStorage。兩者畫面程式碼完全相同，
因此在展示版上驗收出來的修正，直接就是正式版的修正。

---

## 系統需求

### 主機

| 項目 | 最低 | 建議 |
|---|---|---|
| 作業系統 | Ubuntu 22.04 LTS | Ubuntu 24.04 LTS |
| CPU | 1 核 | 2 核 |
| 記憶體 | 512 MB | 2 GB |
| 磁碟 | 2 GB | 20 GB（視附件量而定） |
| Docker | 20.10+ | 最新穩定版 |

架構支援 `linux/amd64` 與 `linux/arm64`。

### 用戶端

近兩年內的 Chrome、Edge、Firefox 或 Safari。需啟用 JavaScript。

---

## 安裝方式

### 1. 安裝 Docker（Ubuntu）

若主機尚未安裝：

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
     -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

echo "deb [arch=$(dpkg --print-architecture) \
signed-by=/etc/apt/keyrings/docker.asc] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io \
     docker-buildx-plugin docker-compose-plugin

# 免 sudo 執行 docker（需重新登入才生效）
sudo usermod -aG docker "$USER"
```

驗證：

```bash
docker --version
docker compose version
```

### 2. 取得原始碼並建置映像檔

```bash
git clone https://github.com/wimterdom/Blue_Team_Management_System.git
cd Blue_Team_Management_System
docker build -t btms:1.0.0 .
```

### 3. 啟動

#### 方式一：一行指令

```bash
docker run -d \
  --name btms \
  --restart unless-stopped \
  -p 8080:8080 \
  -v btms-data:/data \
  -e BTMS_ADMIN_USER=admin \
  btms:1.0.0
```

未指定 `BTMS_ADMIN_PASSWORD` 時，系統會產生一組高強度隨機密碼並印在日誌中：

```bash
docker logs btms | grep -A6 '首次啟動'
```

```
────────────────────────────────────────────────────
  首次啟動 — 已建立初始管理員帳號
    帳號：admin
    密碼：xK9mQ2vL8pR4wN6tY3sD
  此密碼只顯示這一次，登入後系統會要求立即變更。
  若要自行指定，請以 BTMS_ADMIN_PASSWORD 環境變數設定。
────────────────────────────────────────────────────
```

> 若要自行指定初始密碼，加上 `-e BTMS_ADMIN_PASSWORD='你的密碼'`。
> 請留意這樣密碼會留在 shell 歷史紀錄中；改用 `.env` 檔較為妥當。

#### 方式二：Docker Compose（建議）

```bash
cp .env.example .env
$EDITOR .env          # 至少確認 BTMS_ADMIN_USER
docker compose up -d
docker compose logs | grep -A6 '首次啟動'
```

Compose 預設把連接埠開在所有介面（`"8080:8080"`），同網段的同仁可直接連。
若只想綁在本機，把 `docker-compose.yml` 裡那行改成 `"127.0.0.1:8080:8080"`。

服務本來就設計成要讓隊友連得到，因此首次啟動前請先看過
[對外開放前的四件事](#對外開放前的四件事)。

#### 方式三：加上 HTTPS

```bash
echo "BTMS_DOMAIN=btms.example.com" >> .env
echo "BTMS_COOKIE_SECURE=true"      >> .env
echo "BTMS_TRUST_PROXY=true"        >> .env
docker compose --profile tls up -d
```

Caddy 會自動向 Let's Encrypt 申請並續期憑證（主機需能從外部連入 80／443）。
內網部署沒有公開網域時，把 `Caddyfile` 裡的 `tls internal` 那行取消註解，
改用 Caddy 自簽的內部憑證。

### 對外開放前的四件事

預設的 `docker-compose.yml` 把 8080 埠開在所有介面上，好讓隊友直接連——
這是刻意的部署方式，也因此下面四點值得在首次啟動前花一分鐘處理。

**一、先設好管理員密碼。** `.env.example` 為了方便，預設寫著
`BTMS_ADMIN_PASSWORD=admin`。首次登入雖然會強制變更密碼，但那保護的是
「第一個登入的人」——在對外開放的連接埠上，那不一定是你。
請在 `.env` 填一組真正的密碼，或把 `BTMS_ADMIN_PASSWORD` 留空讓容器產生隨機密碼，
從日誌取得後先登入，再把網址公告出去。

```bash
# 寫在 .env 裡
BTMS_ADMIN_PASSWORD='只有你知道的密碼'
```

另外說明：初始密碼刻意不套用密碼強度政策——它的用途只是讓你進得去一次。
首次登入時設定的那組密碼才會受政策檢查。

**二、內網走 HTTP，會話 Cookie 是明文傳輸的。** 能側錄該網段流量的人就能重放。
若該網段是可信賴的，這或許是可接受的風險；若不是，請改用
[方式三](#方式三加上-https)並設定 `BTMS_COOKIE_SECURE=true`。

**三、限制哪些主機連得到這個埠。** Docker 是透過自己的 iptables 鏈轉發的，
所以寫在 `INPUT` 鏈的主機防火牆規則看不到這些流量——要擋得在 Docker 的鏈上擋，
或改成只綁在特定介面：

```bash
# 只允許這個網段連進 8080
sudo iptables -I DOCKER-USER -p tcp --dport 8080 ! -s 10.32.0.0/16 -j DROP

# 或在 docker-compose.yml 綁定單一介面
ports:
  - "10.32.5.20:8080:8080"
```

**四、帳號一律由管理員建立，沒有自助註冊。** 系統沒有註冊頁面，
對外開放的連接埠對未認證的訪客而言就只是一個登入表單。
登入失敗有速率限制、連續五次即鎖定帳號，且每一次嘗試都寫入稽核紀錄——
若服務面對的網路比你預期的更廣，可用
`/api/v1/audit?action=login_failed` 查閱。

### 4. 確認運作

```bash
curl -fsS http://localhost:8080/api/v1/readyz
# {"status":"ready"}

docker ps --format '{{.Names}}\t{{.Status}}'
# btms    Up 2 minutes (healthy)
```

瀏覽器開啟 `http://<主機位址>:8080`。

### 想先看看效果？

帶示範資料啟動一個獨立的實例（36 件案件、26 張請求表、31 項資產、
21 篇情資、20 份獵補計畫）：

```bash
docker run -d --name btms-demo -p 8081:8080 \
  -v btms-demo-data:/data \
  -e BTMS_SEED_DEMO=true \
  btms:1.0.0
```

示範帳號一律是**停用且無密碼**的狀態，需由管理員啟用並設定密碼後才能登入。
正式部署請維持 `BTMS_SEED_DEMO=false`（預設值）。

---

## 首次登入

1. 以日誌中的帳號密碼登入
2. 系統會**強制要求變更密碼**——在變更完成前，除了改密碼以外的 API 一律擋下，
   無法繞過
3. 變更後進入「使用者管理」建立團隊成員帳號

密碼規則：至少 12 個字元（中日韓文字以兩個字元計，但實際不得少於 8 字）、
不得包含帳號或姓名、不得以常見字加數字構成、不得含連續鍵盤或數字序列。

權限分三級：

| 權限 | 可做什麼 |
|---|---|
| `admin` 系統管理員 | 全部內容，另可管理帳號與檢視稽核紀錄 |
| `manage` 案件管理 | 全部內容可編輯、刪除並結案。適用隊長與副隊長 |
| `analyst` 一般分析員 | 可建立；僅能編輯、刪除自己建立的紀錄 |

---

## 組態

完整清單見 [`.env.example`](../.env.example)。常用者：

| 變數 | 預設 | 說明 |
|---|---|---|
| `BTMS_PORT` | `8080` | 監聽埠 |
| `BTMS_ADMIN_USER` | `admin` | 初始管理員帳號 |
| `BTMS_ADMIN_PASSWORD` | （隨機） | 留空則產生隨機密碼並印在日誌 |
| `BTMS_SEED_DEMO` | `false` | 首次啟動載入示範資料 |
| `BTMS_COOKIE_SECURE` | `false` | 以 HTTPS 對外時設為 `true` |
| `BTMS_TRUST_PROXY` | `false` | 置於反向代理之後時設為 `true` |
| `BTMS_SESSION_IDLE_MIN` | `60` | 閒置多久自動登出 |
| `BTMS_SESSION_MAX_HOURS` | `12` | 單次登入的絕對上限 |
| `BTMS_MAX_FAILED_LOGINS` | `5` | 連續失敗幾次後鎖定帳號 |
| `BTMS_UPLOAD_MAX_BYTES` | `10485760` | 附件單檔上限 |
| `BTMS_BACKUP_INTERVAL_HOURS` | `24` | 自動備份間隔 |
| `BTMS_AUDIT_RETENTION_DAYS` | `0` | 稽核保留天數，`0` 為永久 |

**機敏值一律由環境變數注入，不寫死在程式碼或映像檔中。**
`.env` 已列入 `.gitignore`。

---

## API

所有功能都走有文件的 API 層，供與其他系統整合。

```bash
curl http://localhost:8080/api/v1/openapi.json
```

OpenAPI 3.1 文件可直接匯入 Swagger UI、Postman 或 API Gateway。

認證採會話 Cookie；寫入類請求需於 `X-BTMS-CSRF` 標頭帶回登入時取得的 `csrfToken`。

| 端點 | 用途 |
|---|---|
| `POST /api/v1/auth/login` | 登入 |
| `GET /api/v1/bootstrap` | 一次取回整棵資料樹 |
| `GET /api/v1/dashboard` | 儀表板統計（即時彙算） |
| `GET /api/v1/collections/{集合}` | 列出紀錄 |
| `POST /api/v1/collections/{集合}` | 建立（可請系統配號） |
| `PUT /api/v1/collections/{集合}/{id}` | 更新（帶 `version` 樂觀鎖） |
| `POST /api/v1/sync` | 批次送出多筆異動 |
| `GET /api/v1/events` | 即時異動推播（SSE） |
| `POST /api/v1/attachments` | 上傳附件 |
| `GET /api/v1/audit` | 稽核查詢（需管理員） |

集合代碼：`cases`、`case_detail`、`requests`、`request_detail`、`assets`、
`asset_detail`、`sensors`、`apts`、`intels`、`hunts`、`ttp_marks`。

範例——取得所有惡意判定的案件：

```bash
curl -b cookies.txt \
  'http://localhost:8080/api/v1/collections/cases' \
  | jq '[.items[] | select(.data.verdict == "惡意行為") | .data.title]'
```

---

## 開發

```bash
npm install
npm run build:client          # 由 client/ 產生 public/ 與 dist/
BTMS_DATA_DIR=./data BTMS_SEED_DEMO=true npm run dev
```

`npm run dev` 以 `--watch` 啟動，改完伺服器程式碼會自動重啟。
改完 `client/` 底下的檔案要重跑 `npm run build:client`。

端對端測試（需要 Chrome）：

```bash
./scripts/e2e.sh tests/probe-full.js
```

會以全新資料庫啟動伺服器，用 headless Chrome 跑完整流程——登入、
強制改密、弱密碼阻擋、建立案件、確認資料寫入伺服器、稽核紀錄——並印出結果。

示範資料從 UI 原型抽出，只有一份來源：

```bash
npm run seed:extract          # 需要 ../prototype.html
```

### 維運

備份、還原、帳號救援、監控與反向代理設定見 [docs/OPERATIONS.md](OPERATIONS.md)。

### 接 SSO

認證接縫的位置與待補完的部分見 [docs/SSO.md](SSO.md)。

---

## 授權

MIT — 見 [LICENSE](../LICENSE)。

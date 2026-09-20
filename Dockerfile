# 藍隊管理系統 — 單一跨平台映像檔，內含網頁伺服器與互動式站台。
#
# 規格要求「安裝好作業系統與 Docker 即可部署」，因此映像檔不依賴任何
# 外部託管服務：資料庫是行程內的 SQLite，附件寫在掛載的資料磁碟區。
# 支援 linux/amd64 與 linux/arm64。

# ---------- 第一階段：安裝相依套件 ----------
FROM node:24-alpine AS deps

# better-sqlite3 在沒有對應預編譯檔時需自行編譯（musl 就屬於這種情形），
# 故備妥工具鏈。這些工具只留在本階段，不會進入最終映像檔。
RUN apk add --no-cache python3 make g++

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# 執行期只需要編好的 .node 檔；中間產物與 SQLite 原始碼留著只是佔空間。
# （光是 better-sqlite3 的 build 中間檔與 deps 就約 30 MB。）
RUN find node_modules -type d \( -name obj -o -name obj.target \) -prune -exec rm -rf {} + \
 && find node_modules \( -name '*.o' -o -name '*.a' -o -name '*.cc' -o -name '*.cpp' \) -delete \
 && rm -rf node_modules/better-sqlite3/deps \
           node_modules/better-sqlite3/src \
           node_modules/better-sqlite3/build/Release/test_extension.node \
           node_modules/better-sqlite3/build/*.mk \
           node_modules/better-sqlite3/build/Makefile \
 && node -e "new (require('better-sqlite3'))(':memory:').exec('create table t(a)'); \
             require('@node-rs/argon2'); console.log('原生模組精簡後仍可載入')"

# ---------- 第二階段：建置前端 ----------
FROM node:24-alpine AS build
WORKDIR /app
COPY client ./client
COPY scripts ./scripts
COPY package.json ./
RUN node scripts/build-client.mjs

# ---------- 第三階段：執行環境 ----------
FROM node:24-alpine AS runtime

# tini 負責收拾殭屍行程並正確轉送 SIGTERM，讓容器能乾淨地停止
RUN apk add --no-cache tini curl

ENV NODE_ENV=production \
    BTMS_DATA_DIR=/data \
    BTMS_HOST=0.0.0.0 \
    BTMS_PORT=8080

WORKDIR /app

# 用 COPY --chown 而非事後 RUN chown：後者會改寫每個檔案的中繼資料，
# Docker 因此把整份內容再複製成一層，平白多出數十 MB。
COPY --from=deps  --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/public       ./public
COPY --chown=node:node package.json ./
COPY --chown=node:node src  ./src
COPY --chown=node:node seed ./seed
COPY --chown=node:node docs ./docs

RUN install -d -o node -g node /data
USER node

VOLUME ["/data"]
EXPOSE 8080

# 就緒檢查會實際碰一次資料庫，比單純看行程存活更有意義
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -fsS http://127.0.0.1:${BTMS_PORT}/api/v1/readyz || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/server.js"]

LABEL org.opencontainers.image.title="藍隊管理系統 Blue Team Management System" \
      org.opencontainers.image.description="獵補案件簿、請求管理、資產管理、主機標定與情資管理五合一" \
      org.opencontainers.image.source="https://github.com/wimterdom/Blue_Team_Management_System" \
      org.opencontainers.image.licenses="MIT"

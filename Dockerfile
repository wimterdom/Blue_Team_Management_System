# 藍隊管理系統 — 單一跨平台映像檔，內含網頁伺服器與互動式站台。
#
# 規格要求「安裝好作業系統與 Docker 即可部署」，因此映像檔不依賴任何
# 外部託管服務：資料庫是行程內的 SQLite，附件寫在掛載的資料磁碟區。
# 支援 linux/amd64 與 linux/arm64。

# ---------- 第一階段：安裝相依套件 ----------
FROM node:24-bookworm-slim AS deps

# better-sqlite3 在沒有對應預編譯檔時需自行編譯，故備妥工具鏈。
# 這些工具只留在本階段，不會進入最終映像檔。
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# ---------- 第二階段：建置前端 ----------
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY client ./client
COPY scripts ./scripts
COPY package.json ./
RUN node scripts/build-client.mjs

# ---------- 第三階段：執行環境 ----------
FROM node:24-bookworm-slim AS runtime

# tini 負責收拾殭屍行程並正確轉送 SIGTERM，讓容器能乾淨地停止
RUN apt-get update && apt-get install -y --no-install-recommends tini curl \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    BTMS_DATA_DIR=/data \
    BTMS_HOST=0.0.0.0 \
    BTMS_PORT=8080

WORKDIR /app

COPY --from=deps  /app/node_modules ./node_modules
COPY --from=build /app/public       ./public
COPY package.json ./
COPY src  ./src
COPY seed ./seed
COPY docs ./docs

# 以非 root 執行。node 映像檔內建 uid/gid 1000 的 node 使用者。
RUN mkdir -p /data && chown -R node:node /data /app
USER node

VOLUME ["/data"]
EXPOSE 8080

# 就緒檢查會實際碰一次資料庫，比單純看行程存活更有意義
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -fsS http://127.0.0.1:${BTMS_PORT}/api/v1/readyz || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "src/server.js"]

LABEL org.opencontainers.image.title="藍隊管理系統 Blue Team Management System" \
      org.opencontainers.image.description="獵補案件簿、請求管理、資產管理、主機標定與情資管理五合一" \
      org.opencontainers.image.source="https://github.com/wimterdom/Blue_Team_Management_System" \
      org.opencontainers.image.licenses="MIT"

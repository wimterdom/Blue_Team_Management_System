/**
 * 藍隊管理系統 — 伺服器進入點。
 *
 * 單一行程同時提供互動式站台與 REST API，對應規格「單一跨平台 Docker
 * 映像檔即可部署、可快速重新部署、不依賴外部託管服務」的要求。
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';

import config from './config.js';
import { loggerOptions } from './lib/logger.js';
import { getDb, closeDb, backupTo } from './db/index.js';
import { runBootstrap } from './lib/bootstrap.js';
import {
  COOKIE, CSRF_HEADER, resolveSession, csrfMatches, purgeExpiredSessions,
} from './auth/session.js';
import { HttpError } from './lib/errors.js';
import { purgeAudit } from './lib/audit.js';
import { heartbeat, closeAll } from './lib/events.js';
import { buildOpenApi } from './openapi.js';
import { version } from './lib/version.js';

import authRoutes from './routes/auth.js';
import collectionRoutes from './routes/collections.js';
import userRoutes from './routes/users.js';
import attachmentRoutes from './routes/attachments.js';
import auditRoutes from './routes/audit.js';
import eventRoutes from './routes/events.js';
import healthRoutes from './routes/health.js';

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(here, '../public');

/** 寫入類請求一律要求 CSRF 標頭；GET/HEAD/OPTIONS 與登入端點除外。 */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const CSRF_EXEMPT = new Set(['/api/v1/auth/login', '/api/v1/auth/logout']);

export async function buildServer() {
  const app = Fastify({
    logger: loggerOptions,
    trustProxy: config.server.trustProxy,
    bodyLimit: config.server.bodyLimitBytes,
    disableRequestLogging: false,
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false } },
  });

  /* ---------- 安全標頭 ---------- */
  await app.register(helmet, {
    // 站台為單一自足頁面，不載入任何外部資源；字型以 data: 內嵌。
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    hsts: config.auth.cookieSecure
      ? { maxAge: 31_536_000, includeSubDomains: true }
      : false,
  });

  await app.register(cookie, { hook: 'onRequest' });

  await app.register(rateLimit, {
    global: true,
    max: config.rateLimit.max,
    timeWindow: config.rateLimit.windowMs,
    // 已登入者以帳號計、未登入者以來源 IP 計
    keyGenerator: req => req.user?.id || req.ip,
    allowList: req => req.url === '/api/v1/healthz',
    errorResponseBuilder: () => ({
      error: { code: 'rate_limited', message: '請求過於頻繁，請稍候再試' },
    }),
  });

  await app.register(multipart, {
    limits: {
      fileSize: config.uploads.maxBytes,
      files: config.uploads.maxFilesPerRequest,
      fields: 20,
      fieldSize: 1024 * 64,
    },
  });

  /* ---------- 會話解析 ---------- */
  app.decorateRequest('user', null);
  app.decorateRequest('session', null);

  app.addHook('onRequest', async req => {
    const raw = req.cookies?.[COOKIE];
    const resolved = resolveSession(raw);
    if (resolved) {
      req.user = resolved.user;
      req.session = resolved.session;
    }
  });

  /* ---------- CSRF ---------- */
  app.addHook('onRequest', async (req, reply) => {
    if (SAFE_METHODS.has(req.method)) return;
    if (!req.url.startsWith('/api/')) return;
    if (CSRF_EXEMPT.has(req.url.split('?')[0])) return;
    if (!req.session) return; // 未登入交由各路由回 401

    if (!csrfMatches(req.session.csrf, req.headers[CSRF_HEADER])) {
      return reply.code(403).send({
        error: { code: 'csrf_failed', message: 'CSRF 驗證失敗，請重新整理頁面後再試' },
      });
    }
  });

  /**
   * 未變更初始密碼前，除了「查身分」與「改密碼」以外一律擋下，
   * 確保強制改密不能被繞過。
   */
  const PW_CHANGE_ALLOWED = new Set([
    '/api/v1/auth/me', '/api/v1/auth/password', '/api/v1/auth/logout',
    '/api/v1/auth/methods', '/api/v1/healthz', '/api/v1/readyz', '/api/v1/version',
  ]);
  app.addHook('onRequest', async (req, reply) => {
    if (!req.user?.must_change_pw) return;
    if (!req.url.startsWith('/api/')) return;
    if (PW_CHANGE_ALLOWED.has(req.url.split('?')[0])) return;
    return reply.code(403).send({
      error: { code: 'password_change_required', message: '請先變更初始密碼' },
    });
  });

  /* ---------- 錯誤處理：不外洩內部細節 ---------- */
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.status).send({
        error: { code: err.code, message: err.message, details: err.details },
      });
    }
    if (err.validation) {
      return reply.code(400).send({
        error: { code: 'validation_failed', message: '請求內容不符合格式要求' },
      });
    }
    if (err.statusCode === 413 || err.code === 'FST_REQ_FILE_TOO_LARGE') {
      return reply.code(413).send({
        error: { code: 'payload_too_large', message: '上傳內容超過大小上限' },
      });
    }
    req.log.error({ err }, '未預期的錯誤');
    return reply.code(err.statusCode && err.statusCode < 500 ? err.statusCode : 500).send({
      error: { code: 'internal_error', message: '伺服器發生錯誤，請聯繫系統管理員' },
    });
  });

  /* ---------- API ---------- */
  await app.register(
    async api => {
      await api.register(healthRoutes);
      await api.register(authRoutes);
      await api.register(collectionRoutes);
      await api.register(attachmentRoutes);
      await api.register(eventRoutes);
      await api.register(userRoutes);
      await api.register(auditRoutes);

      const spec = buildOpenApi();
      api.get('/openapi.json', { config: { rateLimit: false } }, async () => spec);
    },
    { prefix: '/api/v1' },
  );

  /* ---------- 靜態站台 ---------- */
  if (existsSync(join(publicDir, 'index.html'))) {
    await app.register(fastifyStatic, {
      root: publicDir,
      index: ['index.html'],
      maxAge: '1h',
      setHeaders(res, path) {
        // 主頁面不快取，改版後使用者重新整理即生效
        if (path.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
      },
    });

    // 單頁應用：非 API 的未知路徑一律回 index.html
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) {
        return reply.code(404).send({ error: { code: 'not_found', message: '找不到此端點' } });
      }
      return reply.sendFile('index.html');
    });
  } else {
    app.log.warn('public/index.html 不存在，僅提供 API');
  }

  return app;
}

/* ---------- 週期性維護 ---------- */
function startMaintenance(app) {
  const timers = [];

  // SSE 心跳，避免反向代理切斷閒置連線
  timers.push(setInterval(heartbeat, 25_000));

  // 每小時清理逾期會話與過期稽核
  timers.push(setInterval(() => {
    try {
      const n = purgeExpiredSessions();
      const a = purgeAudit();
      if (n || a) app.log.info(`維護：清除逾期會話 ${n} 筆、過期稽核 ${a} 筆`);
    } catch (err) {
      app.log.error({ err }, '維護作業失敗');
    }
  }, 3_600_000));

  // 定期線上備份
  if (config.backup.enabled) {
    const run = async () => {
      try {
        const name = `btms-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`;
        await backupTo(join(config.paths.backups, name));
        app.log.info(`已建立備份 ${name}`);
        const { readdirSync, unlinkSync } = await import('node:fs');
        const files = readdirSync(config.paths.backups)
          .filter(f => f.startsWith('btms-') && f.endsWith('.sqlite'))
          .sort()
          .reverse();
        for (const old of files.slice(config.backup.keep)) {
          unlinkSync(join(config.paths.backups, old));
        }
      } catch (err) {
        app.log.error({ err }, '備份失敗');
      }
    };
    timers.push(setInterval(run, config.backup.intervalHours * 3_600_000));
  }

  timers.forEach(t => t.unref?.());
  return () => timers.forEach(clearInterval);
}

/* ---------- 啟動 ---------- */
async function main() {
  for (const dir of [config.paths.dataDir, config.paths.uploads, config.paths.backups]) {
    mkdirSync(dir, { recursive: true });
  }

  const app = await buildServer();

  getDb();
  const boot = await runBootstrap(app.log);

  const stopMaintenance = startMaintenance(app);

  await app.listen({ host: config.server.host, port: config.server.port });
  app.log.info(
    `藍隊管理系統 v${version} 已啟動於 http://${config.server.host}:${config.server.port}` +
    `（資料目錄 ${config.paths.dataDir}${boot.demo.loaded ? '、已載入示範資料' : ''}）`,
  );

  const shutdown = async signal => {
    app.log.info(`收到 ${signal}，開始關閉`);
    stopMaintenance();
    closeAll();
    try {
      await app.close();
    } finally {
      closeDb();
      process.exit(0);
    }
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main().catch(err => {
    console.error('啟動失敗：', err);
    process.exit(1);
  });
}

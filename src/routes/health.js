/** 健康檢查。Docker HEALTHCHECK 與外部監控都打這裡。 */
import { getDb } from '../db/index.js';
import { clientCount } from '../lib/events.js';
import { version as appVersion } from '../lib/version.js';

const started = Date.now();

export default async function healthRoutes(app) {
  /** 存活：行程還在就回 200。 */
  app.get('/healthz', async () => ({ status: 'ok', uptimeSec: Math.floor((Date.now() - started) / 1000) }));

  /** 就緒：資料庫可讀寫才算就緒。 */
  app.get('/readyz', async (req, reply) => {
    try {
      getDb().prepare('SELECT 1').get();
      return { status: 'ready' };
    } catch (err) {
      return reply.code(503).send({ status: 'not_ready', reason: err.message });
    }
  });

  /** 版本與執行狀態，供維運確認部署的是哪一版。 */
  app.get('/version', async () => ({
    name: '藍隊管理系統',
    version: appVersion,
    node: process.version,
    startedAt: new Date(started).toISOString(),
    sseClients: clientCount(),
  }));
}

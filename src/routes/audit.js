/** 稽核查詢。僅系統管理員可檢視，並提供 CSV 匯出供留存。 */
import { getDb } from '../db/index.js';
import { requirePerm } from '../middleware/rbac.js';
import { badRequest } from '../lib/errors.js';

const csvCell = v => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export default async function auditRoutes(app) {
  app.addHook('preHandler', requirePerm('admin'));

  app.get('/audit', async req => {
    const {
      user, action, collection, recordId, from, to,
      limit = '100', offset = '0',
    } = req.query || {};

    const where = [];
    const args = [];
    if (user)       { where.push('user_id = ?');    args.push(user); }
    if (action)     { where.push('action = ?');     args.push(action); }
    if (collection) { where.push('collection = ?'); args.push(collection); }
    if (recordId)   { where.push('record_id = ?');  args.push(recordId); }
    if (from)       { where.push('ts >= ?');        args.push(from); }
    if (to)         { where.push('ts <= ?');        args.push(to); }
    const sql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const db = getDb();
    const total = db.prepare(`SELECT COUNT(*) n FROM audit ${sql}`).get(...args).n;
    const n = Math.min(Number.parseInt(limit, 10) || 100, 1000);
    const off = Number.parseInt(offset, 10) || 0;
    const rows = db
      .prepare(`SELECT * FROM audit ${sql} ORDER BY id DESC LIMIT ? OFFSET ?`)
      .all(...args, n, off);

    return {
      total,
      items: rows.map(r => ({
        id: r.id, ts: r.ts, userId: r.user_id, action: r.action,
        collection: r.collection, recordId: r.record_id, summary: r.summary,
        ip: r.ip, changes: r.changes ? JSON.parse(r.changes) : null,
      })),
    };
  });

  app.get('/audit/actions', async () => ({
    actions: getDb()
      .prepare('SELECT action, COUNT(*) n FROM audit GROUP BY action ORDER BY n DESC')
      .all(),
  }));

  app.get('/audit.csv', async (req, reply) => {
    const max = Math.min(Number.parseInt(req.query?.limit ?? '5000', 10) || 5000, 50000);
    const rows = getDb().prepare('SELECT * FROM audit ORDER BY id DESC LIMIT ?').all(max);
    const head = '時間,帳號,動作,集合,紀錄,摘要,來源IP';
    const body = rows
      .map(r => [r.ts, r.user_id, r.action, r.collection, r.record_id, r.summary, r.ip]
        .map(csvCell).join(','))
      .join('\n');
    reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="btms-audit.csv"');
    // BOM 讓 Excel 正確辨識 UTF-8
    return reply.send('\uFEFF' + head + '\n' + body);
  });
}

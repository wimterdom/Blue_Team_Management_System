/**
 * 專案封存與還原。全部限系統管理員。
 *
 * 這是少數會「一次動到全部資料」的操作，因此：
 *   - 整個路由掛上 admin 檢查，不是逐支判斷
 *   - 還原前一定先 inspect 一次，讓前端能顯示「你要還原的是哪一份」
 *   - 每一步都寫入稽核
 */
import { buildArchive, inspectArchive, restoreArchive } from '../lib/archive.js';
import { requirePerm } from '../middleware/rbac.js';
import { audit, reqMeta } from '../lib/audit.js';
import { badRequest, tooLarge } from '../lib/errors.js';
import { broadcast } from '../lib/events.js';
import { getDb } from '../db/index.js';
import { getSetting } from '../lib/settings.js';
import config from '../config.js';

/** 封存檔上限。超過這個大小多半是誤傳了別的東西。 */
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;

/** 把 multipart 的單一檔案讀進記憶體。 */
async function readUpload(req) {
  if (!req.isMultipart()) throw badRequest('需以 multipart/form-data 上傳', 'not_multipart');
  const file = await req.file({ limits: { fileSize: MAX_ARCHIVE_BYTES } });
  if (!file) throw badRequest('沒有收到檔案', 'no_file');
  const buf = await file.toBuffer();
  if (file.file.truncated) {
    throw tooLarge(`封存檔超過上限 ${(MAX_ARCHIVE_BYTES / 1048576).toFixed(0)} MB`);
  }
  if (!buf.length) throw badRequest('檔案是空的', 'empty_file');
  return { buf, filename: file.filename };
}

const summarize = m => ({
  format: m.format,
  exportedAt: m.exportedAt,
  exportedBy: m.exportedBy,
  note: m.note || '',
  counts: m.counts || {},
  users: (m.users || []).length,
  attachments: (m.attachments || []).length,
});

export default async function archiveRoutes(app) {
  app.addHook('preHandler', requirePerm('admin'));

  /** 目前專案的規模，給封存畫面顯示「會封存哪些東西」。 */
  app.get('/archive/status', async () => {
    const db = getDb();
    const rows = db.prepare(
      'SELECT collection, COUNT(*) n FROM records WHERE deleted = 0 GROUP BY collection',
    ).all();
    const att = db.prepare(
      'SELECT COUNT(*) n, COALESCE(SUM(bytes),0) b FROM attachments WHERE deleted = 0',
    ).get();
    return {
      counts: Object.fromEntries(rows.map(r => [r.collection, r.n])),
      attachments: att.n,
      attachmentBytes: att.b,
      users: db.prepare('SELECT COUNT(*) n FROM users').get().n,
      lastRestore: getSetting('last_restore', null),
      uploadDir: config.paths.uploads,
    };
  });

  /** 下載封存檔。 */
  app.post('/archive', async (req, reply) => {
    const note = String(req.body?.note || '').slice(0, 500);
    const { buffer, filename, stats } = await buildArchive({ note, by: req.user.id });

    audit({
      ...reqMeta(req), action: 'archive_export',
      summary: `封存專案（${stats.files} 個檔案、${stats.attachments} 個附件、`
        + `${(stats.zipBytes / 1048576).toFixed(2)} MB）${note ? `：${note}` : ''}`,
    });

    return reply
      .header('Content-Type', 'application/zip')
      .header('Content-Length', buffer.length)
      .header('X-BTMS-Archive-Files', String(stats.files))
      .header('Content-Disposition',
        `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`)
      .send(buffer);
  });

  /** 看一眼封存檔內容，不改動任何東西。 */
  app.post('/archive/inspect', async req => {
    const { buf, filename } = await readUpload(req);
    const { manifest } = inspectArchive(buf);
    audit({
      ...reqMeta(req), action: 'archive_inspect',
      summary: `檢視封存檔 ${filename}（封存於 ${manifest.exportedAt}）`,
    });
    return { filename, ...summarize(manifest) };
  });

  /**
   * 以封存檔取代目前的專案資料。
   *
   * 需要在表單帶 confirm=REPLACE：這一步會清空目前所有業務資料，
   * 不該因為一次誤觸就發生。
   */
  app.post('/archive/restore', async req => {
    if (!req.isMultipart()) throw badRequest('需以 multipart/form-data 上傳', 'not_multipart');

    let confirm = '';
    let buf = null;
    let filename = '';
    for await (const part of req.parts({ limits: { fileSize: MAX_ARCHIVE_BYTES } })) {
      if (part.type === 'field') {
        if (part.fieldname === 'confirm') confirm = String(part.value);
        continue;
      }
      filename = part.filename;
      buf = await part.toBuffer();
      if (part.file.truncated) {
        throw tooLarge(`封存檔超過上限 ${(MAX_ARCHIVE_BYTES / 1048576).toFixed(0)} MB`);
      }
    }
    if (!buf || !buf.length) throw badRequest('沒有收到封存檔', 'no_file');
    if (confirm !== 'REPLACE') {
      throw badRequest('還原會清空目前所有業務資料，需帶 confirm=REPLACE 才會執行',
        'confirm_required');
    }

    // 先驗格式再動資料：壞檔案不該把現有資料清掉
    const { manifest } = inspectArchive(buf);

    audit({
      ...reqMeta(req), action: 'archive_restore_start',
      summary: `開始還原 ${filename}（封存於 ${manifest.exportedAt}）——目前資料將被清空`,
    });

    const result = await restoreArchive(buf, { by: req.user.id });

    const n = Object.values(result.restored).reduce((a, b) => a + b, 0);
    audit({
      ...reqMeta(req), action: 'archive_restore',
      summary: `還原完成：寫入 ${n} 筆紀錄、${result.attachments} 個附件`
        + `，清除 ${Object.values(result.cleared).reduce((a, b) => a + b, 0)} 筆舊資料`
        + (result.usersAdded.length ? `，補建 ${result.usersAdded.length} 個停用帳號` : ''),
      changes: { cleared: result.cleared, restored: result.restored },
    });

    // 其他人的畫面要立刻換成新資料，不然他們還在看已經不存在的紀錄
    broadcast('record', { collection: '*', op: 'restore' }, null);

    return { ok: true, filename, ...summarize(manifest), result };
  });
}

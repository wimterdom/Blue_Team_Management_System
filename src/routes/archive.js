/**
 * 專案封存與還原。全部限系統管理員。
 *
 * 這是少數會「一次動到全部資料」的操作，因此：
 *   - 整個路由掛上 admin 檢查，不是逐支判斷
 *   - 還原前一定先 inspect 一次，讓前端能顯示「你要還原的是哪一份」
 *   - 每一步都寫入稽核
 *
 * 封存可能有數 GB、而且會分成多片，所以上傳與下載都走磁碟，不進記憶體：
 * 上傳的分片 pipe 到暫存目錄再開啟，下載則以 stream 回應。
 */
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';

import {
  buildArchive, inspectArchive, restoreArchive,
  listStoredArchives, pruneStoredArchives, removeStoredArchive,
} from '../lib/archive.js';
import { requirePerm } from '../middleware/rbac.js';
import { audit, reqMeta } from '../lib/audit.js';
import { badRequest, notFound, tooLarge } from '../lib/errors.js';
import { broadcast } from '../lib/events.js';
import { getDb } from '../db/index.js';
import { getSetting } from '../lib/settings.js';
import config from '../config.js';

/** 單一分片的上限。比產生時的單片上限多留一些餘裕。 */
const maxPartBytes = () => config.archive.volumeBytes + 64 * 1024 * 1024;

/** 一次最多幾片。分片愈小片數愈多，這裡給得寬鬆。 */
const MAX_PARTS = 512;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * 把 multipart 裡的所有分片 pipe 到暫存目錄。
 * @returns {{dir, files:[{path, filename}], fields}}
 */
async function receiveParts(req) {
  if (!req.isMultipart()) throw badRequest('需以 multipart/form-data 上傳', 'not_multipart');

  const dir = join(config.paths.archives, '_upload', randomUUID());
  await mkdir(dir, { recursive: true });
  const files = [];
  const fields = {};

  try {
    for await (const part of req.parts({
      limits: { fileSize: maxPartBytes(), files: MAX_PARTS },
    })) {
      if (part.type === 'field') {
        fields[part.fieldname] = String(part.value);
        continue;
      }
      const path = join(dir, `part-${String(files.length).padStart(3, '0')}.zip`);
      await pipeline(part.file, createWriteStream(path));
      if (part.file.truncated) {
        throw tooLarge(`分片 ${part.filename} 超過單片上限 `
          + `${(maxPartBytes() / 1048576).toFixed(0)} MB`);
      }
      files.push({ path, filename: part.filename || basename(path) });
    }
  } catch (e) {
    await rm(dir, { recursive: true, force: true });
    throw e;
  }

  if (!files.length) {
    await rm(dir, { recursive: true, force: true });
    throw badRequest('沒有收到封存檔', 'no_file');
  }
  return { dir, files, fields };
}

const summarize = (m, parts) => ({
  format: m.format,
  exportedAt: m.exportedAt,
  exportedBy: m.exportedBy,
  note: m.note || '',
  counts: m.counts || {},
  users: (m.users || []).length,
  attachments: (m.attachments || []).length,
  parts,
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
      volumeBytes: config.archive.volumeBytes,
      keepHours: config.archive.keepHours,
      stored: await listStoredArchives(),
    };
  });

  /**
   * 產生封存。
   *
   * 不直接把 zip 回在這個回應裡：封存可能好幾 GB、還可能分成多片，
   * 一個 HTTP 回應塞不下。這裡只負責產生並回報片數，
   * 實際下載走 /archive/:id/part/:n，一片一個請求。
   */
  app.post('/archive', async req => {
    const note = String(req.body?.note || '').slice(0, 500);

    // 舊的封存佔的磁碟與資料本身一樣大，產生新的時候順手清掉過期的
    const pruned = await pruneStoredArchives();

    const { archiveId, parts, stats } = await buildArchive({ note, by: req.user.id });

    audit({
      ...reqMeta(req), action: 'archive_export',
      summary: `封存專案（${stats.files} 個檔案、${stats.attachments} 個附件、`
        + `${(stats.zipBytes / 1048576).toFixed(2)} MB`
        + (stats.parts > 1 ? `，分成 ${stats.parts} 片` : '')
        + `）${note ? `：${note}` : ''}`,
    });

    return { archiveId, parts, stats, pruned: pruned.length };
  });

  /** 下載其中一片。 */
  app.get('/archive/:id/part/:n', async (req, reply) => {
    const { id, n } = req.params;
    if (!UUID.test(id)) throw badRequest('封存代號不正確', 'bad_id');

    const list = await listStoredArchives();
    const found = list.find(a => a.archiveId === id);
    if (!found) throw notFound('找不到這份封存，可能已經過期被清除');

    const part = found.parts.find(p => String(p.part) === String(n));
    if (!part) throw notFound(`這份封存沒有第 ${n} 片`);

    const path = join(config.paths.archives, id, part.filename);
    const st = await stat(path).catch(() => null);
    if (!st) throw notFound('分片檔案不存在');

    return reply
      .header('Content-Type', 'application/zip')
      .header('Content-Length', st.size)
      .header('X-BTMS-Archive-Part', `${part.part}/${found.parts.length}`)
      .header('Content-Disposition',
        `attachment; filename*=UTF-8''${encodeURIComponent(part.filename)}`)
      .send(createReadStream(path));
  });

  /** 刪掉伺服器上存著的封存。 */
  app.delete('/archive/:id', async req => {
    const { id } = req.params;
    await removeStoredArchive(id);
    audit({ ...reqMeta(req), action: 'archive_delete', summary: `刪除伺服器上的封存 ${id}` });
    return { ok: true };
  });

  /** 看一眼封存內容，不改動任何東西。可一次帶多片。 */
  app.post('/archive/inspect', async req => {
    const { dir, files } = await receiveParts(req);
    try {
      const { manifest, parts } = await inspectArchive(files.map(f => f.path));
      audit({
        ...reqMeta(req), action: 'archive_inspect',
        summary: `檢視封存（${files.length} 片，封存於 ${manifest.exportedAt}）`,
      });
      return {
        filenames: files.map(f => f.filename),
        uploaded: files.length,
        ...summarize(manifest, parts),
      };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  /**
   * 以封存取代目前的專案資料。
   *
   * 需要在表單帶 confirm=REPLACE：這一步會清空目前所有業務資料，
   * 不該因為一次誤觸就發生。
   */
  app.post('/archive/restore', async req => {
    const { dir, files, fields } = await receiveParts(req);
    try {
      if (fields.confirm !== 'REPLACE') {
        throw badRequest('還原會清空目前所有業務資料，需帶 confirm=REPLACE 才會執行',
          'confirm_required');
      }

      // 先驗格式與分片完整性再動資料：壞檔案或缺片不該把現有資料清掉
      const paths = files.map(f => f.path);
      const { manifest, parts } = await inspectArchive(paths);

      audit({
        ...reqMeta(req), action: 'archive_restore_start',
        summary: `開始還原（${parts} 片，封存於 ${manifest.exportedAt}）——目前資料將被清空`,
      });

      const result = await restoreArchive(paths, { by: req.user.id });

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

      return { ok: true, ...summarize(manifest, parts), result };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}

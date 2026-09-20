/**
 * 附件（調查報告附圖）。
 *
 * 原型把圖片縮成 data URL 塞進 localStorage，圖一多就撞上瀏覽器儲存上限，
 * 而且別人看不到。正式版改為串流寫入資料磁碟區：
 *   - 以實際位元組嗅探型別，不信任副檔名或用戶端宣告的 Content-Type
 *   - 以 SHA-256 命名並分層存放，相同檔案自動去重
 *   - 下載一律加 Content-Disposition 與 nosniff，避免被當成網頁執行
 */
import { createWriteStream, createReadStream } from 'node:fs';
import { mkdir, unlink, stat, rename } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { createHash, randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileTypeFromFile } from 'file-type';
import config from '../config.js';
import { getDb } from '../db/index.js';
import { getRecord } from '../lib/records.js';
import { COLLECTIONS, isCollection } from '../lib/collections.js';
import { assertCanMutate } from '../middleware/rbac.js';
import { audit, reqMeta } from '../lib/audit.js';
import { badRequest, notFound, unauthorized, tooLarge, forbidden } from '../lib/errors.js';
import { nowIso } from '../lib/time.js';
import { broadcast } from '../lib/events.js';

const UPLOAD_ROOT = config.paths.uploads;

const shardPath = sha => join(sha.slice(0, 2), sha.slice(2, 4), sha);

const shape = a => ({
  id: a.id,
  collection: a.collection,
  recordId: a.record_id,
  filename: a.filename,
  mime: a.mime,
  bytes: a.bytes,
  sha256: a.sha256,
  uploadedAt: a.uploaded_at,
  uploadedBy: a.uploaded_by,
  url: `/api/v1/attachments/${a.id}`,
});

/** 確認呼叫者有權修改這筆母紀錄，才准他增刪附件。 */
function assertOwnerOfRecord(req, collection, recordId) {
  if (!isCollection(collection)) throw badRequest(`未知的集合：${collection}`);
  const cfg = COLLECTIONS[collection];
  const parent = cfg.parent || collection;
  const rec = getRecord(parent, recordId);
  if (!rec) throw notFound(`${parent}/${recordId} 不存在`);
  assertCanMutate(req.user, rec.data, `${cfg.label} ${recordId}`);
}

export default async function attachmentRoutes(app) {
  app.post('/attachments', async (req, reply) => {
    if (!req.user) throw unauthorized();
    if (!req.isMultipart()) throw badRequest('需以 multipart/form-data 上傳', 'not_multipart');

    await mkdir(UPLOAD_ROOT, { recursive: true });
    const tmpDir = join(UPLOAD_ROOT, '.tmp');
    await mkdir(tmpDir, { recursive: true });

    const saved = [];
    let collection = null;
    let recordId = null;

    for await (const part of req.parts()) {
      if (part.type === 'field') {
        if (part.fieldname === 'collection') collection = String(part.value);
        if (part.fieldname === 'recordId') recordId = String(part.value);
        continue;
      }

      if (!collection || !recordId) {
        throw badRequest('請先送出 collection 與 recordId 欄位，再送檔案', 'missing_target');
      }
      if (saved.length >= config.uploads.maxFilesPerRequest) {
        throw badRequest(`單次最多上傳 ${config.uploads.maxFilesPerRequest} 個檔案`, 'too_many_files');
      }
      assertOwnerOfRecord(req, collection, recordId);

      const tmp = join(tmpDir, randomUUID());
      const hash = createHash('sha256');
      let bytes = 0;

      part.file.on('data', chunk => {
        bytes += chunk.length;
        hash.update(chunk);
      });

      try {
        await pipeline(part.file, createWriteStream(tmp));
      } catch (err) {
        await unlink(tmp).catch(() => {});
        throw err;
      }

      // @fastify/multipart 在超過 limits.fileSize 時會標記 truncated
      if (part.file.truncated) {
        await unlink(tmp).catch(() => {});
        throw tooLarge(
          `檔案超過上限 ${(config.uploads.maxBytes / 1024 / 1024).toFixed(0)} MB`,
        );
      }

      // 以檔頭嗅探實際型別，杜絕改副檔名混入的非影像檔
      const sniffed = await fileTypeFromFile(tmp);
      const mime = sniffed?.mime || '';
      if (!config.uploads.allowedMime.includes(mime)) {
        await unlink(tmp).catch(() => {});
        throw badRequest(
          `不支援的檔案型別${mime ? `（偵測為 ${mime}）` : ''}。允許：${config.uploads.allowedMime.join('、')}`,
          'unsupported_type',
        );
      }

      const sha = hash.digest('hex');
      const rel = shardPath(sha);
      const dest = join(UPLOAD_ROOT, rel);
      await mkdir(resolve(dest, '..'), { recursive: true });

      // 相同內容只留一份實體檔案
      const exists = await stat(dest).then(() => true).catch(() => false);
      if (exists) await unlink(tmp).catch(() => {});
      else await rename(tmp, dest);

      const id = randomUUID();
      const filename = (part.filename || 'image').slice(0, 200);
      getDb().prepare(
        `INSERT INTO attachments (id, collection, record_id, filename, mime, bytes,
           sha256, rel_path, uploaded_at, uploaded_by, deleted)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      ).run(id, collection, recordId, filename, mime, bytes, sha, rel, nowIso(), req.user.id);

      saved.push(shape({
        id, collection, record_id: recordId, filename, mime, bytes,
        sha256: sha, uploaded_at: nowIso(), uploaded_by: req.user.id,
      }));
    }

    if (!saved.length) throw badRequest('沒有收到任何檔案', 'no_files');

    audit({
      ...reqMeta(req), action: 'attachment_upload', collection, recordId,
      summary: `上傳 ${saved.length} 個附件`,
    });
    broadcast('record', { collection, id: recordId, op: 'attachment' }, req.user.id);
    return reply.code(201).send({ attachments: saved });
  });

  app.get('/attachments', async req => {
    if (!req.user) throw unauthorized();
    const { collection, recordId } = req.query || {};
    if (!collection || !recordId) throw badRequest('需指定 collection 與 recordId', 'missing_query');
    const rows = getDb()
      .prepare(
        'SELECT * FROM attachments WHERE collection = ? AND record_id = ? AND deleted = 0 ORDER BY uploaded_at',
      )
      .all(collection, recordId);
    return { attachments: rows.map(shape) };
  });

  app.get('/attachments/:id', async (req, reply) => {
    if (!req.user) throw unauthorized();
    const a = getDb()
      .prepare('SELECT * FROM attachments WHERE id = ? AND deleted = 0')
      .get(req.params.id);
    if (!a) throw notFound('找不到附件');

    const full = join(UPLOAD_ROOT, a.rel_path);
    const exists = await stat(full).then(() => true).catch(() => false);
    if (!exists) throw notFound('附件實體檔案遺失');

    // 內容為使用者上傳，一律禁止瀏覽器猜測型別或當成同源文件執行
    reply
      .header('Content-Type', a.mime)
      .header('Content-Length', a.bytes)
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Security-Policy', "default-src 'none'; sandbox")
      .header('Cache-Control', 'private, max-age=86400')
      .header(
        'Content-Disposition',
        `inline; filename*=UTF-8''${encodeURIComponent(a.filename)}`,
      );
    return reply.send(createReadStream(full));
  });

  app.delete('/attachments/:id', async req => {
    if (!req.user) throw unauthorized();
    const db = getDb();
    const a = db.prepare('SELECT * FROM attachments WHERE id = ? AND deleted = 0').get(req.params.id);
    if (!a) throw notFound('找不到附件');

    if (req.user.perm === 'analyst' && a.uploaded_by !== req.user.id) {
      assertOwnerOfRecord(req, a.collection, a.record_id);
    }

    db.prepare('UPDATE attachments SET deleted = 1 WHERE id = ?').run(a.id);
    audit({
      ...reqMeta(req), action: 'attachment_delete', collection: a.collection,
      recordId: a.record_id, summary: `刪除附件 ${a.filename}`,
    });
    broadcast('record', { collection: a.collection, id: a.record_id, op: 'attachment' }, req.user.id);
    return { ok: true };
  });
}

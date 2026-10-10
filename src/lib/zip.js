/**
 * 最小可用的 ZIP 讀寫。
 *
 * 封存要產生 zip、還原要讀回 zip，兩件事都得做，所以這裡實作完整的一對。
 * 不引入外部套件：需要的只是 deflate（node:zlib 本來就有）與一組
 * 固定格式的標頭，用不著一整套壓縮程式庫。
 *
 * 支援的壓縮方法：0（store）與 8（deflate）。ZIP64 不支援——
 * 單檔或總量超過 4 GB 時會明確報錯，而不是默默產出壞檔。
 */
import { deflateRawSync, inflateRawSync, crc32 as zlibCrc32 } from 'node:zlib';

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_END = 0x06054b50;
const MAX32 = 0xFFFFFFFF;

/* node:zlib 自 20.15 起提供 crc32；舊版退回自行計算。 */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  if (typeof zlibCrc32 === 'function') return zlibCrc32(buf) >>> 0;
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/** JS Date → DOS 時間戳。1980 年以前一律夾到 1980-01-01。 */
function dosDateTime(d = new Date()) {
  const y = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/**
 * 建立 ZIP。
 *
 * @param entries {Array<{name:string, data:Buffer|string, store?:boolean}>}
 *   name 以 / 分隔；store 為真時不壓縮（已壓縮過的影像沒必要再壓一次）。
 * @param when 檔案時間戳
 */
export function createZip(entries, when = new Date()) {
  const { time, date } = dosDateTime(when);
  const parts = [];
  const central = [];
  let offset = 0;

  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const raw = Buffer.isBuffer(e.data) ? e.data : Buffer.from(String(e.data), 'utf8');
    const crc = crc32(raw);

    // 影像與已壓縮檔再 deflate 一次只是白費 CPU，通常還更大
    const store = e.store || raw.length < 64;
    const body = store ? raw : deflateRawSync(raw, { level: 6 });
    const method = store ? 0 : 8;

    if (raw.length > MAX32 || body.length > MAX32) {
      throw new Error(`${e.name} 超過 4 GB，本實作不支援 ZIP64`);
    }

    const local = Buffer.alloc(30);
    local.writeUInt32LE(SIG_LOCAL, 0);
    local.writeUInt16LE(20, 4);           // 需要的版本
    local.writeUInt16LE(0x0800, 6);       // 旗標：檔名為 UTF-8
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, nameBuf, body);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(SIG_CENTRAL, 0);
    cen.writeUInt16LE(0x031E, 4);         // 建立者版本（UNIX）
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(method, 10);
    cen.writeUInt16LE(time, 12);
    cen.writeUInt16LE(date, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(body.length, 20);
    cen.writeUInt32LE(raw.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt16LE(0, 30);             // extra
    cen.writeUInt16LE(0, 32);             // comment
    cen.writeUInt16LE(0, 34);             // disk
    cen.writeUInt16LE(0, 36);             // internal attrs
    // >>> 0：JS 的位移是 32 位元有號運算，0o100644<<16 會變成負數
    cen.writeUInt32LE((0o100644 << 16) >>> 0, 38); // external attrs：一般檔案 rw-r--r--
    cen.writeUInt32LE(offset, 42);
    central.push(cen, nameBuf);

    offset += local.length + nameBuf.length + body.length;
  }

  const centralSize = central.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(SIG_END, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...parts, ...central, end]);
}

/**
 * 讀取 ZIP。以中央目錄為準（而非逐一掃描區域標頭），
 * 因為只有中央目錄才是權威的檔案清單。
 *
 * @returns {Map<string, Buffer>} 檔名 → 內容
 */
export function readZip(buf) {
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf);

  // 從尾端往回找 End of Central Directory（最多 64 KB 的註解）
  let eocd = -1;
  const from = Math.max(0, buf.length - 22 - 0xFFFF);
  for (let i = buf.length - 22; i >= from; i -= 1) {
    if (buf.readUInt32LE(i) === SIG_END) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是有效的 ZIP 檔（找不到中央目錄）');

  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  if (p === MAX32) throw new Error('這是 ZIP64 檔案，本實作不支援');

  const out = new Map();
  for (let i = 0; i < count; i += 1) {
    if (buf.readUInt32LE(p) !== SIG_CENTRAL) throw new Error('中央目錄損毀');
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const compSize = buf.readUInt32LE(p + 20);
    const rawSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith('/')) continue;             // 目錄項目
    if (buf.readUInt32LE(localOff) !== SIG_LOCAL) throw new Error(`${name} 的區域標頭損毀`);

    // 區域標頭的檔名與 extra 長度可能與中央目錄不同，必須各自讀
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const body = buf.subarray(start, start + compSize);

    let data;
    if (method === 0) data = Buffer.from(body);
    else if (method === 8) data = inflateRawSync(body);
    else throw new Error(`${name} 使用不支援的壓縮方法 ${method}`);

    if (data.length !== rawSize) throw new Error(`${name} 解壓後長度不符`);
    if (crc32(data) !== crc) throw new Error(`${name} 的 CRC 校驗失敗，檔案可能已損毀`);

    out.set(name, data);
  }
  return out;
}

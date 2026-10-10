/**
 * ZIP 讀寫。
 *
 * 封存要產生 zip、還原要讀回 zip，兩件事都得做，所以這裡實作完整的一對。
 * 不引入外部套件：需要的只是 deflate（node:zlib 本來就有）與一組固定格式的
 * 標頭，用不著一整套壓縮程式庫。
 *
 * 兩邊都刻意不把整包放進記憶體：
 *   - ZipWriter 逐項寫進檔案，只把中央目錄留在記憶體（每項約 50 bytes）
 *   - openZip 先讀中央目錄，之後要哪一項才去 seek 讀哪一項
 * 封存可能有數 GB，整包進記憶體會直接炸掉。
 *
 * 支援的壓縮方法：0（store）與 8（deflate）。不支援 ZIP64——單片超過 4 GiB
 * 會明確報錯，而不是默默產出壞檔；真正的大封存改以分片處理（見 archive.js）。
 */
import { open } from 'node:fs/promises';
import { deflateRawSync, inflateRawSync, crc32 as zlibCrc32 } from 'node:zlib';

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_END = 0x06054b50;
const MAX32 = 0xFFFFFFFF;

/** ZIP32 的位移欄位是 32 位元，整片必須待在這個界線之內。 */
export const ZIP32_LIMIT = 0x100000000;   // 4 GiB

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

/** 每一項在中央目錄佔的位元組數，規劃分片時要算進去。 */
export const centralEntryBytes = name => 46 + Buffer.byteLength(name, 'utf8');

/** 每一項在內容區佔的位元組數（未壓縮時的上限）。 */
export const localEntryBytes = (name, rawSize) =>
  30 + Buffer.byteLength(name, 'utf8') + rawSize;

/**
 * 串流式 ZIP 產生器。逐項寫進檔案，中央目錄最後才寫。
 *
 *   const w = await ZipWriter.create('/path/part-01.zip');
 *   await w.add('README.md', buf);
 *   await w.close();
 */
export class ZipWriter {
  static async create(path, when = new Date()) {
    const fh = await open(path, 'w');
    return new ZipWriter(fh, when);
  }

  constructor(fh, when) {
    this.fh = fh;
    this.central = [];
    this.offset = 0;
    const { time, date } = dosDateTime(when);
    this.time = time;
    this.date = date;
  }

  /** 已寫入的位元組 + 收尾還要寫的中央目錄，也就是這片最後的大小。 */
  get projectedBytes() {
    return this.offset + this.central.reduce((n, c) => n + c.length, 0) + 22;
  }

  /**
   * @param name 以 / 分隔的路徑
   * @param data Buffer 或字串
   * @param store 為真時不壓縮（已壓縮過的影像再 deflate 只是白費 CPU）
   */
  async add(name, data, { store = false } = {}) {
    const nameBuf = Buffer.from(name, 'utf8');
    const raw = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
    const crc = crc32(raw);

    const noCompress = store || raw.length < 64;
    const body = noCompress ? raw : deflateRawSync(raw, { level: 6 });
    const method = noCompress ? 0 : 8;

    if (raw.length > MAX32 || body.length > MAX32) {
      throw new Error(`${name} 單檔超過 4 GiB，本實作不支援 ZIP64`);
    }
    if (this.offset + 30 + nameBuf.length + body.length >= ZIP32_LIMIT) {
      throw new Error(`寫入 ${name} 會使這一片超過 4 GiB，請縮小分片大小`);
    }

    const local = Buffer.alloc(30);
    local.writeUInt32LE(SIG_LOCAL, 0);
    local.writeUInt16LE(20, 4);           // 需要的版本
    local.writeUInt16LE(0x0800, 6);       // 旗標：檔名為 UTF-8
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(this.time, 10);
    local.writeUInt16LE(this.date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);

    await this.fh.write(local);
    await this.fh.write(nameBuf);
    if (body.length) await this.fh.write(body);

    const cen = Buffer.alloc(46 + nameBuf.length);
    cen.writeUInt32LE(SIG_CENTRAL, 0);
    cen.writeUInt16LE(0x031E, 4);         // 建立者版本（UNIX）
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(method, 10);
    cen.writeUInt16LE(this.time, 12);
    cen.writeUInt16LE(this.date, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(body.length, 20);
    cen.writeUInt32LE(raw.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    // >>> 0：JS 的位移是 32 位元有號運算，0o100644<<16 會變成負數
    cen.writeUInt32LE((0o100644 << 16) >>> 0, 38); // 一般檔案 rw-r--r--
    cen.writeUInt32LE(this.offset, 42);
    nameBuf.copy(cen, 46);
    this.central.push(cen);

    this.offset += 30 + nameBuf.length + body.length;
    return raw.length;
  }

  /** 寫出中央目錄並關檔。 @returns 這一片的總位元組 */
  async close() {
    const centralStart = this.offset;
    for (const cen of this.central) {
      await this.fh.write(cen);
      this.offset += cen.length;
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(SIG_END, 0);
    end.writeUInt16LE(this.central.length, 8);
    end.writeUInt16LE(this.central.length, 10);
    end.writeUInt32LE(this.offset - centralStart, 12);
    end.writeUInt32LE(centralStart, 16);
    await this.fh.write(end);
    this.offset += 22;
    await this.fh.close();
    return this.offset;
  }
}

/* ---------- 讀取 ---------- */

/** 讓同一套解析同時吃得下檔案與記憶體中的位元組。 */
function bufferSource(buf) {
  return {
    size: buf.length,
    async read(pos, len) { return buf.subarray(pos, pos + len); },
    async close() {},
  };
}

async function fileSource(path) {
  const fh = await open(path, 'r');
  const { size } = await fh.stat();
  return {
    size,
    async read(pos, len) {
      const b = Buffer.alloc(len);
      const { bytesRead } = await fh.read(b, 0, len, pos);
      return bytesRead === len ? b : b.subarray(0, bytesRead);
    },
    async close() { await fh.close(); },
  };
}

/**
 * 開啟 ZIP。以中央目錄為準（而非逐一掃描區域標頭），
 * 因為只有中央目錄才是權威的檔案清單。
 *
 * @param src 檔案路徑或 Buffer
 * @returns {{names:string[], has(name):boolean, read(name):Promise<Buffer>, close():Promise<void>}}
 */
export async function openZip(src) {
  const s = typeof src === 'string' ? await fileSource(src) : bufferSource(src);
  try {
    if (s.size < 22) throw new Error('不是有效的 ZIP 檔（檔案過小）');

    // 從尾端往回找 End of Central Directory（最多 64 KiB 的註解）
    const tailLen = Math.min(s.size, 22 + 0xFFFF);
    const tail = await s.read(s.size - tailLen, tailLen);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i -= 1) {
      if (tail.readUInt32LE(i) === SIG_END) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('不是有效的 ZIP 檔（找不到中央目錄）');

    const count = tail.readUInt16LE(eocd + 10);
    const cdSize = tail.readUInt32LE(eocd + 12);
    const cdStart = tail.readUInt32LE(eocd + 16);
    if (cdStart === MAX32 || cdSize === MAX32) {
      throw new Error('這是 ZIP64 檔案，本實作不支援');
    }

    const cd = await s.read(cdStart, cdSize);
    const index = new Map();
    let p = 0;
    for (let i = 0; i < count; i += 1) {
      if (cd.readUInt32LE(p) !== SIG_CENTRAL) throw new Error('中央目錄損毀');
      const e = {
        method: cd.readUInt16LE(p + 10),
        crc: cd.readUInt32LE(p + 16),
        compSize: cd.readUInt32LE(p + 20),
        rawSize: cd.readUInt32LE(p + 24),
        localOff: cd.readUInt32LE(p + 42),
      };
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const commentLen = cd.readUInt16LE(p + 32);
      const name = cd.toString('utf8', p + 46, p + 46 + nameLen);
      p += 46 + nameLen + extraLen + commentLen;
      if (!name.endsWith('/')) index.set(name, e);   // 略過目錄項目
    }

    return {
      names: [...index.keys()],
      has: name => index.has(name),
      async read(name) {
        const e = index.get(name);
        if (!e) throw new Error(`封存中沒有 ${name}`);
        // 區域標頭的檔名與 extra 長度可能與中央目錄不同，必須各自讀
        const lh = await s.read(e.localOff, 30);
        if (lh.readUInt32LE(0) !== SIG_LOCAL) throw new Error(`${name} 的區域標頭損毀`);
        const start = e.localOff + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);
        const body = await s.read(start, e.compSize);

        let data;
        if (e.method === 0) data = body;
        else if (e.method === 8) data = inflateRawSync(body);
        else throw new Error(`${name} 使用不支援的壓縮方法 ${e.method}`);

        if (data.length !== e.rawSize) throw new Error(`${name} 解壓後長度不符`);
        if (crc32(data) !== e.crc) {
          throw new Error(`${name} 的 CRC 校驗失敗，檔案可能已損毀`);
        }
        return data;
      },
      close: () => s.close(),
    };
  } catch (e) {
    await s.close();
    throw e;
  }
}

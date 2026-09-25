/* ============================================================
   匯出與匯入
   ------------------------------------------------------------
   報告 → PDF（走瀏覽器列印）
   圖表 → PNG（SVG 轉 canvas）
   資產 → XLSX（自行組出 OOXML，不依賴任何外部函式庫）
   資產 ← CSV（含範本下載與匯入前預覽）

   為何 PDF 走列印而不是產生 PDF 位元組：本系統的報告是繁體中文，
   要自行輸出 PDF 就得內嵌一套中日韓字型（完整 Noto Sans TC 約 8 MB），
   映像檔與每份輸出都會因此變大，排版品質還不如瀏覽器本身。
   交給瀏覽器列印則中文字型完美、Markdown 與圖表照常呈現、零相依。
   使用者在列印對話框選「另存為 PDF」即得檔案。
   ============================================================ */

/* ---------- 下載 ---------- */

/**
 * 交付檔案給使用者。
 *
 * 正式部署是一般網頁，`<a download>` 正常運作。
 * 展示版嵌在 Artifact 檢視器的沙箱 iframe 裡，任何由頁面發起的下載都會被
 * 擋掉且不發出錯誤，所以這裡不假裝成功——改為明說並提供可行的替代做法。
 */
async function saveBlob(blob, filename, { text = null } = {}) {
  if (STORE.mode === 'server') {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.append(a);
    a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 4000);
    toast(`已匯出 ${filename}`);
    return;
  }

  // 展示版：頁面自己發起的下載會被檢視器的沙箱擋掉，改請檢視器代為存檔。
  const dl = await viewerDownloads();
  if (dl) {
    try {
      await dl.save({ filename, data: blob });
      toast(`已匯出 ${filename}`);
      return;
    } catch (err) {
      // 使用者自己按了取消，不必再彈別的東西
      if (err && err.code === 'declined') return;
      if (err && err.code === 'rate_limited') return toast('存檔提示已開啟，請先完成再試');
      // 其餘情形（未授權、格式不支援…）退回可複製／可另存的替代做法
    }
  }
  demoDeliver(blob, filename, text);
}

/** 檢視器提供的存檔管道。取不到就是這個環境不支援，回 null。 */
let _dlNs;
async function viewerDownloads() {
  if (_dlNs !== undefined) return _dlNs;
  try {
    _dlNs = (window.claude && typeof window.claude.use === 'function'
      ? await window.claude.use('downloads')
      : null) || null;
  } catch {
    _dlNs = null;
  }
  return _dlNs;
}

/** 展示版的替代交付方式：圖片直接顯示供另存，文字提供複製。 */
function demoDeliver(blob, filename, text) {
  const isImage = blob.type.startsWith('image/');
  const body = el('div', {},
    el('p', { style: 'font-size:12.5px;line-height:1.75;color:var(--ink-2);margin-bottom:12px' },
      `這個環境無法直接存檔（${filename}）。正式部署沒有這個限制，` +
      '同一個按鈕會直接存成檔案。以下提供替代取得方式：'));

  if (isImage) {
    const img = el('img', {
      src: URL.createObjectURL(blob),
      alt: filename,
      style: 'max-width:100%;border:1px solid var(--rule);border-radius:6px;display:block',
    });
    body.append(
      el('p', { style: 'font-size:12.5px;color:var(--ink-2);margin-bottom:10px' },
        '圖片已產生於下方，可在圖上按右鍵「另存圖片」取得 PNG：'),
      img);
  } else if (text != null) {
    const ta = el('textarea', {
      class: 'inp', readonly: true, style: 'min-height:200px;font-family:var(--mono);font-size:11px',
    }, text);
    body.append(
      el('p', { style: 'font-size:12.5px;color:var(--ink-2);margin-bottom:8px' }, '內容如下，可全選複製：'),
      ta,
      el('button', {
        class: 'btn', style: 'margin-top:10px',
        onclick: () => copyText(text, '已複製到剪貼簿'),
      }, el('span', { html: svgIcon(I.copy) }), '複製到剪貼簿'));
  } else {
    body.append(
      el('p', { style: 'font-size:12.5px;color:var(--ink-2)' },
        `${filename} 是二進位檔案，無法在此顯示。請在正式部署環境操作此功能。`));
  }

  openModal(`匯出 ${filename}`, body);
}

/** 共用的簡易對話框。 */
function openModal(title, bodyNode, width = 560) {
  const modal = el('div', { class: 'modal', style: `max-width:${width}px` },
    el('div', { class: 'modal-head' },
      el('h3', {}, title),
      el('button', { class: 'iconbtn', onclick: closeOverlay, html: svgIcon(I.close), title: '關閉' })),
    el('div', { class: 'modal-body' }, bodyNode),
    el('div', { class: 'modal-foot' },
      el('span', { class: 'spacer' }),
      el('button', { class: 'btn btn-primary', onclick: closeOverlay }, '關閉')));
  const ov = $('#overlay');
  ov.innerHTML = '';
  ov.append(el('div', { class: 'scrim', onclick: e => { if (e.target === e.currentTarget) closeOverlay(); } }, modal));
  return modal;
}

const stampSlug = () => nowStamp().replace(/[: ]/g, '-');

/* ============================================================
   PDF — 瀏覽器列印
   ============================================================ */

/**
 * 以列印方式輸出一份報告。
 *
 * 畫面上的詳情頁含分頁、按鈕與可收合區塊，直接印出來並不好看，
 * 因此各系統另外提供一份「列印版」結構：標頭 + 中繼資料表 + 若干段落。
 */
function printDoc({ title, subtitle, meta = [], sections = [] }) {
  const root = el('div', { id: 'print-root' },
    el('div', { class: 'p-head' },
      el('div', { class: 'p-brand' },
        el('span', { class: 'p-mark', html: `<svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round">${I.shield}</svg>` }),
        el('span', {}, '藍隊管理系統')),
      el('div', { class: 'p-when' }, `匯出時間 ${nowStamp()}　匯出者 ${USERS[S.me]?.name || S.me}`)),

    el('h1', { class: 'p-title' }, title),
    subtitle ? el('p', { class: 'p-sub' }, subtitle) : null,

    meta.length
      ? el('table', { class: 'p-meta' },
          el('tbody', {}, ...chunk(meta, 2).map(pair => el('tr', {},
            ...pair.flatMap(([k, v]) => [el('th', {}, k), el('td', {}, v ?? '—')]),
            ...(pair.length === 1 ? [el('th', {}, ''), el('td', {}, '')] : [])))))
      : null,

    ...sections.filter(Boolean).map(sec => el('section', { class: 'p-sec' },
      el('h2', {}, sec.heading),
      typeof sec.body === 'string'
        ? el('div', { class: 'p-body', html: md(sec.body) })
        : sec.body)),

    el('div', { class: 'p-foot' },
      `本文件由藍隊管理系統於 ${nowStamp()} 匯出，內容以系統內的最新版本為準。`));

  document.body.append(root);
  document.body.dataset.printing = '1';

  const cleanup = () => {
    delete document.body.dataset.printing;
    root.remove();
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);

  try {
    window.print();
  } catch (e) {
    cleanup();
    toast('這個環境不允許開啟列印對話框');
    return;
  }
  // Safari 等瀏覽器不一定會送出 afterprint，補一個逾時清理
  setTimeout(() => { if (document.body.dataset.printing) cleanup(); }, 60000);
  toast('請在列印對話框選擇「另存為 PDF」');
}

const chunk = (arr, n) => {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

/** 把一組物件陣列排成列印用的表格。 */
function printTable(headers, rows) {
  if (!rows.length) return el('p', { class: 'p-empty' }, '（無資料）');
  return el('table', { class: 'p-tbl' },
    el('thead', {}, el('tr', {}, ...headers.map(h => el('th', {}, h)))),
    el('tbody', {}, ...rows.map(r => el('tr', {}, ...r.map(c => el('td', {}, c ?? '—'))))));
}

/* ============================================================
   PNG — SVG 轉點陣圖
   ============================================================ */

/**
 * 把畫面上的 SVG 轉成 PNG。
 *
 * 兩個必須處理的地方：
 *   1. 圖表顏色全部走 CSS 變數，SVG 一旦脫離文件就解析不到，
 *      因此先把每個節點的實際呈現色寫成行內屬性。
 *   2. 匯出的是目前的完整內容，不受畫面上縮放與平移影響，
 *      所以改用 viewBox 的原始尺寸，並清掉暫時的 transform。
 */
/**
 * 取出一份可獨立存在的 SVG。PNG 與 SVG 兩種輸出共用這一步，
 * 差別只在最後是點陣化還是直接序列化。
 *
 * 三件必須處理的事：
 *   1. 圖表顏色全部走 CSS 變數，SVG 一旦脫離文件就解析不到，
 *      因此先把每個節點的實際呈現色寫成行內屬性。
 *   2. 可平移的圖（拓撲）畫布只有視窗那麼大，內容卻延伸到視窗外，
 *      直接拿 width/height 當 viewBox 會把圖裁掉一大半。改量測內容
 *      本身的邊界框，匯出的就是完整的圖，與當下平移到哪裡無關。
 *   3. SVG 本身沒有背景。夜間模式的淺色文字落在白底上會看不見，
 *      所以補一塊與畫面同色的底。
 */
function prepareSvg(svg, { background = null } = {}) {
  const clone = svg.cloneNode(true);
  inlinePaint(svg, clone);

  const pan = svg.querySelector('[data-pan]');
  let x = 0;
  let y = 0;
  let w;
  let h;

  if (pan) {
    const pad = 24;
    let bb = null;
    try { bb = pan.getBBox(); } catch { /* 未顯示的元素量不到 */ }
    if (bb && bb.width && bb.height) {
      x = bb.x - pad; y = bb.y - pad;
      w = bb.width + pad * 2; h = bb.height + pad * 2;
    }
  }
  if (!w || !h) {
    const vb = (svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
    w = vb.length === 4 && vb[2] ? vb[2] : svg.clientWidth || 1200;
    h = vb.length === 4 && vb[3] ? vb[3] : svg.clientHeight || 700;
  }

  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  clone.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);
  clone.setAttribute('width', w);
  clone.setAttribute('height', h);
  // 匯出整張圖，不沿用畫面上的平移縮放
  clone.querySelectorAll('[data-pan]').forEach(n => n.removeAttribute('transform'));

  const bg = background
    || getComputedStyle(document.body).getPropertyValue('--surface').trim()
    || '#ffffff';

  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('x', x);
  rect.setAttribute('y', y);
  rect.setAttribute('width', w);
  rect.setAttribute('height', h);
  rect.setAttribute('fill', bg);
  clone.insertBefore(rect, clone.firstChild);

  return { clone, x, y, w, h, bg };
}

/** 把畫面上的 SVG 存成 PNG（預設 2 倍解析度）。 */
async function svgToPng(svg, filename, { scale = 2, background = null } = {}) {
  if (!svg) return toast('找不到可匯出的圖表');
  const { clone, w, h, bg } = prepareSvg(svg, { background });

  const xml = new XMLSerializer().serializeToString(clone);
  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);

  const img = new Image();
  const loaded = new Promise((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error('SVG 轉換失敗'));
  });
  img.src = url;

  try {
    await Promise.race([
      loaded,
      new Promise((_, rj) => setTimeout(() => rj(new Error('轉換逾時')), 8000)),
    ]);
  } catch (e) {
    return toast('圖表匯出失敗：' + e.message);
  }

  const cv = document.createElement('canvas');
  cv.width = Math.round(w * scale);
  cv.height = Math.round(h * scale);
  const cx = cv.getContext('2d');
  cx.fillStyle = bg;
  cx.fillRect(0, 0, cv.width, cv.height);
  cx.drawImage(img, 0, 0, cv.width, cv.height);

  const blob = await new Promise(res => cv.toBlob(res, 'image/png'));
  if (!blob) return toast('圖表匯出失敗');
  saveBlob(blob, filename);
}

/**
 * 把畫面上的 SVG 存成向量檔。
 *
 * 相對於 PNG 的好處：放大不失真、可再進編輯軟體修改、檔案通常小得多
 * （示範資料的拓撲圖：PNG 約 690 KB，SVG 約 175 KB）。
 * 文字仍是文字，可搜尋、可複製、可在向量軟體裡改。
 */
async function svgToSvgFile(svg, filename, { background = null } = {}) {
  if (!svg) return toast('找不到可匯出的圖表');
  const { clone } = prepareSvg(svg, { background });

  const xml = '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n'
    + new XMLSerializer().serializeToString(clone);
  saveBlob(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }), filename, { text: xml });
}

/** 逐節點把實際呈現的顏色與字型寫成行內屬性，脫離文件後才畫得出來。 */
function inlinePaint(src, dst) {
  const PROPS = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap',
    'stroke-linejoin', 'opacity', 'fill-opacity', 'stroke-opacity',
    'font-family', 'font-size', 'font-weight', 'text-anchor', 'letter-spacing'];
  const a = [src, ...src.querySelectorAll('*')];
  const b = [dst, ...dst.querySelectorAll('*')];
  for (let i = 0; i < a.length; i += 1) {
    if (!b[i]) break;
    const cs = getComputedStyle(a[i]);
    for (const p of PROPS) {
      const v = cs.getPropertyValue(p);
      if (v && v !== 'none' && v !== 'normal') b[i].setAttribute(p, v.trim());
    }
    b[i].removeAttribute('class');
    b[i].removeAttribute('style');
  }
}

/* ============================================================
   XLSX — 自行組出 OOXML
   ============================================================ */

const xmlEsc = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
  // XML 1.0 不接受這些控制字元，留著會讓 Excel 判定檔案毀損
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

const colName = n => {
  let s = '';
  for (let i = n; i >= 0; i = Math.floor(i / 26) - 1) s = String.fromCharCode(65 + (i % 26)) + s;
  return s;
};

/**
 * 產生 .xlsx。
 *
 * 只用到 OOXML 的最小子集：單一工作表、行內字串、粗體標題列、
 * 凍結首列與自動篩選。不引入外部函式庫——正式版的 CSP 只允許自家資源，
 * 而這點需求用不著一整套試算表程式庫。
 */
function buildXlsx({ sheetName = '工作表1', columns, rows }) {
  const nCols = columns.length;
  const cell = (r, c, value) => {
    const ref = `${colName(c)}${r}`;
    if (value === null || value === undefined || value === '') return `<c r="${ref}" s="${r === 1 ? 1 : 0}"/>`;
    if (typeof value === 'number' && Number.isFinite(value)) {
      return `<c r="${ref}" s="${r === 1 ? 1 : 0}"><v>${value}</v></c>`;
    }
    return `<c r="${ref}" t="inlineStr" s="${r === 1 ? 1 : 0}">` +
           `<is><t xml:space="preserve">${xmlEsc(value)}</t></is></c>`;
  };

  const header = `<row r="1">${columns.map((c, i) => cell(1, i, c.label)).join('')}</row>`;
  const body = rows.map((row, ri) =>
    `<row r="${ri + 2}">${columns.map((_, ci) => cell(ri + 2, ci, row[ci])).join('')}</row>`).join('');

  const dim = `A1:${colName(nCols - 1)}${rows.length + 1}`;
  const cols = `<cols>${columns.map((c, i) =>
    `<col min="${i + 1}" max="${i + 1}" width="${c.width || 18}" customWidth="1"/>`).join('')}</cols>`;

  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<dimension ref="${dim}"/>
<sheetViews><sheetView workbookViewId="0" tabSelected="1">
<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>
</sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
${cols}
<sheetData>${header}${body}</sheetData>
<autoFilter ref="${dim}"/>
</worksheet>`;

  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
</fonts>
<fills count="3">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF1F4E79"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="2">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  const files = [
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${xmlEsc(sheetName).slice(0, 31)}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`],
    ['xl/styles.xml', styles],
    ['xl/worksheets/sheet1.xml', sheet],
  ];

  return zipStore(files);
}

/* ---------- ZIP（僅 store，不壓縮） ---------- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/**
 * 組出 ZIP 容器。一律採 store（不壓縮）——xlsx 內容量很小，
 * 省下 deflate 實作換來的是完全可預期的輸出。
 */
function zipStore(files) {
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;

  const u16 = n => [n & 0xFF, (n >> 8) & 0xFF];
  const u32 = n => [n & 0xFF, (n >> 8) & 0xFF, (n >> 16) & 0xFF, (n >>> 24) & 0xFF];

  for (const [name, content] of files) {
    const nameBytes = enc.encode(name);
    const data = enc.encode(content);
    const crc = crc32(data);

    const local = new Uint8Array([
      0x50, 0x4b, 0x03, 0x04,
      ...u16(20), ...u16(0), ...u16(0),
      ...u16(0), ...u16(0),                 // 時間／日期留 0
      ...u32(crc), ...u32(data.length), ...u32(data.length),
      ...u16(nameBytes.length), ...u16(0),
    ]);
    parts.push(local, nameBytes, data);

    central.push(new Uint8Array([
      0x50, 0x4b, 0x01, 0x02,
      ...u16(20), ...u16(20), ...u16(0), ...u16(0),
      ...u16(0), ...u16(0),
      ...u32(crc), ...u32(data.length), ...u32(data.length),
      ...u16(nameBytes.length), ...u16(0), ...u16(0),
      ...u16(0), ...u16(0), ...u32(0),
      ...u32(offset),
    ]), nameBytes);

    offset += local.length + nameBytes.length + data.length;
  }

  const centralSize = central.reduce((n, p) => n + p.length, 0);
  const end = new Uint8Array([
    0x50, 0x4b, 0x05, 0x06,
    ...u16(0), ...u16(0),
    ...u16(files.length), ...u16(files.length),
    ...u32(centralSize), ...u32(offset),
    ...u16(0),
  ]);

  return new Blob([...parts, ...central, end],
    { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

/* ============================================================
   CSV
   ============================================================ */

const csvCell = v => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** 前置 BOM，Excel 開啟才不會把 UTF-8 中文判成亂碼。 */
function buildCsv(headers, rows) {
  return '﻿' + [headers, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/**
 * 解析 CSV。逐字元掃描而非 split(',')——欄位值裡的逗號、換行與
 * 跳脫雙引號都必須正確處理，資產的用途說明常常就含逗號。
 */
function parseCsv(text) {
  const src = text.replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let i = 0;

  while (i < src.length) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i += 1; continue;
      }
      field += ch; i += 1; continue;
    }
    if (ch === '"') { quoted = true; i += 1; continue; }
    if (ch === ',') { row.push(field); field = ''; i += 1; continue; }
    if (ch === '\r') { i += 1; continue; }
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; i += 1; continue; }
    field += ch; i += 1;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }

  // 略過完全空白的行
  return rows.filter(r => r.some(c => c.trim() !== ''));
}

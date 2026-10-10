/**
 * 專案封存與還原。
 *
 * 封存產生一組 zip，內含兩種東西：
 *
 *   1. Markdown 樹狀目錄 — 給人看的。每個系統一個資料夾，每筆紀錄一份
 *      index.md，附圖與附件放在該筆紀錄底下的 attachments/。不需要本系統
 *      也讀得懂，可以直接丟進 Git、知識庫或燒成光碟存查。
 *
 *   2. manifest.json — 給機器看的。還原時讀的是這一份。
 *
 * 為什麼不直接從 Markdown 還原：Markdown 是排版過的呈現，把它反解回結構化
 * 欄位既脆弱又會掉資料（例如判定結果與嚴重度在文中只是表格的一格文字）。
 * 兩份並存，各司其職——這點在封存的 README.md 裡也對使用者講明白。
 *
 * ## 分片
 *
 * ZIP32 的位移欄位是 32 位元，一個 zip 到不了 4 GiB；真要塞下去也搬不動。
 * 超過單片上限時就分成多片，而且**每一片都是獨立、完整、任何工具都打得開的
 * zip**，不是 PKWARE 的 spanned archive（.z01/.z02 那種，單一檔案會跨片，
 * 工具支援也參差）。代價是要把所有片解壓到同一個資料夾才看得到完整的樹。
 *
 * 分片是先規劃再寫：第一階段把 Markdown 產出來、把附件 stat 一遍拿到大小，
 * 據此決定每一項落在哪一片；第二階段才真的寫檔，附件到這時候才讀進來。
 * 全部放進記憶體再 concat 的話，幾 GB 的封存當場就炸了。
 *
 * 文字在前、附件在後，所以**第 1 片必定裝著全部的 Markdown 與 manifest**，
 * 光拿第 1 片就能讀完所有報告內容（只是圖多半連不到）。附件則從第 1 片的
 * 剩餘空間開始依序往後填，不留空位。
 */
import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir, stat, readdir, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import config from '../config.js';
import { getDb } from '../db/index.js';
import { COLLECTIONS } from './collections.js';
import { listRecords } from './records.js';
import { allSettings, setSetting } from './settings.js';
import { nowIso, toDisplay } from './time.js';
import { ZipWriter, openZip, centralEntryBytes, localEntryBytes } from './zip.js';
import { badRequest } from './errors.js';

export const ARCHIVE_FORMAT = 'btms-archive/v1';

/** 每一片都帶一份，用來辨識「這些片是不是同一次封存、湊齊了沒」。 */
export const PART_FILE = 'PART.json';

/* ---------- 共用小工具 ---------- */

/** 檔名安全化：去掉路徑分隔與控制字元，保留中文。 */
const safeName = s => String(s || '')
  .replace(/[\u0000-\u001F\u007F]/g, '')
  .replace(/[/\\:*?"<>|]/g, '_')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, 120) || 'untitled';

const userName = (users, id) => users[id]?.name ? `${users[id].name}（${id}）` : (id || '—');

const esc = v => String(v ?? '').replace(/\|/g, '\\|').replace(/\n/g, '<br>');

/** 兩欄的中繼資料表。 */
function metaTable(rows) {
  const out = ['| 欄位 | 內容 |', '|---|---|'];
  for (const [k, v] of rows) out.push(`| ${k} | ${esc(v ?? '—')} |`);
  return out.join('\n');
}

/** 一般表格。無資料時給一句話，而不是留下空殼。 */
function table(headers, rows, emptyText = '（無）') {
  if (!rows.length) return `_${emptyText}_`;
  return [
    `| ${headers.join(' | ')} |`,
    `|${headers.map(() => '---').join('|')}|`,
    ...rows.map(r => `| ${r.map(esc).join(' | ')} |`),
  ].join('\n');
}

const section = (title, body) => `\n## ${title}\n\n${body || '_（未填寫）_'}\n`;

/* ---------- 封存 ---------- */

/**
 * 組出整個封存。
 * @returns {{buffer: Buffer, filename: string, stats: object}}
 */
export async function buildArchive({
  note = '', by = null,
  volumeBytes = config.archive.volumeBytes,
  outDir = config.paths.archives,
} = {}) {
  const db = getDb();
  const when = new Date();
  const stamp = toDisplay(when.toISOString()).replace(/[: ]/g, '-');

  const users = Object.fromEntries(
    db.prepare('SELECT id, name, role, perm, disabled FROM users ORDER BY id').all()
      .map(u => [u.id, u]),
  );

  const data = {};
  for (const name of Object.keys(COLLECTIONS)) {
    data[name] = listRecords(name);
  }

  const attachments = db
    .prepare('SELECT * FROM attachments WHERE deleted = 0 ORDER BY uploaded_at')
    .all();

  /**
   * 計畫項目。text 是已經在記憶體裡的內容（Markdown、JSON，都很小）；
   * file 是磁碟上的附件，直到真的要寫入那一片時才讀進來。
   */
  const entries = [];
  const addText = (name, text) => entries.push({
    name, text, size: Buffer.byteLength(text, 'utf8'), store: false,
  });
  /** 附件另外收，最後才接在文字之後——第 1 片因此裝得下全部的 Markdown。 */
  const attachEntries = [];
  const stats = { attachments: 0, attachmentBytes: 0, missingFiles: [] };
  for (const [k, v] of Object.entries(data)) stats[k] = v.length;

  /* 每筆紀錄的附件：放進該筆紀錄的資料夾，檔名衝突時加序號 */
  const attByRecord = new Map();
  for (const a of attachments) {
    const key = `${a.collection}/${a.record_id}`;
    if (!attByRecord.has(key)) attByRecord.set(key, []);
    attByRecord.get(key).push(a);
  }

  async function attachFiles(dir, collection, recordId) {
    const list = attByRecord.get(`${collection}/${recordId}`) || [];
    const used = new Set();
    const out = [];
    for (const a of list) {
      const full = join(config.paths.uploads, a.rel_path);
      // 計畫階段只要大小，不讀內容——附件才是封存的體積來源
      let size = null;
      try {
        size = (await stat(full)).size;
      } catch {
        stats.missingFiles.push(`${a.collection}/${a.record_id}/${a.filename}`);
      }
      let fname = safeName(a.filename);
      let n = 1;
      while (used.has(fname)) {
        const dot = fname.lastIndexOf('.');
        fname = dot > 0 ? `${fname.slice(0, dot)}-${n}${fname.slice(dot)}` : `${fname}-${n}`;
        n += 1;
      }
      used.add(fname);
      const path = `${dir}/attachments/${fname}`;
      if (size != null) {
        // 影像已經壓過，再 deflate 一次只是白費 CPU
        attachEntries.push({ name: path, file: full, size, store: true });
        stats.attachments += 1;
        stats.attachmentBytes += size;
        // 直接標在原物件上，稍後組 manifest 時才讀得到——
        // 標在複本上的話 manifest 會以為沒有任何附件。
        a.archivePath = path;
      }
      a.fileName = fname;
      out.push(a);
    }
    return out;
  }

  const idx = v => String(v).padStart(2, '0');
  const DIRS = {
    cases: `${idx(1)}-獵補案件簿`,
    requests: `${idx(2)}-請求管理系統`,
    assets: `${idx(3)}-資產管理系統`,
    topo: `${idx(4)}-主機標定系統`,
    intel: `${idx(5)}-情資管理系統`,
  };

  /* ===== 01 獵補案件簿 ===== */
  {
    const dir = DIRS.cases;
    const rows = [];
    for (const rec of data.cases) {
      const c = rec.data;
      const d = (data.case_detail.find(x => x.id === c.id) || {}).data || {};
      const folder = `${dir}/${safeName(c.id)}`;
      const files = await attachFiles(folder, 'cases', c.id);

      const md = [
        `# ${c.title || c.id}`,
        '',
        metaTable([
          ['案件編號', c.id], ['嚴重度', c.sev], ['調查結果', c.verdict],
          ['調查進度', c.progress], ['事件類型', c.cat],
          ['分析員', userName(users, c.analyst)],
          ['案發時間', (c.occur || []).join(' — ')],
          ['報告建立', c.created], ['主機名稱', c.host], ['主機使用者', c.hostUser],
          ['標籤', (c.tags || []).join('、')],
        ]),
        section('結論', d.conclusion),
        section('案件始末', d.narrative),
        d.mitigation ? section('處置與緩解建議', d.mitigation) : '',
        section('連線紀錄', table(
          ['來源 IP', '來源埠', '目的 IP', '目的埠', '目的主機', '備註'],
          (c.conns || []).map(n => [n.src, n.srcPort, n.dst, n.dstPort, n.dstHost, n.note]))),
        section('IOC', table(['類型', '指標值'],
          (d.iocs || []).map(o => [o.t, o.v]))),
        section('MITRE ATT&CK TTP', table(['戰術', '技術編號', '技術名稱'],
          (d.ttps || []).map(t => [t.tac, t.id, t.name]))),
        section('附圖', files.length
          ? files.map(f => `### ${f.filename}\n\n![${f.filename}](attachments/${f.fileName})`).join('\n\n')
            + ((d.shots || []).some(s => !s.url)
              ? `\n\n_另有 ${(d.shots || []).filter(s => !s.url).length} 張附圖僅有說明、無實際檔案。_` : '')
          : '_（無附圖）_'),
        section('異動歷程', table(['時間', '人員', '職務', '動作'],
          (d.audit || []).map(a => [a.when, a.who, a.role, a.act]))),
      ].join('\n');

      addText(`${folder}/index.md`, md);
      rows.push([c.id, c.title, c.sev, c.verdict, c.progress,
        userName(users, c.analyst), (c.occur || [])[0] || c.created]);
    }
    addText(`${dir}/README.md`,
      `# 獵補案件簿\n\n共 ${data.cases.length} 份調查報告。\n\n`
      + table(['編號', '標題', '嚴重度', '結果', '進度', '分析員', '案發時間'], rows,
        '（此系統尚無資料）'));
  }

  /* ===== 02 請求管理系統 ===== */
  {
    const dir = DIRS.requests;
    const rows = [];
    for (const rec of data.requests) {
      const r = rec.data;
      const d = (data.request_detail.find(x => x.id === r.id) || {}).data || {};
      const folder = `${dir}/${safeName(r.id)}`;
      const files = await attachFiles(folder, 'requests', r.id);

      const md = [
        `# ${r.subject || r.id}`,
        '',
        metaTable([
          ['請求編號', r.id], ['類型', r.type], ['優先級', r.prio],
          ['處理進度', r.progress], ['申請人', userName(users, r.applicant)],
          ['申請單位', r.unit], ['提出時間', r.created], ['回覆時間', r.repliedAt],
        ]),
        section('請求內容', r.desc),
        section('回覆', r.reply),
        files.length
          ? section('附圖', files.map(f => `![${f.filename}](attachments/${f.fileName})`).join('\n\n'))
          : '',
        section('異動歷程', table(['時間', '人員', '職務', '動作'],
          (d.audit || []).map(a => [a.when, a.who, a.role, a.act]))),
      ].join('\n');

      addText(`${folder}/index.md`, md);
      rows.push([r.id, r.type, r.subject, r.prio, r.progress,
        userName(users, r.applicant), r.created]);
    }
    addText(`${dir}/README.md`,
      `# 請求管理系統\n\n共 ${data.requests.length} 張請求表。\n\n`
        + table(['編號', '類型', '主旨', '優先級', '進度', '申請人', '提出時間'], rows,
          '（此系統尚無資料）'));
  }

  /* ===== 03 資產管理系統 ===== */
  {
    const dir = DIRS.assets;
    const rows = [];
    for (const rec of data.assets) {
      const a = rec.data;
      const d = (data.asset_detail.find(x => x.id === a.id) || {}).data || {};
      const folder = `${dir}/${safeName(a.id)}`;
      const files = await attachFiles(folder, 'assets', a.id);

      // 組態檔與 log 是純文字，直接另存成檔案比塞進 Markdown 好讀
      const docs = (d.files || []).filter(f => f.text != null);
      for (const f of docs) {
        addText(`${folder}/files/${safeName(f.name)}`, f.text);
      }

      const md = [
        `# ${a.hostname || a.id}`,
        '',
        metaTable([
          ['資產編號', a.id], ['主機名稱', a.hostname], ['設備型號', a.device],
          ['製造商', a.vendor], ['作業系統', a.os], ['重要性', a.importance],
          ['IPv4', a.ip], ['網段', a.cidr], ['IPv6', a.ipv6], ['MAC', a.mac],
          ['上層網通設備', a.uplink], ['所屬 VLAN', a.vlan], ['放置地點', a.location],
          ['負責分析員', userName(users, a.analyst)], ['建檔時間', a.created],
          ['標籤', (a.tags || []).join('、')],
        ]),
        section('用途說明', d.purpose),
        section('服務與開放埠', table(['服務', '埠', '版本'],
          (d.services || []).map(s => [s.name, s.port, s.version]))),
        section('已知版本漏洞', table(['CVE', '元件', '嚴重度', '立即修補', '說明'],
          (d.vulns || []).map(v => [v.cve, v.component, v.severity, v.urgent ? '是' : '否', v.note]))),
        docs.length
          ? section('附件', docs.map(f => `- [${f.name}](files/${safeName(f.name)})（${f.kind}，${f.size} bytes）`).join('\n'))
          : '',
        files.length
          ? section('附圖', files.map(f => `![${f.filename}](attachments/${f.fileName})`).join('\n\n'))
          : '',
        section('異動歷程', table(['時間', '人員', '職務', '動作'],
          (d.audit || []).map(x => [x.when, x.who, x.role, x.act]))),
      ].join('\n');

      addText(`${folder}/index.md`, md);
      rows.push([a.id, a.hostname, a.ip, a.os, a.importance, a.vendor,
        userName(users, a.analyst)]);
    }
    addText(`${dir}/README.md`,
      `# 資產管理系統\n\n共 ${data.assets.length} 項資產。\n\n`
        + table(['編號', '主機名稱', 'IPv4', '作業系統', '重要性', '製造商', '負責人'], rows,
          '（此系統尚無資料）'));
  }

  /* ===== 04 主機標定系統 ===== */
  {
    const dir = DIRS.topo;
    const sensors = data.sensors.map(r => r.data);
    const assetsById = Object.fromEntries(data.assets.map(r => [r.data.id, r.data]));
    const md = [
      '# 主機標定系統',
      '',
      '拓撲圖由資產管理系統的資料即時計算，不另存一份座標——',
      '還原後會依當時的資產重新畫出。此處封存的是感測器佈署位置。',
      '',
      '## 感測器佈署',
      '',
      table(['編號', '佈署目標', 'Port', '對接裝置', '角色', '佈署時間'],
        sensors.map(s => [s.label, s.key, s.portName, s.portTo, s.portRole, s.at]),
        '（尚未佈署任何感測器）'),
      '',
      '## 網路關係（由資產的「上層網通設備」欄位推得）',
      '',
      table(['主機', 'IPv4', 'VLAN', '上層設備'],
        Object.values(assetsById).map(a => [a.hostname, a.ip, a.vlan, a.uplink]),
        '（無資產資料）'),
    ].join('\n');
    addText(`${dir}/README.md`, md);
  }

  /* ===== 05 情資管理系統 ===== */
  {
    const dir = DIRS.intel;
    for (const rec of data.apts) {
      const a = rec.data;
      addText(`${dir}/APT 組織報告/${safeName(a.id)}.md`,
        [`# ${a.name}`, '', metaTable([
          ['組織編號', a.id], ['組織名稱', a.name], ['類型', a.type],
          ['國家／地區', a.country], ['鎖定目標', (a.targets || []).join('、')],
          ['TTP 數', (a.ttps || []).length],
        ]), a.note ? section('組織描述', a.note) : '',
        section('使用的技術', table(['技術編號'], (a.ttps || []).map(t => [t])))].join('\n'));
    }
    for (const rec of data.intels) {
      const x = rec.data;
      addText(`${dir}/情資報告/${safeName(x.id)}.md`,
        [`# ${x.source || x.id}`, '', metaTable([
          ['報告編號', x.id], ['情資類型', x.kind], ['情資來源', x.source],
          ['建立時間', x.created], ['分析員', userName(users, x.analyst)],
        ]), section('情資內容', x.content), section('分析結果', x.analysis),
        section('IOC', table(['類型', '指標值', '備註'],
          (x.iocs || []).map(o => [o.t, o.v, o.n]))),
        section('TTP', table(['技術編號'], (x.ttps || []).map(t => [t])))].join('\n'));
    }
    for (const rec of data.hunts) {
      const h = rec.data;
      const FIELDS = [['hypothesis', 'Hypothesis 假說'], ['analytics', 'Abstract Analytics 抽象分析法'],
        ['dataReq', 'Determine Data Requirements 所需資料'], ['filter', 'Filter 篩選條件'],
        ['gaps', 'Find and Mitigate Data Collection Gaps 資料缺口'],
        ['implement', 'Implement and Test Analytics 實作與驗證']];
      addText(`${dir}/威脅獵補計畫/${safeName(h.id)}.md`,
        [`# ${h.id}`, '', metaTable([
          ['計畫編號', h.id], ['狀態', h.status], ['建立時間', h.created],
          ['分析員', userName(users, h.analyst)],
          ['鎖定 TTP', (h.ttps || []).join('、')],
          ['關聯案件', (h.cases || []).map(c => c.id || c).join('、')],
        ]), ...FIELDS.map(([k, label]) => section(label, h[k])),
        section('調查結果', table(['案件', '結果', '補充'],
          (h.results || []).map(r => [r.caseId, r.verdict || '', r.note || '']))),
        h.resultNote ? section('調查結果補充', h.resultNote) : ''].join('\n'));
    }
    addText(`${dir}/TTP 標註.md`,
      `# 分析員 TTP 標註\n\n`
        + table(['技術編號', '註記', '標註人', '時間'],
          data.ttp_marks.map(r => [r.data.ttp, r.data.note, userName(users, r.data.by), r.data.at]),
          '（無手動標註）'));
    addText(`${dir}/README.md`,
      [`# 情資管理系統`, '',
        `- APT 組織報告 ${data.apts.length} 份`,
        `- 情資報告 ${data.intels.length} 份`,
        `- 威脅獵補計畫 ${data.hunts.length} 份`,
        `- 分析員 TTP 標註 ${data.ttp_marks.length} 項`].join('\n'));
  }

  /* ===== 帳號清單 ===== */
  addText('帳號清單.md',
    ['# 帳號清單', '',
      '封存**不含任何密碼或密碼雜湊**。還原時，archive 中有但目前系統沒有的帳號',
      '會以「停用且無密碼」的狀態補建，只為了讓報告的作者資訊對得上；',
      '要讓這些人能登入，需由管理員另行啟用並設定密碼。', '',
      table(['帳號', '姓名', '職務', '權限', '狀態'],
        Object.values(users).map(u => [u.id, u.name, u.role, u.perm,
          u.disabled ? '停用' : '啟用'])),
    ].join('\n'));

  /* ===== manifest（還原用） ===== */
  const manifest = {
    format: ARCHIVE_FORMAT,
    exportedAt: nowIso(),
    exportedBy: by,
    note,
    counts: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.length])),
    users: Object.values(users).map(u => ({
      id: u.id, name: u.name, role: u.role, perm: u.perm, disabled: Boolean(u.disabled),
    })),
    settings: allSettings(),
    records: Object.fromEntries(Object.entries(data).map(([k, v]) =>
      [k, v.map(r => ({ id: r.id, data: r.data, createdAt: r.createdAt, createdBy: r.createdBy }))])),
    attachments: attachments
      .filter(a => a.archivePath)   // 找不到實體檔案的只留在 README 的警告裡
      .map(a => ({
        id: a.id, collection: a.collection, recordId: a.record_id,
        filename: a.filename, mime: a.mime, bytes: a.bytes, sha256: a.sha256,
        uploadedAt: a.uploaded_at, uploadedBy: a.uploaded_by,
        archivePath: a.archivePath,   // 還原時由這個路徑把檔案取回來
      })),
  };
  addText('manifest.json', JSON.stringify(manifest, null, 2));

  /* ===== 封存說明 =====
     片數要等規劃完才知道，所以這裡做成函式，規劃時先以保守長度佔位。 */
  const readmeText = parts => [
      '# 藍隊管理系統 — 專案封存',
      '',
      metaTable([
        ['封存時間', toDisplay(manifest.exportedAt)],
        ['封存者', manifest.exportedBy ? userName(users, manifest.exportedBy) : '—'],
        ['格式', ARCHIVE_FORMAT],
        ['備註', note || '—'],
      ]),
      '',
      '## 內容',
      '',
      table(['資料夾', '內容', '筆數'], [
        [DIRS.cases, '調查報告，每份一個資料夾，含附圖', data.cases.length],
        [DIRS.requests, 'RFI 與 CR 請求表', data.requests.length],
        [DIRS.assets, '資產清冊，含組態檔與 log 附件', data.assets.length],
        [DIRS.topo, '感測器佈署與網路關係', data.sensors.length],
        [DIRS.intel, 'APT 報告、情資報告、獵補計畫、TTP 標註',
          data.apts.length + data.intels.length + data.hunts.length],
        ['帳號清單.md', '帳號與權限（不含密碼）', manifest.users.length],
        ['manifest.json', '還原用的結構化資料', '—'],
      ]),
      '',
      `附件共 ${stats.attachments} 個檔案、${(stats.attachmentBytes / 1048576).toFixed(2)} MB。`,
      stats.missingFiles.length
        ? `\n> ⚠ 有 ${stats.missingFiles.length} 個附件在資料磁碟區中找不到實體檔案，`
          + '封存中只保留其中繼資料：\n'
          + stats.missingFiles.map(f => `> - ${f}`).join('\n')
        : '',
      '',
      '## 兩種格式，各有用途',
      '',
      '- **Markdown 樹狀目錄**是給人看的。不需要本系統也讀得懂，',
      '  可直接丟進 Git、知識庫或燒成光碟存查。',
      '- **`manifest.json`** 是給機器看的，**還原時讀的是這一份**。',
      '',
      '不從 Markdown 還原，是因為它是排版過的呈現，反解回結構化欄位既脆弱又會',
      '掉資料。因此**手動修改 Markdown 不會影響還原結果**——要改內容請改',
      '`manifest.json`，或還原後在系統裡改。',
      '',
      '## 還原',
      '',
      '以系統管理員身分登入 → 帳號選單 →「專案封存」→ 匯入封存檔。',
      '',
      '還原會**清空目前所有業務資料**再寫入本封存的內容，所以系統會先問你',
      '要不要把目前的專案也封存一份。帳號不會被清除：封存中有而目前沒有的帳號',
      '會以「停用且無密碼」補建，只為了讓報告的作者資訊對得上。',
      parts > 1 ? [
        '',
        `## 這份封存分成 ${parts} 片`,
        '',
        `資料量超過單片上限，因此切成 ${parts} 個 zip。`,
        '**每一片都是獨立、完整的 zip**，任何解壓工具都打得開，',
        '不是需要特殊工具的分割壓縮檔。',
        '',
        '- 第 1 片裝著全部的 Markdown 與 `manifest.json`。',
        '  只拿第 1 片就能讀完所有報告內容，只是圖多半連不到。',
        `- 附件依序填進第 1 片的剩餘空間，再接著放到第 2～${parts} 片。`,
        '- 要看完整的樹（含圖），把**所有片解壓到同一個資料夾**，讓它們合併。',
        '- 還原時必須把**所有片一起選取**上傳，缺一片系統會明確告訴你缺哪一片。',
      ].join('\n') : '',
    ].filter(Boolean).join('\n');

  /* ===== 規劃分片 =====
     用未壓縮大小估算，壓縮只會更小，所以實際不會超過上限。 */
  const README_RESERVE = Buffer.byteLength(readmeText(999), 'utf8') + 1024;
  const plan = planParts(
    [{ name: 'README.md', text: '', size: README_RESERVE, store: false },
      ...entries.filter(e => e.name !== 'README.md'),
      ...attachEntries],
    volumeBytes,
  );

  /* ===== 寫出每一片 ===== */
  const archiveId = randomUUID();
  const dir = join(outDir, archiveId);
  await mkdir(dir, { recursive: true });

  const readme = readmeText(plan.length);
  const pad = n => String(n).padStart(2, '0');
  const partName = n => plan.length === 1
    ? `藍隊管理系統-專案封存-${stamp}.zip`
    : `藍隊管理系統-專案封存-${stamp}-第${pad(n)}片-共${pad(plan.length)}片.zip`;

  const written = [];
  for (let i = 0; i < plan.length; i += 1) {
    const filename = partName(i + 1);
    const path = join(dir, filename);
    const w = await ZipWriter.create(path, when);
    await w.add(PART_FILE, JSON.stringify({
      format: ARCHIVE_FORMAT, archiveId, part: i + 1, parts: plan.length,
      createdAt: when.toISOString(),
    }, null, 2));
    for (const e of plan[i]) {
      if (e.name === 'README.md') { await w.add('README.md', readme); continue; }
      // 附件到這一刻才讀進記憶體，而且一次只有一個
      const body = e.file ? await readFile(e.file) : e.text;
      await w.add(e.name, body, { store: e.store });
    }
    const bytes = await w.close();
    written.push({ part: i + 1, filename, bytes, files: plan[i].length + 1 });
  }

  return {
    archiveId,
    dir,
    parts: written,
    filename: partName(1),
    stats: {
      ...stats,
      files: entries.length + attachEntries.length + plan.length,
      parts: plan.length,
      zipBytes: written.reduce((n, p) => n + p.bytes, 0),
    },
    manifest,
  };
}

/**
 * 把項目排進分片。每一片都要留下 PART.json 與中央目錄的空間。
 *
 * 單一項目若本身就超過上限，仍然自成一片——與其拒絕封存，不如產出一片
 * 偏大的檔案；真的超過 ZIP32 的 4 GiB 硬界線時，ZipWriter 會擋下來。
 */
function planParts(items, volumeBytes) {
  const RESERVE = 4096;              // PART.json 與 EOCD
  const parts = [[]];
  let used = RESERVE;
  for (const e of items) {
    const cost = localEntryBytes(e.name, e.size) + centralEntryBytes(e.name);
    if (used + cost > volumeBytes && parts[parts.length - 1].length) {
      parts.push([]);
      used = RESERVE;
    }
    parts[parts.length - 1].push(e);
    used += cost;
  }
  return parts;
}

/* ---------- 伺服器上已產生的封存 ---------- */

/** 列出放在伺服器上的封存，供重複下載。 */
export async function listStoredArchives(outDir = config.paths.archives) {
  let ids = [];
  try {
    ids = await readdir(outDir);
  } catch {
    return [];
  }
  const out = [];
  for (const id of ids) {
    try {
      const files = (await readdir(join(outDir, id))).filter(f => f.endsWith('.zip')).sort();
      if (!files.length) continue;
      const parts = [];
      for (const f of files) {
        const st = await stat(join(outDir, id, f));
        parts.push({ filename: f, bytes: st.size });
      }
      const st = await stat(join(outDir, id));
      out.push({
        archiveId: id,
        createdAt: st.mtime.toISOString(),
        parts: parts.map((p, i) => ({ part: i + 1, ...p })),
        bytes: parts.reduce((n, p) => n + p.bytes, 0),
      });
    } catch { /* 目錄正在被清掉，略過 */ }
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** 清掉過期的封存。封存佔的磁碟與資料本身一樣大，不能無限累積。 */
export async function pruneStoredArchives(
  { keepHours = config.archive.keepHours, outDir = config.paths.archives } = {},
) {
  const cutoff = Date.now() - keepHours * 3600_000;
  const removed = [];
  for (const a of await listStoredArchives(outDir)) {
    if (Date.parse(a.createdAt) < cutoff) {
      await rm(join(outDir, a.archiveId), { recursive: true, force: true });
      removed.push(a.archiveId);
    }
  }
  return removed;
}

export async function removeStoredArchive(id, outDir = config.paths.archives) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw badRequest('封存代號不正確', 'bad_id');
  await rm(join(outDir, id), { recursive: true, force: true });
}

/* ---------- 還原 ---------- */

/**
 * 開啟一組分片，檢查它們湊不湊得齊。
 *
 * 使用者可能少選一片、多選了別次封存的片、或選到重複的同一片，
 * 這三種都要在動資料之前講清楚是哪一種。
 *
 * @param paths 每一片在磁碟上的路徑
 * @returns {{manifest, readers, find(name), close()}}
 */
export async function openArchiveSet(paths) {
  const readers = [];
  const close = async () => { for (const r of readers) await r.zip.close().catch(() => {}); };

  try {
    for (const path of paths) {
      let zip;
      try {
        zip = await openZip(path);
      } catch (e) {
        throw badRequest(`無法讀取封存檔：${e.message}`, 'bad_archive');
      }
      let info = null;
      if (zip.has(PART_FILE)) {
        try {
          info = JSON.parse((await zip.read(PART_FILE)).toString('utf8'));
        } catch { /* 下面會當成缺少 PART.json 處理 */ }
      }
      readers.push({ path, zip, info });
    }

    if (!readers.length) throw badRequest('沒有收到封存檔', 'no_file');

    const noInfo = readers.filter(r => !r.info);
    if (noInfo.length) {
      throw badRequest(
        `有 ${noInfo.length} 個檔案缺少 ${PART_FILE}，可能不是本系統產生的封存檔`,
        'no_part_info',
      );
    }

    const bad = readers.find(r => r.info.format !== ARCHIVE_FORMAT);
    if (bad) {
      throw badRequest(`不支援的封存格式：${bad.info.format || '（未標示）'}`, 'bad_format');
    }

    // 混到別次封存的片，比缺片更危險——會還原出拼湊的資料
    const ids = [...new Set(readers.map(r => r.info.archiveId))];
    if (ids.length > 1) {
      throw badRequest(
        `這些檔案來自 ${ids.length} 次不同的封存，不能混在一起還原。`
        + '請確認選到的是同一次封存產生的所有分片。',
        'mixed_archives',
      );
    }

    const total = readers[0].info.parts;
    const seen = new Map();
    for (const r of readers) {
      if (seen.has(r.info.part)) {
        throw badRequest(`第 ${r.info.part} 片重複選取了兩次`, 'duplicate_part');
      }
      seen.set(r.info.part, r);
    }
    const missing = [];
    for (let n = 1; n <= total; n += 1) if (!seen.has(n)) missing.push(n);
    if (missing.length) {
      throw badRequest(
        `這份封存共 ${total} 片，缺少第 ${missing.join('、')} 片。`
        + '還原需要所有分片，請一次選取全部。',
        'missing_parts',
      );
    }

    // 路徑 → 擁有它的那一片。附件分散在各片，讀的時候要查得到
    const where = new Map();
    for (const r of readers) {
      for (const name of r.zip.names) if (!where.has(name)) where.set(name, r.zip);
    }

    const mf = where.get('manifest.json');
    if (!mf) {
      throw badRequest('封存中找不到 manifest.json，這可能不是本系統產生的封存檔',
        'no_manifest');
    }
    let manifest;
    try {
      manifest = JSON.parse((await mf.read('manifest.json')).toString('utf8'));
    } catch (e) {
      throw badRequest(`manifest.json 格式不正確：${e.message}`, 'bad_manifest');
    }
    if (manifest.format !== ARCHIVE_FORMAT) {
      throw badRequest(`不支援的封存格式：${manifest.format || '（未標示）'}`, 'bad_format');
    }

    return {
      manifest,
      parts: total,
      archiveId: ids[0],
      async read(name) {
        const z = where.get(name);
        return z ? z.read(name) : null;
      },
      close,
    };
  } catch (e) {
    await close();
    throw e;
  }
}

/** 先看一眼封存的內容，讓使用者確認要還原的是哪一份。不改動任何東西。 */
export async function inspectArchive(paths) {
  const set = await openArchiveSet(paths);
  try {
    return { manifest: set.manifest, parts: set.parts, archiveId: set.archiveId };
  } finally {
    await set.close();
  }
}

/**
 * 以封存取代目前的專案資料。
 *
 * 業務資料全部清空後重建；帳號不清除——把目前的管理員刪掉就沒人進得來了。
 * 封存中有而目前沒有的帳號，以「停用且無密碼」補建，只為了讓作者資訊對得上。
 */
export async function restoreArchive(paths, { by = null } = {}) {
  const set = await openArchiveSet(paths);
  const { manifest } = set;
  const db = getDb();
  const now = nowIso();

  const result = {
    exportedAt: manifest.exportedAt,
    parts: set.parts,
    cleared: {},
    restored: {},
    usersAdded: [],
    attachments: 0,
    skippedAttachments: [],
  };

  try {
    /* 1. 附件實體檔案先寫進資料磁碟區。
          先寫檔再動資料庫：萬一寫檔失敗，資料庫還沒被清空。
          一次只讀一個檔，幾 GB 的封存也不會把記憶體吃掉。 */
    const written = [];
    for (const a of manifest.attachments || []) {
      const bytes = await set.read(a.archivePath);
      if (!bytes) { result.skippedAttachments.push(`${a.filename}（封存中缺少檔案）`); continue; }
      const sha = createHash('sha256').update(bytes).digest('hex');
      const rel = join(sha.slice(0, 2), sha.slice(2, 4), sha);
      const full = join(config.paths.uploads, rel);
      await mkdir(dirname(full), { recursive: true });
      if (!existsSync(full)) await writeFile(full, bytes);
      written.push({ ...a, rel, sha, size: bytes.length });
    }

    /* 2. 資料庫一次性替換。整段放在同一個交易裡——
          中途失敗不該留下「清空了但沒寫回去」的狀態。 */
    const apply = db.transaction(() => {
      for (const name of Object.keys(COLLECTIONS)) {
        result.cleared[name] = db.prepare('SELECT COUNT(*) n FROM records WHERE collection = ?')
          .get(name).n;
        db.prepare('DELETE FROM records WHERE collection = ?').run(name);
      }
      db.prepare('DELETE FROM attachments').run();

      const ins = db.prepare(
        `INSERT INTO records (collection, id, data, version, deleted,
           created_at, created_by, updated_at, updated_by)
         VALUES (?, ?, ?, 1, 0, ?, ?, ?, ?)`,
      );
      for (const [name, rows] of Object.entries(manifest.records || {})) {
        if (!COLLECTIONS[name]) continue;
        for (const r of rows) {
          ins.run(name, String(r.id), JSON.stringify(r.data),
            r.createdAt || now, r.createdBy || by, now, by);
        }
        result.restored[name] = rows.length;
      }

      const insAtt = db.prepare(
        `INSERT INTO attachments (id, collection, record_id, filename, mime, bytes,
           sha256, rel_path, uploaded_at, uploaded_by, deleted)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      );
      for (const a of written) {
        insAtt.run(a.id || randomUUID(), a.collection, a.recordId, a.filename,
          a.mime, a.size, a.sha, a.rel, a.uploadedAt || now, a.uploadedBy || by);
      }
      result.attachments = written.length;

      // 補建缺少的帳號：停用、無密碼，只為了讓作者資訊顯示得出來
      const exists = new Set(db.prepare('SELECT id FROM users').all().map(u => u.id));
      const addUser = db.prepare(
        `INSERT INTO users (id, name, role, perm, pw_hash, provider, must_change_pw,
           disabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, NULL, 'local', 1, 1, ?, ?)`,
      );
      for (const u of manifest.users || []) {
        if (exists.has(u.id)) continue;
        // 權限一律降為分析員：封存裡的管理員不該因為還原就取得本系統的管理權
        addUser.run(u.id, u.name || u.id, u.role || '網路分析員', 'analyst', now, now);
        result.usersAdded.push(u.id);
      }
    });
    apply();
  } finally {
    await set.close();
  }

  if (manifest.settings?.ttp_hidden) {
    setSetting('ttp_hidden', manifest.settings.ttp_hidden, by);
  }
  setSetting('last_restore', {
    at: now, by, exportedAt: manifest.exportedAt, parts: set.parts, counts: result.restored,
  }, by);

  return result;
}

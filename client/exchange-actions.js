/* ============================================================
   各系統的匯出動作與資產 CSV 匯入
   ============================================================ */

const userName = id => USERS[id]?.name || id || '—';
const joinTags = t => (t || []).join('、') || '—';

/* ---------- 獵補案件簿：調查報告 PDF ---------- */
function exportCasePdf(c) {
  const d = DETAIL[c.id] || {};
  printDoc({
    title: c.title,
    subtitle: `${c.id}　獵補案件簿 · 調查報告`,
    meta: [
      ['案件編號', c.id],
      ['嚴重度', c.sev],
      ['調查結果', c.verdict],
      ['調查進度', c.progress],
      ['事件類型', c.cat],
      ['分析員', userName(c.analyst)],
      ['案發時間', (c.occur || []).join(' — ') || '—'],
      ['報告建立', c.created],
      ['主機名稱', c.host],
      ['主機使用者', c.hostUser],
      ['標籤', joinTags(c.tags)],
    ],
    sections: [
      { heading: '結論', body: d.conclusion || '（尚未填寫結論）' },
      { heading: '案件始末', body: d.narrative || '（尚未填寫）' },
      d.mitigation ? { heading: '處置與緩解建議', body: d.mitigation } : null,
      (c.conns || []).length ? {
        heading: '連線紀錄',
        body: printTable(
          ['來源 IP', '來源埠', '目的 IP', '目的埠', '目的主機', '備註'],
          c.conns.map(n => [n.src, n.srcPort, n.dst, n.dstPort, n.dstHost, n.note])),
      } : null,
      (d.iocs || []).length ? {
        heading: 'IOC',
        body: printTable(['類型', '指標值'],
          d.iocs.map(o => [IOC_LABEL[o.t] || o.t, o.v])),
      } : null,
      (d.ttps || []).length ? {
        heading: 'MITRE ATT&CK TTP',
        body: printTable(['戰術', '技術編號', '技術名稱', 'Technique (EN)'],
          d.ttps.map(t => [t.tac, t.id,
            TECH_INDEX[t.id]?.name || t.name, TECH_INDEX[t.id]?.en || ''])),
      } : null,
      (d.shots || []).length ? {
        heading: '附圖',
        body: el('div', { class: 'p-shots' }, ...d.shots.map(s => el('figure', {},
          s.url ? el('img', { src: s.url, alt: s.cap }) : el('div', { class: 'p-noimg' }, '（圖片未附加）'),
          el('figcaption', {}, s.cap)))),
      } : null,
      (d.audit || []).length ? {
        heading: '異動歷程',
        body: printTable(['時間', '人員', '職務', '動作'],
          d.audit.map(a => [a.when, a.who, a.role, a.act])),
      } : null,
    ],
  });
}

/* ---------- 請求管理系統 ---------- */
function exportRequestPdf(r) {
  const d = RDETAIL[r.id] || {};
  printDoc({
    title: r.subject,
    subtitle: `${r.id}　請求管理系統 · ${r.type === 'CR' ? '變更請求' : '資訊請求'}`,
    meta: [
      ['請求編號', r.id],
      ['類型', r.type],
      ['優先級', r.prio],
      ['處理進度', r.progress],
      ['申請人', userName(r.applicant)],
      ['申請單位', r.unit],
      ['提出時間', r.created],
      ['回覆時間', r.repliedAt || '—'],
    ],
    sections: [
      { heading: '請求內容', body: r.desc || '（未填寫）' },
      { heading: '回覆', body: r.reply || '（尚未回覆）' },
      (d.audit || []).length ? {
        heading: '異動歷程',
        body: printTable(['時間', '人員', '職務', '動作'],
          d.audit.map(a => [a.when, a.who, a.role, a.act])),
      } : null,
    ],
  });
}

/* ---------- 資產管理系統 ---------- */
function exportAssetPdf(a) {
  const d = ADETAIL[a.id] || {};
  printDoc({
    title: a.hostname,
    subtitle: `${a.id}　資產管理系統 · 資產明細`,
    meta: [
      ['資產編號', a.id],
      ['主機名稱', a.hostname],
      ['設備型號', a.device],
      ['製造商', a.vendor],
      ['作業系統', a.os],
      ['重要性', a.importance],
      ['IPv4', a.ip],
      ['網段', a.cidr],
      ['IPv6', a.ipv6],
      ['MAC', a.mac],
      ['上層網通設備', a.uplink],
      ['所屬 VLAN', a.vlan],
      ['放置地點', a.location],
      ['負責分析員', userName(a.analyst)],
      ['建檔時間', a.created],
      ['標籤', joinTags(a.tags)],
    ],
    sections: [
      { heading: '用途說明', body: d.purpose || '（未填寫）' },
      (d.services || []).length ? {
        heading: '服務與開放埠',
        body: printTable(['服務', '埠', '版本'],
          d.services.map(s => [s.name, s.port, s.version])),
      } : null,
      (d.vulns || []).length ? {
        heading: '已知版本漏洞',
        body: printTable(['CVE', '元件', '嚴重度', '立即修補', '說明'],
          d.vulns.map(v => [v.cve, v.component, v.severity, v.urgent ? '是' : '否', v.note])),
      } : null,
      (d.files || []).length ? {
        heading: '附件',
        body: printTable(['檔名', '類型', '大小'],
          d.files.map(f => [f.name, f.kind, `${f.size} bytes`])),
      } : null,
      (d.audit || []).length ? {
        heading: '異動歷程',
        body: printTable(['時間', '人員', '職務', '動作'],
          d.audit.map(x => [x.when, x.who, x.role, x.act])),
      } : null,
    ],
  });
}

/* ---------- 情資管理系統 ---------- */
function exportIntelPdf(x) {
  printDoc({
    title: x.source,
    subtitle: `${x.id}　情資管理系統 · 情資報告`,
    meta: [
      ['報告編號', x.id],
      ['情資類型', x.kind || '其他'],
      ['情資來源', x.source],
      ['建立時間', x.created],
      ['分析員', userName(x.analyst)],
      ['TTP 數', String((x.ttps || []).length)],
    ],
    sections: [
      { heading: '情資內容', body: x.content || '（未填寫）' },
      { heading: '分析結果', body: x.analysis || '（未填寫）' },
      (x.iocs || []).length ? {
        heading: 'IOC',
        body: printTable(['類型', '指標值', '備註'],
          x.iocs.map(o => [IOC_LABEL[o.t] || o.t, o.v, o.n])),
      } : null,
      (x.ttps || []).length ? {
        heading: 'MITRE ATT&CK TTP',
        body: printTable(['技術編號', '技術名稱', 'Technique (EN)'],
          x.ttps.map(t => [t, TECH_INDEX[t]?.name || '（未收錄）', TECH_INDEX[t]?.en || ''])),
      } : null,
    ],
  });
}

function exportHuntPdf(h) {
  printDoc({
    title: h.hypothesis ? h.hypothesis.slice(0, 60) : h.id,
    subtitle: `${h.id}　情資管理系統 · 威脅獵補計畫`,
    meta: [
      ['計畫編號', h.id],
      ['狀態', h.status],
      ['建立時間', h.created],
      ['分析員', userName(h.analyst)],
      ['鎖定 TTP', (h.ttps || []).join('、') || '—'],
      ['關聯案件', (h.cases || []).map(c => c.id || c).join('、') || '—'],
    ],
    sections: [
      ...HUNT_FIELDS.map(([k, label]) => ({ heading: label, body: h[k] || '（未填寫）' })),
      h.resultNote ? { heading: '調查結果補充', body: h.resultNote } : null,
    ],
  });
}

function exportAptPdf(a) {
  printDoc({
    title: a.name,
    subtitle: `${a.id}　情資管理系統 · APT 組織報告`,
    meta: [
      ['組織編號', a.id],
      ['組織名稱', a.name],
      ['類型', a.type],
      ['國家／地區', a.country],
      ['鎖定目標', (a.targets || []).join('、') || '—'],
      ['TTP 數', String((a.ttps || []).length)],
    ],
    sections: [
      a.note ? { heading: '組織描述', body: a.note } : null,
      (a.ttps || []).length ? {
        heading: '使用的 MITRE ATT&CK 技術',
        body: printTable(['技術編號', '技術名稱', 'Technique (EN)'],
          a.ttps.map(t => [t, TECH_INDEX[t]?.name || '（未收錄）', TECH_INDEX[t]?.en || ''])),
      } : null,
    ],
  });
}

/* ============================================================
   資產 XLSX
   ============================================================ */

/**
 * 資產的匯出欄位。這份定義同時是 XLSX 的欄、CSV 範本的標題列，
 * 以及 CSV 匯入的欄位對應表——三者必須一致，所以只寫一次。
 *
 * key 為資產物件上的欄位；detail 為真時改取 ADETAIL。
 */
const ASSET_COLUMNS = [
  { key: 'id', label: '資產編號', width: 14, importable: false,
    hint: '留空則由系統配發 ASSET-####；填既有編號則為更新' },
  { key: 'hostname', label: '主機名稱', width: 20, required: true, hint: '必填，不可與現有資產重複' },
  { key: 'device', label: '設備型號', width: 22 },
  { key: 'vendor', label: '製造商', width: 20, hint: '格式「廠商（國家）」，中國製造商會特別標註' },
  { key: 'os', label: '作業系統', width: 24 },
  { key: 'ip', label: 'IPv4', width: 16 },
  { key: 'cidr', label: '網段', width: 18 },
  { key: 'ipv6', label: 'IPv6', width: 26 },
  { key: 'mac', label: 'MAC', width: 19 },
  { key: 'uplink', label: '上層網通設備', width: 18 },
  { key: 'vlan', label: '所屬 VLAN', width: 18 },
  { key: 'location', label: '放置地點', width: 20 },
  { key: 'importance', label: '重要性', width: 10, enum: ['關鍵', '高', '中', '低'], hint: '關鍵／高／中／低，留空視為「中」' },
  { key: 'analyst', label: '負責分析員', width: 14, hint: '填帳號，如 chen；留空則記為匯入者' },
  { key: 'tags', label: '標籤', width: 26, list: true, hint: '多個標籤以分號分隔，如 server;tier-1' },
  { key: 'purpose', label: '用途說明', width: 46, detail: true },
  { key: 'created', label: '建檔時間', width: 18, importable: false },
];

const assetCellValue = (a, col) => {
  if (col.detail) return (ADETAIL[a.id] || {})[col.key] || '';
  if (col.list) return (a[col.key] || []).join(';');
  return a[col.key] ?? '';
};

/** 匯出目前篩選後的資產清單，而不是永遠整份——使用者看到什麼就匯出什麼。 */
function exportAssetsXlsx(rows) {
  const list = rows && rows.length ? rows : ASSETS;
  const extra = [
    { label: '服務數', width: 9 },
    { label: '漏洞數', width: 9 },
    { label: '待立即修補', width: 12 },
  ];
  const blob = buildXlsx({
    sheetName: '資產清冊',
    columns: [...ASSET_COLUMNS, ...extra],
    rows: list.map(a => {
      const d = ADETAIL[a.id] || {};
      return [
        ...ASSET_COLUMNS.map(c => assetCellValue(a, c)),
        (d.services || []).length,
        (d.vulns || []).length,
        (d.vulns || []).filter(v => v.urgent).length,
      ];
    }),
  });
  saveBlob(blob, `資產清冊-${stampSlug()}.xlsx`);
}


/** 資產清冊 CSV：欄位與 XLSX 一致，方便改完再匯入回來。 */
function exportAssetsCsv(rows) {
  const list = rows && rows.length ? rows : ASSETS;
  const csv = buildCsv(
    ASSET_COLUMNS.map(c => c.label),
    list.map(a => ASSET_COLUMNS.map(c => assetCellValue(a, c))));
  saveBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }),
    `資產清冊-${stampSlug()}.csv`, { text: csv });
}

/**
 * 案件清單彙總 PDF。匯出的是「目前篩選後的結果」，
 * 使用者在畫面上篩出什麼，印出來就是什麼。
 */
function exportCaseListPdf() {
  const rows = filtered();
  const n = k => rows.filter(c => c.verdict === k).length;
  printDoc({
    title: '調查報告彙總',
    subtitle: `獵補案件簿 · 依目前篩選條件匯出 ${rows.length} 件`,
    meta: [
      ['案件數', String(rows.length)],
      ['惡意行為', String(n('惡意行為'))],
      ['進行中', String(rows.filter(c => c.progress === '進行中').length)],
      ['授權行為', String(n('授權行為'))],
      ['關鍵字', S.q || '（無）'],
      ['正常行為', String(n('正常行為'))],
      ['篩選條件',
        [S.fProgress !== '全部' && `進度=${S.fProgress}`,
         S.fVerdict !== '全部' && `結果=${S.fVerdict}`,
         S.fSev !== '全部' && `嚴重度=${S.fSev}`,
         S.fTags.length && `標籤=${S.fTags.join('、')}`].filter(Boolean).join('　') || '（未設定）'],
      ['排序', `${S.sortBy} ${S.sortDir === 'desc' ? '遞減' : '遞增'}`],
    ],
    sections: [{
      heading: '案件清單',
      body: printTable(
        ['編號', '標題', '嚴重度', '結果', '進度', '分析員', '案發時間'],
        rows.map(c => [c.id, c.title, c.sev, c.verdict, c.progress,
          userName(c.analyst), (c.occur || [])[0] || c.created])),
    }],
  });
}

/* ============================================================
   資產 CSV 匯入
   ============================================================ */

const IMPORTABLE = ASSET_COLUMNS.filter(c => c.importable !== false || c.key === 'id');

/** 產生匯入範本：標題列 + 兩筆填好的示範列。 */
function assetCsvTemplate() {
  const headers = IMPORTABLE.map(c => c.label);
  const sample = [
    ['', 'TPE-WEB-05', 'Dell PowerEdge R660', 'Dell（美國）', 'Ubuntu 24.04 LTS',
      '10.32.7.55', '10.32.7.0/24', '2001:db8:32:7::55', 'B0:83:FE:22:1A:05',
      'TPE-SW-CORE', 'VLAN 20 · 應用區', '台北總部 3F 機房', '高', 'chen',
      'server;web;tier-1', '對外入口網站的後端應用伺服器，處理表單投遞。'],
    ['', 'TPE-SW-B2', 'H3C S5130S-28S-EI', '新華三（中國）', 'Comware 7.1.070',
      '10.32.2.2', '10.32.2.0/24', '', '00:23:89:44:5C:02',
      'TPE-SW-CORE', 'VLAN 30 · 辦公區', '台北總部 2F 弱電間', '中', 'lin',
      'switch;access', '二樓辦公區接取交換器。'],
  ];
  return buildCsv(headers, sample);
}

function downloadAssetTemplate() {
  const csv = assetCsvTemplate();
  saveBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }),
    '資產匯入範本.csv', { text: csv });
}

/* ---------- 驗證 ---------- */

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const MAC_RE = /^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$/;
const CIDR_RE = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;

const validIpv4 = v => {
  const m = IPV4_RE.exec(v);
  return !!m && m.slice(1).every(n => Number(n) <= 255);
};

/**
 * 把 CSV 列轉成待匯入的資產，逐欄驗證。
 *
 * 匯入是少數會一次寫進大量資料的操作，錯了很難回頭，
 * 所以這裡不做任何猜測性的自動修正——有問題就標出來讓人決定。
 */
function validateAssetRows(table) {
  if (!table.length) return { error: '檔案沒有任何內容。' };

  const headers = table[0].map(h => h.trim());
  const colFor = {};
  for (const c of IMPORTABLE) {
    const idx = headers.findIndex(h => h === c.label);
    if (idx >= 0) colFor[c.key] = idx;
  }

  const missing = IMPORTABLE.filter(c => c.required && colFor[c.key] === undefined);
  if (missing.length) {
    return { error: `標題列缺少必要欄位：${missing.map(c => c.label).join('、')}。請以範本為準。` };
  }
  const unknown = headers.filter(h => h && !IMPORTABLE.some(c => c.label === h));

  const byHostname = new Map(ASSETS.map(a => [a.hostname.toLowerCase(), a]));
  const byId = new Map(ASSETS.map(a => [a.id, a]));
  const seenHost = new Map();
  const items = [];

  for (let r = 1; r < table.length; r += 1) {
    const raw = table[r];
    const line = r + 1;
    const get = key => (colFor[key] === undefined ? '' : (raw[colFor[key]] ?? '').trim());
    const errors = [];
    const warnings = [];

    const hostname = get('hostname');
    if (!hostname) errors.push('主機名稱為必填');

    const id = get('id');
    let mode = 'create';
    let target = null;
    if (id) {
      target = byId.get(id);
      if (!target) errors.push(`資產編號 ${id} 不存在，無法更新（要新建請留空）`);
      else mode = 'update';
    }

    const key = hostname.toLowerCase();
    if (hostname) {
      const existing = byHostname.get(key);
      if (existing && existing.id !== id) {
        errors.push(`主機名稱已存在於 ${existing.id}`);
      }
      if (seenHost.has(key)) errors.push(`與第 ${seenHost.get(key)} 列的主機名稱重複`);
      else seenHost.set(key, line);
    }

    const importance = get('importance');
    if (importance && !['關鍵', '高', '中', '低'].includes(importance)) {
      errors.push(`重要性「${importance}」不是有效值（關鍵／高／中／低）`);
    }

    const ip = get('ip');
    if (ip && !validIpv4(ip)) errors.push(`IPv4「${ip}」格式不正確`);

    const mac = get('mac');
    if (mac && !MAC_RE.test(mac)) errors.push(`MAC「${mac}」格式不正確`);

    const cidr = get('cidr');
    if (cidr && !CIDR_RE.test(cidr)) errors.push(`網段「${cidr}」格式不正確`);

    const analyst = get('analyst');
    if (analyst && !USERS[analyst]) warnings.push(`帳號「${analyst}」不存在，將記為你本人`);

    const uplink = get('uplink');
    if (uplink && !ASSETS.some(a => a.hostname === uplink) && !/無上層/.test(uplink)) {
      warnings.push(`上層設備「${uplink}」不在資產清冊中`);
    }

    items.push({
      line, mode, errors, warnings, id: id || null, hostname,
      values: Object.fromEntries(IMPORTABLE.map(c => [c.key, get(c.key)])),
    });
  }

  return { items, unknown, headers };
}

/* ---------- 匯入對話框 ---------- */

function openAssetImport() {
  const body = el('div', {},
    el('p', { style: 'font-size:12.5px;line-height:1.8;color:var(--ink-2)' },
      '以 CSV 批次建立或更新資產。第一列必須是標題列，欄位名稱需與範本一致；' +
      '欄位順序不拘，多餘的欄會被忽略。'),
    el('p', { style: 'font-size:12.5px;line-height:1.8;color:var(--ink-2);margin-top:6px' },
      '也可以直接丟 ',
      el('b', {}, 'nmap 的掃描報告'),
      '：XML（',
      el('code', {}, 'nmap -oX'),
      '）或 greppable（',
      el('code', {}, 'nmap -oG'),
      '）都可以，系統會轉成上述格式後一樣先讓你預覽。' +
      'XML 的欄位最齊全——含 MAC、製造商、OS 指紋與服務版本。'),

    el('div', { style: 'display:flex;gap:8px;align-items:center;margin:14px 0;flex-wrap:wrap' },
      el('button', { class: 'btn', onclick: downloadAssetTemplate },
        el('span', { html: svgIcon(I.download) }), '下載匯入範本 CSV'),
      el('button', { class: 'btn btn-sm', onclick: () => showTemplateSpec() },
        el('span', { html: svgIcon(I.info) }), '欄位說明')),

    el('div', { class: 'dropzone', id: 'csv-drop',
      onclick: () => $('#csv-file').click(),
      ondragover: e => { e.preventDefault(); e.currentTarget.dataset.over = '1'; },
      ondragleave: e => { delete e.currentTarget.dataset.over; },
      ondrop: e => {
        e.preventDefault();
        delete e.currentTarget.dataset.over;
        const f = e.dataTransfer.files[0];
        if (f) readAssetCsv(f);
      } },
      el('span', { html: svgIcon(I.upload) }),
      el('div', {},
        el('div', { style: 'font-size:13px;font-weight:600' }, '選擇或拖曳 CSV 或 nmap 報告'),
        el('div', { style: 'font-size:11.5px;color:var(--ink-3);margin-top:3px' },
          'CSV 請以 UTF-8 儲存（Excel 選「CSV UTF-8（逗號分隔）」）；nmap 接受 .xml 與 .gnmap')),
      el('input', { type: 'file', id: 'csv-file', style: 'display:none',
        accept: '.csv,.xml,.gnmap,.nmap,text/csv,text/xml,application/xml',
        onchange: e => { const f = e.target.files[0]; if (f) readAssetCsv(f); } })),

    el('div', { id: 'csv-result' }));

  openModal('匯入資產（CSV）', body, 880);
}

function showTemplateSpec() {
  openModal('CSV 欄位說明', el('div', {},
    el('table', { class: 'tbl spec-tbl' },
      el('thead', {}, el('tr', {},
        el('th', {}, '欄位'), el('th', {}, '必填'), el('th', {}, '說明'))),
      el('tbody', {}, ...IMPORTABLE.map(c => el('tr', {},
        el('td', {}, el('span', { class: 'mono', style: 'font-size:11.5px' }, c.label)),
        el('td', {}, c.required ? '是' : ''),
        el('td', { style: 'font-size:11.5px;color:var(--ink-2)' },
          c.hint || (c.detail ? '寫入資產明細的用途說明' : '')))))),
    el('p', { style: 'font-size:11.5px;color:var(--ink-3);margin-top:12px;line-height:1.7' },
      '「資產編號」留空代表新建，系統會配發下一個 ASSET-####；' +
      '填入既有編號則視為更新該筆資產。建檔時間由系統填寫，不接受匯入。')), 620);
}

async function readAssetCsv(file) {
  const host = $('#csv-result');
  host.innerHTML = '';
  host.append(el('p', { class: 'hint', style: 'padding:10px 0' }, '解析中…'));

  if (file.size > 5 * 1024 * 1024) {
    host.innerHTML = '';
    host.append(el('p', { class: 'login-err' }, '檔案超過 5 MB，請分批匯入。'));
    return;
  }

  let text;
  try {
    text = await file.text();
  } catch (e) {
    host.innerHTML = '';
    host.append(el('p', { class: 'login-err' }, '讀取檔案失敗：' + e.message));
    return;
  }

  // nmap 報告先轉成與範本相同的 CSV，之後走完全一樣的驗證與預覽流程
  let table;
  let converted = null;
  if (detectNmapFormat(text)) {
    try {
      const parsed = parseNmap(text);
      const rows = await nmapToRows(parsed);
      converted = { parsed, rows, csv: nmapRowsToCsv(rows) };
      table = parseCsv(converted.csv);
    } catch (e) {
      host.innerHTML = '';
      host.append(el('p', { class: 'login-err' }, 'nmap 報告解析失敗：' + e.message));
      return;
    }
  } else {
    table = parseCsv(text);
  }

  const result = validateAssetRows(table);
  host.innerHTML = '';
  if (result.error) {
    host.append(el('p', { class: 'login-err' }, result.error));
    return;
  }
  // 掃到的服務依列號掛回去，匯入時一併寫進資產明細
  if (converted) {
    result.items.forEach((item, i) => { item.services = converted.rows[i]?.services || []; });
  }
  renderImportPreview(host, result, file.name, converted);
}

/** 轉成與匯入範本完全相同的欄位順序，使用者也能把它存下來自行編修。 */
function nmapRowsToCsv(rows) {
  return buildCsv(
    IMPORTABLE.map(c => c.label),
    rows.map(r => IMPORTABLE.map(c => r.values[c.key] ?? '')));
}

/**
 * 把一串節點接到容器上，略過 null。
 *
 * el() 會自動濾掉 null 子節點，但 Node.append() 不會——它把 null 轉成
 * 字串「null」直接印在畫面上。條件式區塊要用這個，不要直接 append。
 */
function appendAll(host, ...nodes) {
  for (const n of nodes.flat()) if (n != null && n !== false) host.append(n);
}

function renderImportPreview(host, result, filename, converted) {
  const { items, unknown } = result;
  const bad = items.filter(x => x.errors.length);
  const ok = items.filter(x => !x.errors.length);
  const creates = ok.filter(x => x.mode === 'create').length;
  const updates = ok.filter(x => x.mode === 'update').length;
  const warns = ok.filter(x => x.warnings.length).length;

  appendAll(host,
    el('div', { class: 'imp-sum' },
      el('span', { class: 'chip' }, el('i', { class: 'dot', style: 'background:var(--good)' }),
        `可新建 ${creates}`),
      el('span', { class: 'chip' }, el('i', { class: 'dot', style: 'background:var(--data)' }),
        `可更新 ${updates}`),
      warns ? el('span', { class: 'chip' }, el('i', { class: 'dot', style: 'background:var(--warning)' }),
        `有提醒 ${warns}`) : null,
      bad.length ? el('span', { class: 'chip' }, el('i', { class: 'dot', style: 'background:var(--critical)' }),
        `無法匯入 ${bad.length}`) : null,
      el('span', { class: 'hint', style: 'margin-left:auto' }, filename)),

    converted
      ? el('div', { class: 'nmap-note' },
          el('div', {},
            el('b', {}, '已自 nmap 報告轉換'),
            `　${converted.parsed.meta.tool}`,
            converted.parsed.meta.when ? `　${converted.parsed.meta.when}` : '',
            converted.parsed.hosts.length ? `　存活主機 ${converted.parsed.hosts.length} 台` : '',
            converted.parsed.meta.args
              ? el('div', { class: 'hint', style: 'margin-top:3px;font-family:var(--mono)' },
                  converted.parsed.meta.args)
              : null,
            el('div', { class: 'hint', style: 'margin-top:4px' },
              '網段以 IPv4 推定為 /24，重要性、放置地點與上層設備掃描不到，請匯入後補齊。')),
          el('button', { class: 'btn btn-sm', style: 'margin-left:auto;flex:none',
            onclick: () => saveBlob(
              new Blob([converted.csv], { type: 'text/csv;charset=utf-8' }),
              `nmap轉換-${stampSlug()}.csv`, { text: converted.csv }) },
            el('span', { html: svgIcon(I.download) }), '下載轉換後的 CSV'))
      : null,

    unknown.length
      ? el('p', { class: 'hint', style: 'margin-top:8px' },
          `忽略未知欄位：${unknown.join('、')}`)
      : null,

    el('div', { class: 'tablewrap', style: 'margin-top:12px;max-height:320px;overflow:auto' },
      el('table', { class: 'tbl' },
        el('thead', {}, el('tr', {},
          el('th', {}, '列'), el('th', {}, '動作'), el('th', {}, '主機名稱'),
          el('th', {}, 'IPv4'), el('th', {}, '重要性'), el('th', {}, '檢查結果'))),
        el('tbody', {}, ...items.map(x => el('tr', {},
          el('td', {}, el('span', { class: 'mono', style: 'font-size:11.5px' }, String(x.line))),
          el('td', {}, x.errors.length
            ? el('span', { class: 'chip' }, el('i', { class: 'dot', style: 'background:var(--critical)' }), '略過')
            : el('span', { class: 'chip' },
                el('i', { class: 'dot', style: `background:${x.mode === 'create' ? 'var(--good)' : 'var(--data)'}` }),
                x.mode === 'create' ? '新建' : `更新 ${x.id}`)),
          el('td', {}, x.hostname || '—'),
          el('td', {}, el('span', { class: 'mono', style: 'font-size:11.5px' }, x.values.ip || '—')),
          el('td', {}, x.values.importance || '中'),
          el('td', { style: 'font-size:11.5px;line-height:1.6' },
            x.errors.length
              ? el('span', { style: 'color:var(--critical)' }, x.errors.join('；'))
              : x.warnings.length
                ? el('span', { style: 'color:var(--warning)' }, x.warnings.join('；'))
                : el('span', { style: 'color:var(--ink-3)' }, '無問題'))))))),

    el('div', { style: 'display:flex;gap:8px;align-items:center;margin-top:14px' },
      el('button', {
        class: 'btn btn-primary',
        disabled: ok.length ? null : true,
        onclick: () => commitAssetImport(ok),
      }, el('span', { html: svgIcon(I.check) }), `匯入 ${ok.length} 筆`),
      bad.length
        ? el('span', { class: 'hint' }, `${bad.length} 筆有錯誤的資料不會被寫入，請修正後重新匯入。`)
        : null));
}

/** 依「埠＋服務名」合併，重掃同一台主機不會把既有紀錄洗成重複項。 */
function mergeServices(existing, incoming) {
  const key = s => `${s.port}/${s.name}`;
  const map = new Map((existing || []).map(s => [key(s), s]));
  for (const s of incoming) {
    const k = key(s);
    if (map.has(k)) {
      // 版本資訊以新掃到的為準，但不要用空值蓋掉既有的
      if (s.version) map.get(k).version = s.version;
    } else map.set(k, { ...s });
  }
  return [...map.values()].sort((a, b) => Number(a.port) - Number(b.port));
}

function commitAssetImport(items) {
  if (!items.length) return;
  const me = USERS[S.me];
  let created = 0;
  let updated = 0;

  for (const x of items) {
    const v = x.values;
    const analyst = USERS[v.analyst] ? v.analyst : S.me;
    // \u3001 是頓號；字面字元類在非 UTF-8 解讀下會壞掉，一律用逃脫
    const tags = (v.tags || '').split(/[;,\u3001\uff0c]/).map(t => t.trim()).filter(Boolean);

    const fields = {
      hostname: x.hostname,
      device: v.device, vendor: v.vendor, os: v.os,
      ip: v.ip, cidr: v.cidr, ipv6: v.ipv6, mac: v.mac,
      uplink: v.uplink, vlan: v.vlan, location: v.location,
      importance: v.importance || '中',
      analyst, tags,
    };

    if (x.mode === 'update') {
      const a = ASSETS.find(y => y.id === x.id);
      if (!a) continue;
      Object.assign(a, fields);
      const d = (ADETAIL[a.id] ||= { purpose: '', services: [], vulns: [], files: [], audit: [] });
      if (v.purpose) d.purpose = v.purpose;
      if (x.services?.length) d.services = mergeServices(d.services, x.services);
      (d.audit ||= []).unshift({ who: me.name, role: me.role, act: `自 CSV 匯入更新（第 ${x.line} 列）`, when: nowStamp() });
      updated += 1;
    } else {
      const id = nextAssetId();
      ASSETS.push({ id, ...fields, created: nowStamp() });
      ADETAIL[id] = {
        purpose: v.purpose || '', services: x.services || [], vulns: [], files: [],
        audit: [{ who: me.name, role: me.role, act: `自 CSV 匯入建立（第 ${x.line} 列）`, when: nowStamp() }],
      };
      created += 1;
    }
  }

  persist();
  closeOverlay();
  render();
  toast(`匯入完成：新建 ${created} 筆、更新 ${updated} 筆`);
}


/* ============================================================
   附件下載
   ============================================================ */

/**
 * 下載一張附圖。
 *
 * 正式部署的附圖存在伺服器上（/api/v1/attachments/...），先取回再交付；
 * 展示版的附圖是 data URL，直接轉成 blob。兩種情形都走同一個 saveBlob，
 * 所以沙箱環境下的替代交付方式也一併適用。
 */
async function downloadShot(shot) {
  if (!shot || !shot.url) return toast('這張附圖沒有實際檔案，無法下載');
  try {
    const res = await fetch(shot.url, { credentials: 'same-origin' });
    if (!res.ok) throw new Error(`伺服器回應 ${res.status}`);
    const blob = await res.blob();
    const ext = (blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
    const base = (shot.cap || shot.name || '附圖').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);
    saveBlob(blob, /\.[a-z0-9]+$/i.test(base) ? base : `${base}.${ext}`);
  } catch (e) {
    toast('附圖下載失敗：' + e.message);
  }
}

/** 下載資產的文字附件（組態檔、log）。內容本來就在記憶體裡，直接成檔。 */
function downloadDoc(f) {
  if (!f || f.text == null) return toast('這個附件沒有內容可下載');
  const name = (f.name || 'attachment.txt').replace(/[\\/:*?"<>|]/g, '_');
  saveBlob(new Blob([f.text], { type: 'text/plain;charset=utf-8' }), name, { text: f.text });
}

/** 一次下載某筆紀錄的全部附圖。 */
async function downloadAllShots(shots, label) {
  const real = (shots || []).filter(s => s.url);
  if (!real.length) return toast('這筆紀錄沒有可下載的附圖');
  for (const s of real) {
    await downloadShot(s);
    // 逐張確認，避免一次彈出一堆存檔提示
    await new Promise(r => setTimeout(r, 300));
  }
  toast(`已送出 ${real.length} 張附圖${label ? `（${label}）` : ''}`);
}

/* ============================================================
   圖表 PNG
   ============================================================ */

/**
 * 一張圖在匯出選單裡佔兩列：PNG 與 SVG。
 *
 * 兩種都留著是因為用途不同——PNG 貼進簡報或郵件即可看，
 * SVG 放大不失真、可再進編輯軟體修改，檔案通常也小得多。
 */
function figureItems(label, selector, basename) {
  const row = (fmt, run) => el('button', { class: 'mi', onclick: () => { closeOverlay(); run(); } },
    el('span', { html: svgIcon(I.download) }),
    el('span', {}, label),
    el('small', {}, fmt));
  return [
    row('PNG', () => svgToPng($(selector), `${basename}-${stampSlug()}.png`)),
    row('SVG', () => svgToSvgFile($(selector), `${basename}-${stampSlug()}.svg`)),
  ];
}

/** 通用匯出選單。各系統把自己的項目傳進來。 */
function openExportMenu(e, items) {
  e.stopPropagation();
  const ov = $('#overlay');
  const menu = el('div', { class: 'menu' },
    el('div', { class: 'mh' }, el('div', { class: 'eyebrow' }, '匯出')),
    ...items.filter(Boolean));
  ov.innerHTML = '';
  ov.append(menu);
  armOutsideClose();
  menu.addEventListener('click', ev => ev.stopPropagation());
}

const menuItem = (label, onclick, icon) =>
  el('button', { class: 'mi', onclick: () => { closeOverlay(); onclick(); } },
    el('span', { html: svgIcon(icon || I.download) }), label);

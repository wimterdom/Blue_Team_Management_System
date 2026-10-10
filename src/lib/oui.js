/**
 * MAC 位址 → 配發廠商。
 *
 * 資料來自 IEEE 的三個登錄檔（MA-L /24、MA-M /28、MA-S /36），
 * 由 scripts/update-oui.mjs 產生成本機檔案。比對一律在本機進行：
 * 系統可能部署在不能連外的環境，而且每填一個 MAC 就打一次外部網站，
 * 既慢又會把內部資產資訊洩漏出去。
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const seedDir = resolve(here, '../../seed');

let table = null;
let countryZh = null;
let meta = null;
let origin = null;   // 品牌母國覆寫

/**
 * 解析 seed/oui.txt。
 * 每行「廠商 \t 國碼 \t 前綴1,前綴2,…」——同一家廠商常持有數十個前綴，
 * 分組存放比逐筆 JSON 小 46%。
 */
function parseOuiTable(text) {
  const out = new Map();
  for (const line of text.split('\n')) {
    if (!line) continue;
    const i = line.indexOf('\t');
    const j = line.indexOf('\t', i + 1);
    if (i < 0 || j < 0) continue;
    const org = line.slice(0, i);
    const cc = line.slice(i + 1, j);
    for (const pre of line.slice(j + 1).split(',')) {
      if (pre) out.set(pre, [org, cc]);
    }
  }
  return out;
}

function load() {
  if (table) return;
  const f = resolve(seedDir, 'oui.txt');
  table = existsSync(f) ? parseOuiTable(readFileSync(f, 'utf8')) : new Map();
  const c = resolve(seedDir, 'country-zh.json');
  countryZh = existsSync(c) ? JSON.parse(readFileSync(c, 'utf8')) : {};
  const m = resolve(seedDir, 'oui-meta.json');
  meta = existsSync(m) ? JSON.parse(readFileSync(m, 'utf8')) : null;

  const v = resolve(seedDir, 'vendor-origin.json');
  const raw = existsSync(v) ? JSON.parse(readFileSync(v, 'utf8')) : { brands: {} };
  // 兩階段：品牌名優先，城市名僅作後備。
  // Nokia Shanghai Bell 同時含品牌與城市，若讓城市搶先就會判錯。
  const toPairs = src => Object.entries(src || {})
    .flatMap(([cc, names]) => names.map(n => [n, cc]))
    // 同一階段內長字串優先，"lg electronics" 才不會被短字串搶走
    .sort((a, b) => b[0].length - a[0].length);
  origin = { brands: toPairs(raw.brands), cities: toPairs(raw.cityHints) };
}

/**
 * 品牌母國。
 *
 * IEEE 記的是註冊地址，不一定等於品牌母國——TP-Link 有 79 個前綴登記在
 * 美國、Lenovo 有 142 個。資產系統的「製造商（國家）」是用來辨識設備來源的
 * （例如標註中國製造商），所以這裡對知名品牌以母國為準，並把登錄國別一併回傳，
 * 兩者都看得到，不會把判斷依據藏起來。
 */
const isLetter = ch => ch !== undefined && /[a-z]/.test(ch);

/**
 * 字界比對：needle 前後都不能緊鄰字母。
 * 單純用 includes() 會讓 "intel" 命中巴西廠商 Intelbras、
 * 讓 "hpe" 命中各種含該三字的名稱。
 */
function matchesBrand(lower, needle) {
  let i = lower.indexOf(needle);
  while (i >= 0) {
    if (!isLetter(lower[i - 1]) && !isLetter(lower[i + needle.length])) return true;
    i = lower.indexOf(needle, i + 1);
  }
  return false;
}

function brandOrigin(org) {
  const lower = String(org || '').toLowerCase();
  for (const [needle, cc] of origin.brands) {
    if (matchesBrand(lower, needle)) return cc;
  }
  for (const [needle, cc] of origin.cities) {
    if (matchesBrand(lower, needle)) return cc;
  }
  return '';
}

export const normalizeMac = mac =>
  String(mac || '').toUpperCase().replace(/[^0-9A-F]/g, '');

/**
 * 查一個 MAC。由長前綴往短的找——小廠商拿到的 /36 區段不可被
 * 持有整段 /24 的大廠覆蓋。
 *
 * @returns {{prefix,org,country,countryName,vendor}|null}
 */
export function lookupMac(mac) {
  load();
  const hex = normalizeMac(mac);
  if (hex.length < 6) return null;

  for (const len of [9, 7, 6]) {   // MA-S /36、MA-M /28、MA-L /24
    const hit = table.get(hex.slice(0, len));
    if (!hit) continue;
    const [org, cc] = hit;
    const brand = brandOrigin(org);
    const use = brand || cc || '';
    const countryName = use ? (countryZh[use] || use) : '';
    return {
      prefix: hex.slice(0, len),
      org,
      country: use,                         // 採用的國別
      countryName,
      registryCountry: cc || '',            // IEEE 登錄地址的國別
      originOverridden: Boolean(brand && cc && brand !== cc),
      // 資產系統的「製造商（國家）」欄位格式。地址不帶入。
      vendor: countryName ? `${org}（${countryName}）` : org,
    };
  }
  return null;
}

export function ouiStatus() {
  load();
  return {
    loaded: table.size,
    retrieved: meta?.retrieved || null,
    withCountry: meta?.withCountry || 0,
    sources: meta?.sources || {},
  };
}

/** 測試與更新流程用：丟掉快取，下次查詢重新讀檔。 */
export function resetOuiCache() {
  table = null; countryZh = null; meta = null;
}

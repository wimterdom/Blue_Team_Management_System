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

function load() {
  if (table) return;
  const f = resolve(seedDir, 'oui.json');
  table = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {};
  const c = resolve(seedDir, 'country-zh.json');
  countryZh = existsSync(c) ? JSON.parse(readFileSync(c, 'utf8')) : {};
  const m = resolve(seedDir, 'oui-meta.json');
  meta = existsSync(m) ? JSON.parse(readFileSync(m, 'utf8')) : null;

  const v = resolve(seedDir, 'vendor-origin.json');
  const raw = existsSync(v) ? JSON.parse(readFileSync(v, 'utf8')) : { brands: {} };
  origin = [];
  for (const [cc, names] of Object.entries(raw.brands || {})) {
    for (const n of names) origin.push([n, cc]);
  }
  // 長字串優先比對，"lg electronics" 才不會被 "lg" 之類的短字串搶走
  origin.sort((a, b) => b[0].length - a[0].length);
}

/**
 * 品牌母國。
 *
 * IEEE 記的是註冊地址，不一定等於品牌母國——TP-Link 有 79 個前綴登記在
 * 美國、Lenovo 有 142 個。資產系統的「製造商（國家）」是用來辨識設備來源的
 * （例如標註中國製造商），所以這裡對知名品牌以母國為準，並把登錄國別一併回傳，
 * 兩者都看得到，不會把判斷依據藏起來。
 */
function brandOrigin(org) {
  const lower = String(org || '').toLowerCase();
  for (const [needle, cc] of origin) {
    if (lower.includes(needle)) return cc;
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
    const hit = table[hex.slice(0, len)];
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
    loaded: Object.keys(table).length,
    retrieved: meta?.retrieved || null,
    withCountry: meta?.withCountry || 0,
    sources: meta?.sources || {},
  };
}

/** 測試與更新流程用：丟掉快取，下次查詢重新讀檔。 */
export function resetOuiCache() {
  table = null; countryZh = null; meta = null;
}

#!/usr/bin/env node
/**
 * 由 IEEE 官方登錄檔產生本機的 MAC 位址配發對照表。
 *
 * 比對一律在本機進行——系統可能部署在不能連外的環境，而且每填一個 MAC
 * 就打一次外部網站既慢又會把內部資產資訊洩漏出去。
 *
 * 三個登錄檔都收：
 *   MA-L  oui/oui.csv      前 24 bit（最常見）
 *   MA-M  oui28/mam.csv    前 28 bit
 *   MA-S  oui36/oui36.csv  前 36 bit
 * 查詢時由長到短比對，小廠商配發的 /36 區段才不會被 /24 的持有者蓋掉。
 *
 *   node scripts/update-oui.mjs           # 下載並更新
 *   node scripts/update-oui.mjs --check   # 只檢查官方有無更新（離開碼 10 = 有）
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const SOURCES = [
  { registry: 'MA-L', bits: 24, url: 'https://standards-oui.ieee.org/oui/oui.csv' },
  { registry: 'MA-M', bits: 28, url: 'https://standards-oui.ieee.org/oui28/mam.csv' },
  { registry: 'MA-S', bits: 36, url: 'https://standards-oui.ieee.org/oui36/oui36.csv' },
];

const OUT = resolve(root, 'seed/oui.txt');
const META = resolve(root, 'seed/oui-meta.json');
const COUNTRY_ZH = resolve(root, 'seed/country-zh.json');

const checkOnly = process.argv.includes('--check');

/* ISO 3166-1 alpha-2。用來從地址末端辨認國別——美國地址的州別縮寫
   （MN、CA…）同樣是兩個大寫字母，所以取「最後一個」有效代碼才準：
   "Bloomington MN US 55438" 會落在 US，"Toronto ON CA" 會落在 CA。 */
const ISO2 = new Set(('AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ '
  + 'BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH '
  + 'ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE '
  + 'IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC '
  + 'MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE '
  + 'PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV '
  + 'SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT '
  + 'ZA ZM ZW').split(' '));

/** RFC 4180 的最小解析：欄位可帶引號，引號內可有逗號與跳脫引號。 */
function parseCsvLine(line) {
  const out = [];
  let f = '';
  let q = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (q) {
      if (ch === '"') { if (line[i + 1] === '"') { f += '"'; i += 1; } else q = false; }
      else f += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { out.push(f); f = ''; }
    else f += ch;
  }
  out.push(f);
  return out;
}

function countryOf(address) {
  const tokens = String(address || '').replace(/[,"]/g, ' ').split(/\s+/);
  let found = '';
  for (const t of tokens) {
    if (t.length === 2 && /^[A-Z]{2}$/.test(t) && ISO2.has(t)) found = t;
  }
  return found;
}

/** 組織名稱收尾常見的雜訊，去掉後比較像人會寫的廠商名。 */
function cleanOrg(name) {
  return String(name || '')
    .replace(/\s+/g, ' ')
    .replace(/[.,;]+$/, '')
    .trim();
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'btms-oui-updater' } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);
  return {
    text: await res.text(),
    lastModified: res.headers.get('last-modified') || '',
    etag: res.headers.get('etag') || '',
  };
}

/* ---------------- main ---------------- */

const prev = existsSync(META) ? JSON.parse(readFileSync(META, 'utf8')) : null;

const fetched = [];
for (const src of SOURCES) {
  process.stdout.write(`下載 ${src.registry} … `);
  const r = await fetchText(src.url);
  const sha = createHash('sha256').update(r.text).digest('hex');
  console.log(`${(r.text.length / 1048576).toFixed(1)} MB  sha256=${sha.slice(0, 12)}…`);
  fetched.push({ ...src, ...r, sha256: sha });
}

const sameAsBefore = prev && SOURCES.every((s, i) =>
  prev.sources?.[s.registry]?.sha256 === fetched[i].sha256);

if (checkOnly) {
  if (sameAsBefore) {
    console.log(`\n本機資料與官方一致（取得於 ${prev.retrieved}），無須更新。`);
    process.exit(0);
  }
  console.log('\n官方登錄檔已更新，請執行 node scripts/update-oui.mjs 更新本機資料。');
  process.exit(10);
}

if (sameAsBefore) {
  console.log(`\n本機資料與官方一致（取得於 ${prev.retrieved}），仍重新產生輸出檔。`);
}

/* ---- 解析 ---- */
const table = {};          // 前綴（去冒號大寫十六進位） -> [組織, 國碼]
const counts = {};
for (const src of fetched) {
  let n = 0;
  const lines = src.text.split(/\r?\n/);
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) continue;
    const cols = parseCsvLine(line);
    if (cols.length < 3) continue;
    const prefix = (cols[1] || '').trim().toUpperCase().replace(/[^0-9A-F]/g, '');
    const org = cleanOrg(cols[2]);
    if (!prefix || !org) continue;
    // 長前綴優先：MA-S 的 /36 不可被同段的 MA-L /24 覆蓋
    if (table[prefix] && table[prefix][2] >= src.bits) continue;
    table[prefix] = [org, countryOf(cols[3]), src.bits];
    n += 1;
  }
  counts[src.registry] = n;
}

/* 輸出格式：每行「廠商 \t 國碼 \t 前綴1,前綴2,…」。
   同一家廠商常持有數十個前綴（華為 2088 個、小米 346 個），分組後比逐筆
   JSON 小 46%（2.15 MB → 1.16 MB），而且不需要執行期解壓縮——
   展示版是單一 HTML 檔，而且必須帶完整表：先前只帶常見廠商的子集，
   使用者隨手輸入的真實 MAC 幾乎都查不到，看起來就像功能壞掉。 */
const byVendor = new Map();
for (const [pre, v] of Object.entries(table)) {
  const key = `${v[0]}\t${v[1] || ''}`;
  if (!byVendor.has(key)) byVendor.set(key, []);
  byVendor.get(key).push(pre);
}
const lines = [];
for (const [key, pres] of byVendor) lines.push(`${key}\t${pres.sort().join(',')}`);
lines.sort();

const entries = Object.keys(table).length;
const withCountry = Object.values(table).filter(v => v[1]).length;

mkdirSync(resolve(root, 'seed'), { recursive: true });
writeFileSync(OUT, lines.join('\n'), 'utf8');

const meta = {
  retrieved: new Date().toISOString().slice(0, 10),
  entries,
  withCountry,
  vendors: byVendor.size,
  sources: Object.fromEntries(fetched.map(f => [f.registry, {
    url: f.url, bits: f.bits, sha256: f.sha256,
    lastModified: f.lastModified, parsed: counts[f.registry],
  }])),
};
writeFileSync(META, JSON.stringify(meta, null, 2) + '\n', 'utf8');

const sizeMb = p => (readFileSync(p).length / 1048576).toFixed(2);
console.log(`\n已寫入 seed/oui.txt  ${meta.entries} 筆前綴 / ${meta.vendors} 家廠商（${sizeMb(OUT)} MB）`);
console.log(`  其中 ${withCountry} 筆查得到國別`);
console.log(`已寫入 seed/oui-meta.json`);
for (const [reg, s] of Object.entries(meta.sources)) {
  console.log(`  ${reg} /${s.bits}  ${s.parsed} 筆  ${s.lastModified || '（無 Last-Modified）'}`);
}
if (!existsSync(COUNTRY_ZH)) {
  console.warn('\n[warn] 找不到 seed/country-zh.json，國別將以 ISO 代碼顯示。');
}

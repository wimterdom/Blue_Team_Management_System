#!/usr/bin/env node
/**
 * 由單一 UI 來源 client/index.html 產生兩份輸出：
 *
 *   public/index.html — 正式部署。資料存取層走 /api/v1，
 *                       示範資料一律剔除，頁面裡不留任何案件內容或帳號。
 *
 *   dist/demo.html    — 靜態單檔展示（Artifact）。資料存取層改用
 *                       localStorage，保留示範資料，無需後端即可完整操作。
 *
 * 兩者共用完全相同的畫面程式碼，差別只在嵌入哪一種資料存取層，
 * 因此展示版上驗收出來的修正，直接就是正式版的修正。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const src = readFileSync(resolve(root, 'client/index.html'), 'utf8');
const datalayer = readFileSync(resolve(root, 'client/datalayer.js'), 'utf8');
const prodViews = readFileSync(resolve(root, 'client/prod-views.js'), 'utf8');
const attackData = readFileSync(resolve(root, 'client/attack-data.js'), 'utf8');

/* 展示版沒有伺服器可查 OUI，整張對照表嵌進頁面；正式版留空，一律走 /api/v1/oui。
   必須是「完整」的表——先前只嵌常見廠商的子集，使用者隨手輸入的真實 MAC
   幾乎都查不到，看起來就像功能壞掉。表為「廠商\t國碼\t前綴清單」的純文字，
   比逐筆 JSON 小 46%，載入時才展開成 Map。 */
const ouiTable = readFileSync(resolve(root, 'seed/oui.txt'), 'utf8');
const countryZh = JSON.parse(readFileSync(resolve(root, 'seed/country-zh.json'), 'utf8'));
const ouiMeta = JSON.parse(readFileSync(resolve(root, 'seed/oui-meta.json'), 'utf8'));
const vendorOrigin = JSON.parse(readFileSync(resolve(root, 'seed/vendor-origin.json'), 'utf8'));
// 同一階段內長字串優先，"lg electronics" 才不會被短字串搶走
const toOriginPairs = src => Object.entries(src || {})
  .flatMap(([cc, names]) => names.map(n => [n, cc]))
  .sort((a, b) => b[0].length - a[0].length);
const originPairs = {
  brands: toOriginPairs(vendorOrigin.brands),
  cities: toOriginPairs(vendorOrigin.cityHints),
};
const ouiBlockFor = mode => mode === 'demo'
  ? `const OUI_TABLE = ${JSON.stringify(ouiTable)};\n`
    + `const COUNTRY_ZH = ${JSON.stringify(countryZh)};\n`
    + `const VENDOR_ORIGIN = ${JSON.stringify(originPairs)};\n`
    + `const OUI_TABLE_DATE = ${JSON.stringify(ouiMeta.retrieved)};`
  : 'const OUI_TABLE = "", COUNTRY_ZH = {}, VENDOR_ORIGIN = [], OUI_TABLE_DATE = null;';
const nmap = readFileSync(resolve(root, 'client/nmap.js'), 'utf8');
const exchange = readFileSync(resolve(root, 'client/exchange.js'), 'utf8');
const exchangeActions = readFileSync(resolve(root, 'client/exchange-actions.js'), 'utf8');
const extraCss = readFileSync(resolve(root, 'client/prod.css'), 'utf8');

/**
 * 把 `const NAME = [ … ];` 的內容換成空集合。
 *
 * 這些宣告都是頂層敘述，起始於行首的 `const NAME =`，
 * 並結束於行首單獨一行的 `];` 或 `};`。以行首為界比逐字元配對括號可靠得多：
 * 字串、樣板字面值、正規表示式裡的括號都不會誤判。
 */
function emptyLiteral(text, name) {
  const lines = text.split('\n');
  const start = lines.findIndex(l => new RegExp(`^const\\s+${name}\\s*=\\s*[\\[{]`).test(l));
  if (start < 0) throw new Error(`找不到頂層宣告：const ${name}`);

  const open = /=\s*\[/.test(lines[start]) ? '[' : '{';
  const close = open === '[' ? ']' : '}';

  let end = -1;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (lines[i] === `${close};` || lines[i] === close) { end = i; break; }
  }
  if (end < 0) throw new Error(`找不到 ${name} 位於行首的結束括號`);

  lines.splice(start, end - start + 1, `const ${name} = ${open}${close};`);
  return lines.join('\n');
}

/** 移除一段以 `NAME.push(` 起始、到對應右括號為止的敘述。 */
function dropPushCall(text, name) {
  const marker = `${name}.push(`;
  const start = text.indexOf(marker);
  if (start < 0) return text;
  let i = start + marker.length;
  let depth = 1;
  let str = null;
  while (i < text.length && depth > 0) {
    const ch = text[i];
    const prev = text[i - 1];
    if (str) {
      if (ch === str && prev !== '\\') str = null;
    } else if (ch === '"' || ch === "'" || ch === '`') str = ch;
    else if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    i += 1;
  }
  while (text[i] === ';' || text[i] === '\n') i += 1;
  return text.slice(0, start) + text.slice(i);
}

const SEED_LITERALS = [
  'CASES', 'DETAIL', 'EXTRA', 'REQ_SEED', 'ASSET_SEED',
  'CHAIN', 'MITIGATIONS', 'APTS', 'INTELS', 'HUNTS', 'USERS',
];

function build(mode) {
  let out = src;

  if (mode === 'server') {
    // 正式版不夾帶任何示範內容：案件、請求、資產、情資與帳號全部清空，
    // 真正的資料一律由 /api/v1/bootstrap 取得。
    for (const name of SEED_LITERALS) out = emptyLiteral(out, name);
    out = dropPushCall(out, 'INTELS');
  }

  out = out
    .replace('/*__BTMS_ATTACK_DATA__*/', () => attackData)
    // OUI 子集的佔位符位在 datalayer 之內，所以先填好再整段注入
    .replace('/*__BTMS_DATALAYER__*/', () => datalayer
      .replace('__BTMS_MODE__', mode)
      .replace('/*__BTMS_OUI_TABLE__*/', () => ouiBlockFor(mode)))
    .replace('/*__BTMS_NMAP__*/', () => nmap)
    .replace('/*__BTMS_EXCHANGE__*/', () => exchange)
    .replace('/*__BTMS_EXCHANGE_ACTIONS__*/', () => exchangeActions)
    .replace('/*__BTMS_PRODVIEWS__*/', () => prodViews)
    .replace('/*__BTMS_PROD_CSS__*/', () => extraCss);

  if (out.includes('__BTMS_MODE__')) throw new Error('MODE 佔位符未被取代');
  // 佔位符沒被取代表示模組沒嵌進去，頁面會在執行期才炸——提早擋下
  for (const ph of ['ATTACK_DATA', 'OUI_TABLE', 'DATALAYER', 'NMAP', 'EXCHANGE', 'EXCHANGE_ACTIONS', 'PRODVIEWS', 'PROD_CSS']) {
    if (out.includes(`/*__BTMS_${ph}__*/`)) throw new Error(`${ph} 模組未嵌入`);
  }
  return out;
}

/* ---- 產出 ---- */
mkdirSync(resolve(root, 'public'), { recursive: true });
mkdirSync(resolve(root, 'dist'), { recursive: true });

const server = build('server');
const demo = build('demo');

writeFileSync(resolve(root, 'public/index.html'), server, 'utf8');
writeFileSync(resolve(root, 'dist/demo.html'), demo, 'utf8');

const kb = s => (Buffer.byteLength(s, 'utf8') / 1024).toFixed(0) + ' KB';
console.log(`public/index.html  ${kb(server)}  （正式版，無示範資料）`);
console.log(`dist/demo.html     ${kb(demo)}  （展示版，含示範資料）`);

/* ---- 驗證：正式版不得殘留示範內容或明文密碼 ---- */
// 比對的是「資料本體」而非字面提及：表單的提示文字沿用真實命名慣例是刻意的，
// 那是給使用者看的範例格式，不是內建資料。
const LEAKS = [
  [/id:\s*'CASE-\d+'/, '示範案件紀錄'],
  [/name:\s*'陳彥廷'/, '示範帳號資料'],
  [/pw:\s*'[^']+'/, '明文密碼欄位'],
  [/@2026'/, '示範密碼字串'],
  [/示範帳號 — 點擊即帶入/, '登入頁示範帳號區塊'],
  [/id:\s*'INTEL-\d+'/, '示範情資紀錄'],
  [/id:\s*'RFI-\d+'/, '示範請求表紀錄'],
];
const found = LEAKS.filter(([re]) => re.test(server));
if (found.length) {
  console.error('\n正式版輸出仍含有以下內容，請檢查建置流程：');
  for (const [re, what] of found) {
    console.error(`  - ${what}：${server.match(re)[0].slice(0, 60)}`);
  }
  process.exit(1);
}
/* ---- 驗證：正規表示式的字元類不得含非 ASCII 字面字元 ----
   頁面若被當成 Latin-1 解讀，字面範圍會變成亂碼而在解析階段就丟出
   SyntaxError，整個模組不執行。一律要求寫成 \uXXXX 逃脫。 */
const NON_ASCII_CLASS = /\/\[[^\]\n]*[^\x00-\x7F][^\]\n]*\]/g;
for (const [name, text] of [['public/index.html', server], ['dist/demo.html', demo]]) {
  const hits = text.match(NON_ASCII_CLASS);
  if (hits) {
    console.error(`\n${name} 的正規表示式字元類含非 ASCII 字面字元，請改用 \\uXXXX 逃脫：`);
    for (const h of [...new Set(hits)].slice(0, 5)) console.error(`  - ${h}`);
    process.exit(1);
  }
}

/* ---- 驗證：輸出不得含裸控制字元 ----
   原始碼裡若不小心寫進真實的控制位元組（而非 \uXXXX 逃脫），
   正規表示式字面值會在解析階段就壞掉，整個模組不執行。 */
for (const [name, text] of [['public/index.html', server], ['dist/demo.html', demo]]) {
  const idx = [...text].findIndex(ch => {
    const c = ch.codePointAt(0);
    return c < 0x20 && ch !== '\n' && ch !== '\t' && ch !== '\r';
  });
  if (idx >= 0) {
    const around = text.slice(Math.max(0, idx - 50), idx + 20).replace(/[\u0000-\u001F]/g, '?');
    console.error(`\n${name} 含裸控制字元（位置 ${idx}），請改用 \\uXXXX 逃脫：`);
    console.error(`  …${around}…`);
    process.exit(1);
  }
}

console.log('檢查通過：正式版輸出不含示範資料與任何密碼；兩份輸出皆不受頁面編碼影響。');

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
    .replace('/*__BTMS_DATALAYER__*/', () => datalayer.replace('__BTMS_MODE__', mode))
    .replace('/*__BTMS_PRODVIEWS__*/', () => prodViews)
    .replace('/*__BTMS_PROD_CSS__*/', () => extraCss);

  if (out.includes('__BTMS_MODE__')) throw new Error('MODE 佔位符未被取代');
  if (out.includes('/*__BTMS_DATALAYER__*/')) throw new Error('資料層未嵌入');
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
console.log('檢查通過：正式版輸出不含示範資料與任何密碼。');

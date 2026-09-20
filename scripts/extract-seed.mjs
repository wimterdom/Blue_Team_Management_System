#!/usr/bin/env node
/**
 * 從 UI 原型 (prototype.html) 抽出示範資料與參照資料，輸出成 seed/*.json。
 *
 * UI 來源把所有資料都寫成模組頂端的 const 宣告，這支腳本把「資料區」
 * （模組開頭到資料存取層之前）切出來，在 node:vm 沙箱裡求值，
 * 再把需要的集合 dump 成 JSON。如此資料只有一份來源，不必人工複製。
 *
 *   node scripts/extract-seed.mjs            # 預設讀 client/index.html
 *   node scripts/extract-seed.mjs ../prototype.html
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const srcPath = process.argv[2]
  ? resolve(process.cwd(), process.argv[2])
  : resolve(root, 'client/index.html');

const html = readFileSync(srcPath, 'utf8');
const mStart = html.indexOf('<script type="module">');
if (mStart < 0) throw new Error('prototype.html 找不到 <script type="module">');
const body = html.slice(mStart + '<script type="module">'.length);

/* 資料區的結尾：目前的 UI 來源是資料存取層的佔位符；
   若餵進來的是改造前的原型，則落在 PERSISTENCE 註解區塊。兩者都支援。 */
function dataRegionOf(text) {
  const placeholder = text.indexOf('/*__BTMS_DATALAYER__*/');
  if (placeholder >= 0) return text.slice(0, placeholder);

  const legacy = text.indexOf('PERSISTENCE');
  if (legacy >= 0) {
    const blockStart = text.lastIndexOf('/* ===', legacy);
    return text.slice(0, blockStart);
  }
  throw new Error('找不到資料區的結尾標記（/*__BTMS_DATALAYER__*/ 或 PERSISTENCE）');
}
const dataRegion = dataRegionOf(body);

// 資料區只碰到 matchMedia 與 documentElement，給最小 shim 即可求值
const sandbox = {
  matchMedia: () => ({ matches: false }),
  document: { documentElement: { dataset: {} } },
  console,
  Date,
  Math,
  JSON,
  Object,
  Array,
  String,
  Number,
  Boolean,
  Map,
  Set,
  RegExp,
  Intl,
  isNaN,
  parseInt,
  parseFloat,
};
vm.createContext(sandbox);

// 資料區是 module 的一部分，頂層 const 不會變成 context 屬性，
// 因此在結尾附加一段把需要的識別字收集起來。
const WANT = [
  'USERS', 'ROLES', 'PERMS', 'CATEGORIES',
  'CASES', 'DETAIL', 'STATS', 'VERDICT_DIST', 'TREND',
  'REQUESTS', 'RDETAIL',
  'ASSETS', 'ADETAIL', 'SENSORS',
  'APTS', 'INTELS', 'HUNTS', 'INTEL_KINDS',
  'ATTACK_FULL', 'TACTICS',
  'IOC_TYPES', 'SEV_ORDER', 'IMP_ORDER',
];
const collector = `\n__out = { ${WANT.map(k => `${k}: typeof ${k}!=='undefined' ? ${k} : null`).join(', ')} };\n`;

vm.runInContext(`var __out = null;\n${dataRegion}${collector}`, sandbox, {
  filename: 'prototype-data-region.js',
  timeout: 20000,
});

const out = sandbox.__out;
const missing = WANT.filter(k => out[k] === null);
if (missing.length) {
  console.warn('[warn] 這些識別字未在資料區找到：', missing.join(', '));
}

mkdirSync(resolve(root, 'seed'), { recursive: true });

/* ---- 參照資料：正式部署一定會載入 ---- */
const reference = {
  attack: out.ATTACK_FULL,
  tactics: out.TACTICS,
  roles: out.ROLES,
  perms: out.PERMS,
  categories: out.CATEGORIES,
  intelKinds: out.INTEL_KINDS,
  iocTypes: out.IOC_TYPES,
};

/* ---- 示範資料：僅在 BTMS_SEED_DEMO=true 時載入 ---- */
// 使用者帳號另外處理：示範帳號只保留職務與姓名，密碼一律不落地。
const demoUsers = Object.fromEntries(
  Object.entries(out.USERS || {}).map(([id, u]) => [
    id,
    { id: u.id ?? id, name: u.name, role: u.role, perm: u.perm },
  ]),
);

const demo = {
  // 原型的日期都以「執行當下」為基準推算，抽成 JSON 後就凍結了。
  // 記下抽取日期，載入時據此把整份資料平移到當天，示範環境才不會
  // 隨著時間過去變成「本週新增 0 件」。
  generatedAt: new Date().toISOString().slice(0, 10),
  users: demoUsers,
  cases: out.CASES,
  detail: out.DETAIL,
  stats: out.STATS,
  verdict: out.VERDICT_DIST,
  trend: out.TREND,
  requests: out.REQUESTS,
  rdetail: out.RDETAIL,
  assets: out.ASSETS,
  adetail: out.ADETAIL,
  sensors: out.SENSORS,
  apts: out.APTS,
  intels: out.INTELS,
  hunts: out.HUNTS,
};

writeFileSync(resolve(root, 'seed/reference.json'), JSON.stringify(reference), 'utf8');
writeFileSync(resolve(root, 'seed/demo.json'), JSON.stringify(demo), 'utf8');

const n = o => (Array.isArray(o) ? o.length : Object.keys(o || {}).length);
console.log('已輸出 seed/reference.json 與 seed/demo.json');
console.log(
  `  參照：戰術 ${n(reference.tactics)}、ATT&CK 戰術群 ${n(reference.attack)}、職務 ${n(reference.roles)}`,
);
console.log(
  `  示範：使用者 ${n(demo.users)}、案件 ${n(demo.cases)}、請求 ${n(demo.requests)}、` +
    `資產 ${n(demo.assets)}、感測器 ${n(demo.sensors)}、APT ${n(demo.apts)}、` +
    `情資 ${n(demo.intels)}、獵補計畫 ${n(demo.hunts)}`,
);

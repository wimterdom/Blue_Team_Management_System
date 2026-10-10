#!/usr/bin/env node
/**
 * 由 MITRE 官方的 ATT&CK STIX 資料產生系統使用的技術表。
 *
 * 原本的技術表是手寫的，久了就與官方脫節——實測發現少了 360 項技術、
 * 整個 TA0112 戰術，還有 6 個編號在 v19 已被作廢改編（例如
 * T1562 Impair Defenses 改為 T1685、T1070.001 改為 T1685.005）。
 * 改成由官方來源產生，並把作廢對照一併輸出，既有資料才能跟著遷移。
 *
 *   node scripts/update-attack.mjs            # 取最新版並產生
 *   node scripts/update-attack.mjs --check    # 只檢查有無新版，不寫檔
 *   node scripts/update-attack.mjs --file x.json   # 用本機檔案（離線）
 *
 * 中文名稱來自 seed/attack-zh.json；官方新增而尚未翻譯的技術，
 * 本腳本會列出清單並以英文原名先行填入，不會默默產出半套。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const INDEX_URL = 'https://raw.githubusercontent.com/mitre-attack/attack-stix-data/master/index.json';
const META_PATH = resolve(root, 'seed/attack-meta.json');
const ZH_PATH = resolve(root, 'seed/attack-zh.json');
const OUT_PATH = resolve(root, 'client/attack-data.js');

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const fileArg = args[args.indexOf('--file') + 1];
const useFile = args.includes('--file') ? fileArg : null;

/** 每個戰術預設顯示幾項技術。規格要求「5~8 個實務常見技術」。 */
const COMMON_PER_TACTIC = 8;

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);
  return res.json();
}

async function latestRelease() {
  const index = await fetchJson(INDEX_URL);
  const ent = index.collections.find(c => /enterprise/i.test(c.name));
  if (!ent) throw new Error('index.json 找不到 Enterprise 集合');
  const versions = [...ent.versions].sort(
    (a, b) => a.version.split('.').map(Number)[0] - b.version.split('.').map(Number)[0]
      || a.version.split('.').map(Number)[1] - b.version.split('.').map(Number)[1],
  );
  return versions[versions.length - 1];
}

const extId = o => (o.external_references || [])
  .find(r => r.source_name === 'mitre-attack')?.external_id || null;

function build(bundle, { version, released }) {
  const objs = bundle.objects;
  const live = o => !o.revoked && !o.x_mitre_deprecated;

  /* ---- 戰術 ---- */
  const tactics = objs
    .filter(o => o.type === 'x-mitre-tactic' && live(o))
    .map(o => ({ id: extId(o), en: o.name, shortname: o.x_mitre_shortname }));

  /* ---- 技術 ---- */
  const techs = [];
  for (const o of objs) {
    if (o.type !== 'attack-pattern' || !live(o)) continue;
    const id = extId(o);
    if (!id) continue;
    techs.push({
      id,
      en: o.name,
      isSub: Boolean(o.x_mitre_is_subtechnique),
      phases: (o.kill_chain_phases || [])
        .filter(p => p.kill_chain_name === 'mitre-attack')
        .map(p => p.phase_name),
    });
  }

  /* ---- 作廢對照：舊編號 → 現行編號 ---- */
  const apById = Object.fromEntries(
    objs.filter(o => o.type === 'attack-pattern').map(o => [o.id, o]),
  );
  const revoked = {};
  for (const o of objs) {
    if (o.type !== 'relationship' || o.relationship_type !== 'revoked-by') continue;
    const from = apById[o.source_ref];
    const to = apById[o.target_ref];
    if (from && to && extId(from) && extId(to)) revoked[extId(from)] = extId(to);
  }

  /* ---- 使用頻度：被多少威脅組織與工具引用 ----
     用來決定每個戰術預設顯示哪幾項，比人工挑選客觀。 */
  const usage = {};
  for (const o of objs) {
    if (o.type !== 'relationship' || o.relationship_type !== 'uses') continue;
    const t = apById[o.target_ref];
    if (t && extId(t)) usage[extId(t)] = (usage[extId(t)] || 0) + 1;
  }

  return { tactics, techs, revoked, usage, version, released };
}

function assemble(data, zh) {
  const { tactics, techs, usage } = data;
  const byId = Object.fromEntries(techs.map(t => [t.id, t]));
  const nameOf = id => zh.techs[id] || byId[id]?.en || id;

  const untranslated = techs.filter(t => !zh.techs[t.id]).map(t => `${t.id}\t${t.en}`);

  /* 母技術的重要性要連同子技術一起算。
     威脅組織多半被歸因到子技術（T1071.001 被引用 422 次，母技術 T1071
     自身卻寥寥無幾），只看母技術的次數會把最常見的技術family排到後面。 */
  const familyUsage = id => techs
    .filter(t => t.id === id || t.id.startsWith(id + '.'))
    .reduce((n, t) => n + (usage[t.id] || 0), 0);

  const out = [];
  for (const tac of tactics) {
    const parents = techs
      .filter(t => !t.isSub && t.phases.includes(tac.shortname))
      .sort((a, b) => familyUsage(b.id) - familyUsage(a.id) || a.id.localeCompare(b.id));

    // 每個戰術取使用頻度最高的幾項作為預設顯示
    const commonSet = new Set(parents.slice(0, COMMON_PER_TACTIC).map(p => p.id));

    out.push({
      id: tac.id,
      name: zh.tactics[tac.id] || tac.en,
      en: tac.en,
      techs: parents
        .sort((a, b) => a.id.localeCompare(b.id))
        .map(p => {
          const subs = techs
            .filter(s => s.isSub && s.id.startsWith(p.id + '.'))
            .sort((a, b) => a.id.localeCompare(b.id));
          // 子技術跟著母技術顯示；母技術若非預設顯示，子技術也不顯示
          const subCommon = new Set(
            subs.slice()
              .sort((a, b) => (usage[b.id] || 0) - (usage[a.id] || 0))
              .slice(0, 4)
              .map(s => s.id),
          );
          return {
            id: p.id,
            name: nameOf(p.id),
            en: p.en,
            common: commonSet.has(p.id),
            subs: subs.map(s => ({
              id: s.id,
              name: nameOf(s.id),
              en: s.en,
              common: commonSet.has(p.id) && subCommon.has(s.id),
            })),
          };
        }),
    });
  }

  // 依 ATT&CK 矩陣的慣用順序排列戰術
  const ORDER = ['TA0043', 'TA0042', 'TA0001', 'TA0002', 'TA0003', 'TA0004',
    'TA0005', 'TA0112', 'TA0006', 'TA0007', 'TA0008', 'TA0009',
    'TA0011', 'TA0010', 'TA0040'];
  out.sort((a, b) => {
    const ia = ORDER.indexOf(a.id); const ib = ORDER.indexOf(b.id);
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
  });

  return { matrix: out, untranslated };
}

function emit(matrix, revoked, meta) {
  const lines = [];
  lines.push('/* ============================================================');
  lines.push('   MITRE ATT&CK Enterprise 技術表');
  lines.push('   ------------------------------------------------------------');
  lines.push('   本檔由 scripts/update-attack.mjs 自官方 STIX 資料產生，請勿手動編輯。');
  lines.push(`   來源：${meta.url}`);
  lines.push(`   版本：Enterprise v${meta.version}${meta.released ? `（${meta.released.slice(0, 10)} 發布）` : ''}`);
  lines.push(`   取得：${meta.retrieved}`);
  lines.push('');
  lines.push('   每項技術同時帶中文與官方英文原名（en）——分析員要與 attack.mitre.org 對照，');
  lines.push('   只有中文反而難找。中文名稱來自 seed/attack-zh.json；');
  lines.push('   common 為預設顯示與否，');
  lines.push('   依 MITRE 自身的「被威脅組織與工具引用次數」取每個戰術前 8 名。');
  lines.push('   ============================================================ */');
  lines.push(`const ATTACK_VERSION = ${JSON.stringify(`v${meta.version}`)};`);
  lines.push('const ATTACK_FULL=[');
  for (const tac of matrix) {
    lines.push(`  {id:${JSON.stringify(tac.id)}, name:${JSON.stringify(tac.name)}, en:${JSON.stringify(tac.en)}, techs:[`);
    for (const p of tac.techs) {
      const head = `    {id:${JSON.stringify(p.id)}, name:${JSON.stringify(p.name)}, en:${JSON.stringify(p.en)}, common:${p.common}, subs:[`;
      if (!p.subs.length) { lines.push(head + ']},'); continue; }
      lines.push(head);
      for (const s of p.subs) {
        lines.push(`      {id:${JSON.stringify(s.id)}, name:${JSON.stringify(s.name)}, en:${JSON.stringify(s.en)}, common:${s.common}},`);
      }
      lines.push('    ]},');
    }
    lines.push('  ]},');
  }
  lines.push('];');
  lines.push('');
  lines.push('/* 已作廢的技術編號 → 現行編號。既有資料載入時據此自動遷移，');
  lines.push('   舊報告裡的編號才不會在熱圖上對不到任何一格。 */');
  lines.push('const ATTACK_REVOKED = {');
  for (const [from, to] of Object.entries(revoked).sort()) {
    lines.push(`  ${JSON.stringify(from)}: ${JSON.stringify(to)},`);
  }
  lines.push('};');
  lines.push('');
  return lines.join('\n');
}

/* ---------------- main ---------------- */

const prevMeta = existsSync(META_PATH) ? JSON.parse(readFileSync(META_PATH, 'utf8')) : null;

let bundle;
let meta;

if (useFile) {
  bundle = JSON.parse(readFileSync(resolve(process.cwd(), useFile), 'utf8'));
  meta = { version: prevMeta?.version || 'local', released: '', url: useFile };
} else {
  const rel = await latestRelease();
  console.log(`官方最新：Enterprise v${rel.version}${rel.released ? `（${rel.released.slice(0, 10)}）` : ''}`);

  if (prevMeta && prevMeta.version === rel.version) {
    console.log(`本機已是 v${prevMeta.version}（取得於 ${prevMeta.retrieved}），無須更新。`);
    if (checkOnly) process.exit(0);
  } else if (prevMeta) {
    console.log(`本機為 v${prevMeta.version}，官方已更新至 v${rel.version}。`);
    if (checkOnly) process.exit(10); // 10 = 有新版，供 CI 判斷
  } else if (checkOnly) {
    console.log('本機尚無技術表。');
    process.exit(10);
  }

  const res = await fetch(rel.url);
  if (!res.ok) throw new Error(`下載失敗 ${res.status} — ${rel.url}`);
  const text = await res.text();
  meta = {
    version: rel.version,
    released: rel.released || '',
    url: rel.url,
    sha256: createHash('sha256').update(text).digest('hex'),
  };
  bundle = JSON.parse(text);
}

meta.retrieved = new Date().toISOString().slice(0, 10);

const zh = JSON.parse(readFileSync(ZH_PATH, 'utf8'));
const data = build(bundle, meta);
const { matrix, untranslated } = assemble(data, zh);

const nTac = matrix.length;
const nParent = matrix.reduce((n, t) => n + t.techs.length, 0);
const nSub = matrix.reduce((n, t) => n + t.techs.reduce((m, p) => m + p.subs.length, 0), 0);
const nCommon = matrix.reduce((n, t) => n + t.techs.filter(p => p.common).length, 0);

if (untranslated.length) {
  console.warn(`\n[warn] ${untranslated.length} 項技術尚無中文名稱，暫以英文原名輸出。`);
  console.warn('       請補進 seed/attack-zh.json 後重跑：');
  for (const line of untranslated.slice(0, 20)) console.warn('         ' + line);
  if (untranslated.length > 20) console.warn(`         …另有 ${untranslated.length - 20} 項`);
}

writeFileSync(OUT_PATH, emit(matrix, data.revoked, meta), 'utf8');
writeFileSync(META_PATH, JSON.stringify(meta, null, 2) + '\n', 'utf8');

console.log(`\n已寫入 ${OUT_PATH.replace(root + '/', '')}`);
console.log(`  戰術 ${nTac}｜母技術 ${nParent}（其中預設顯示 ${nCommon}）｜子技術 ${nSub}`);
console.log(`  作廢對照 ${Object.keys(data.revoked).length} 筆`);
console.log(`已寫入 ${META_PATH.replace(root + '/', '')}（v${meta.version}）`);

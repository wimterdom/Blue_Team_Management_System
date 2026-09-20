/**
 * 儀表板統計。
 *
 * 原型裡 STATS／VERDICT_DIST／TREND 是寫死的數字，和實際案件數對不上。
 * 正式版一律由資料庫即時彙算，新建或改判的案件立刻反映在首頁上。
 *
 * 注意排序與統計基準：規格明訂首頁案件清單依「案發時間」排序，
 * 而非紀錄建立時間；近 14 日趨勢同樣以案發時間落日。
 */
import { listRecords } from './records.js';

const dayKey = v => String(v || '').slice(0, 10);

/** 案發起始時間：occur 為 [起, 迄]，取起始值。 */
const occurStart = c => (Array.isArray(c.occur) ? c.occur[0] : c.occurStart) || c.created || '';

export function computeDashboard() {
  const cases = listRecords('cases').map(r => r.data);

  const total = cases.length;
  const active = cases.filter(c => c.progress === '進行中').length;
  const malicious = cases.filter(c => c.verdict === '惡意行為').length;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const weekAgo = new Date(today.getTime() - 6 * 86_400_000);
  const weekAgoKey = dayKey(weekAgo.toISOString());
  const week = cases.filter(c => dayKey(occurStart(c)) >= weekAgoKey).length;

  const counts = { 惡意行為: 0, 授權行為: 0, 正常行為: 0, 未判定: 0 };
  for (const c of cases) {
    if (counts[c.verdict] !== undefined) counts[c.verdict] += 1;
    else counts.未判定 += 1;
  }
  const verdict = [
    { k: '惡意行為', v: counts.惡意行為, c: 'var(--emph)' },
    { k: '授權行為', v: counts.授權行為, c: 'var(--neutral-1)' },
    { k: '正常行為', v: counts.正常行為, c: 'var(--neutral-2)' },
  ];

  // 近 14 日：日期軸永遠對齊「今天」，沒有案件的日子補 0
  const trend = [];
  for (let i = 13; i >= 0; i -= 1) {
    const d = new Date(today.getTime() - i * 86_400_000);
    const p = n => String(n).padStart(2, '0');
    const full = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    trend.push({
      date: full,
      d: full.slice(5),
      v: cases.filter(c => dayKey(occurStart(c)) === full).length,
    });
  }

  return {
    stats: { total, active, malicious, week },
    verdict,
    trend,
    // 未判定另外回報，讓前端可視情況提示待處理量
    undecided: counts.未判定,
  };
}

export default computeDashboard;

/** 時間工具。資料庫一律存 ISO-8601 UTC；前端顯示用的 'Y-m-d H:i' 另外轉換。 */

export const nowIso = () => new Date().toISOString();

/** 'YYYY-MM-DD HH:MM' — 前端沿用的顯示格式 */
export function toDisplay(iso = nowIso()) {
  const d = new Date(iso);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
         `${p(d.getHours())}:${p(d.getMinutes())}`;
}

export const plusMinutes = (min, from = Date.now()) =>
  new Date(from + min * 60_000).toISOString();

export const plusHours = (h, from = Date.now()) =>
  new Date(from + h * 3_600_000).toISOString();

/**
 * 存取控制。前端隱藏按鈕只是體驗，真正的把關一律在伺服器端做。
 *
 *   admin   系統管理員：全部內容，另可管理帳號與檢視稽核
 *   manage  隊長／副隊長：全部內容可編輯、刪除、結案
 *   analyst 分析員：可建立；僅能編輯、刪除自己建立的紀錄
 */
import { forbidden, unauthorized } from '../lib/errors.js';

export const PERM_RANK = { analyst: 1, manage: 2, admin: 3 };

export function requireAuth(req) {
  if (!req.user) throw unauthorized();
  return req.user;
}

export function requirePerm(min) {
  return async req => {
    const user = requireAuth(req);
    if ((PERM_RANK[user.perm] || 0) < (PERM_RANK[min] || 99)) {
      throw forbidden(`此操作需要「${min}」以上權限`);
    }
  };
}

/** 記錄的擁有者欄位：案件／資產用 analyst，請求表用 applicant。 */
export const ownerOf = data =>
  (data && (data.analyst ?? data.applicant)) || null;

/**
 * 能不能改這筆紀錄。
 *
 * @param shared 該集合是否為團隊共同維護（見 lib/collections.js）。
 *   獵補計畫與 TTP 標註屬於這一類：假說由一個人提出，分析、資料缺口與
 *   調查結果常由不同人補上，綁在建立者身上反而擋住正常的協作。
 */
export function canMutate(user, existingData, shared = false) {
  if (!user) return false;
  if (user.perm === 'admin' || user.perm === 'manage') return true;
  if (!existingData) return true; // 新建：任何登入者皆可
  if (shared) return true;
  return ownerOf(existingData) === user.id;
}

export function assertCanMutate(user, existingData, what = '這筆紀錄', shared = false) {
  if (!canMutate(user, existingData, shared)) {
    throw forbidden(`一般分析員僅能修改自己建立的紀錄，無法變更${what}`);
  }
}

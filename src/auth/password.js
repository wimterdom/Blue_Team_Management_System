/**
 * 密碼雜湊：argon2id，OWASP 建議的預設參數。
 * 明文密碼只在本模組內存在，不進資料庫、不進日誌、不進稽核紀錄。
 */
import { hash as argonHash, verify as argonVerify, Algorithm } from '@node-rs/argon2';
import config from '../config.js';

const OPTS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
};

export async function hashPassword(plain) {
  return argonHash(plain, OPTS);
}

export async function verifyPassword(storedHash, plain) {
  if (!storedHash) return false;
  try {
    return await argonVerify(storedHash, plain);
  } catch {
    return false;
  }
}

/**
 * 密碼強度檢查。與其堆砌複雜度規則，這裡採長度下限
 * 加上常見弱密碼與「與帳號雷同」的排除，貼近 NIST SP 800-63B 的建議。
 */
const COMMON = [
  'password', 'passwd', 'pass', 'admin', 'administrator', 'root',
  'qwerty', 'qwertyuiop', 'asdfgh', 'zxcvbn', 'letmein', 'welcome',
  'iloveyou', 'changeme', 'abcdef', 'monkey', 'dragon', 'sunshine',
  'blueteam', 'security', 'secret', 'login', 'test', 'demo',
  'taiwan', 'test1234',
];

/** leet 還原：p@ssw0rd 與 password 應視為同一個弱密碼 */
const deLeet = s =>
  s.toLowerCase()
    .replace(/[@4]/g, 'a').replace(/[3]/g, 'e').replace(/[1!|]/g, 'l')
    .replace(/[0]/g, 'o').replace(/[5$]/g, 's').replace(/[7]/g, 't');

/**
 * 弱密碼判定不能只做完全比對——password1234、Admin@2026 這類
 * 「常見字根＋數字」佔了實際外洩密碼的絕大多數。
 * 這裡看常見字根是否構成密碼的主體（去掉數字與符號後佔一半以上）。
 */
const SEQUENCES = [
  '01234567890123456789', 'abcdefghijklmnopqrstuvwxyz',
  'qwertyuiopasdfghjklzxcvbnm',
];

function weakBase(plain) {
  // 序列與純數字要看原字串；leet 還原會把 1234 變成字母而失準
  const raw = plain.toLowerCase();
  if (/^\d+$/.test(plain)) return '純數字的密碼過於薄弱';
  if (/^[^\p{L}\p{N}]+$/u.test(plain)) return '純符號的密碼過於薄弱';
  for (const seq of SEQUENCES) {
    for (let i = 0; i + 6 <= seq.length; i += 1) {
      const run = seq.slice(i, i + 6);
      if (raw.includes(run) || raw.includes([...run].reverse().join(''))) {
        return '密碼含有連續的鍵盤或數字序列';
      }
    }
  }

  const flat = deLeet(plain);
  const letters = flat.replace(/[^a-z]/g, '');
  for (const word of COMMON) {
    if (!flat.includes(word)) continue;
    if (word.length >= letters.length * 0.5) return `密碼以常見字「${word}」為主體`;
  }
  return null;
}

/**
 * 有效長度。系統介面為繁體中文，使用者很可能用中文詞組當密碼；
 * 單一漢字的取值空間遠大於一個拉丁字母，若按碼位數硬性要求 12 字，
 * 等於逼使用者改用更弱的英數密碼。故漢字以兩倍計，另設 8 字的絕對下限。
 */
function effectiveLength(plain) {
  let n = 0;
  for (const ch of plain) {
    n += /[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/.test(ch) ? 2 : 1;
  }
  return n;
}

export function checkPasswordPolicy(plain, { username = '', name = '' } = {}) {
  const min = config.auth.minPasswordLength;
  if (typeof plain !== 'string') return { ok: false, reason: '密碼格式不正確' };
  const chars = [...plain].length;
  if (chars < 8 || effectiveLength(plain) < min) {
    return {
      ok: false,
      reason: `密碼長度至少需 ${min} 個字元（中日韓文字以兩個字元計，但實際不得少於 8 字）`,
    };
  }
  if (plain.length > 256) {
    return { ok: false, reason: '密碼長度不得超過 256 個字元' };
  }
  const lower = plain.toLowerCase();
  const weak = weakBase(plain);
  if (weak) {
    return { ok: false, reason: `${weak}，請改用其他密碼` };
  }
  if (username && lower.includes(String(username).toLowerCase())) {
    return { ok: false, reason: '密碼不得包含帳號名稱' };
  }
  if (name && name.length >= 2 && lower.includes(String(name).toLowerCase())) {
    return { ok: false, reason: '密碼不得包含姓名' };
  }
  if (/^(.)\1+$/.test(plain)) {
    return { ok: false, reason: '密碼不得為單一字元重複' };
  }
  return { ok: true };
}

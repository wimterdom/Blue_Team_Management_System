/** MAC 配發廠商查詢。資產系統填入或匯入 MAC 時用來自動帶出製造商。 */
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lookupMac, ouiStatus, resetOuiCache } from '../lib/oui.js';
import { requirePerm } from '../middleware/rbac.js';
import { audit, reqMeta } from '../lib/audit.js';
import { badRequest, unauthorized } from '../lib/errors.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');

export default async function ouiRoutes(app) {
  app.get('/oui', async req => {
    if (!req.user) throw unauthorized();
    const mac = req.query?.mac;
    if (!mac) throw badRequest('需指定 mac 參數', 'missing_mac');
    return { mac, match: lookupMac(mac) };
  });

  /** 匯入時一次查一整批，省去逐筆往返。 */
  app.post('/oui/batch', async req => {
    if (!req.user) throw unauthorized();
    const macs = req.body?.macs;
    if (!Array.isArray(macs)) throw badRequest('需提供 macs 陣列', 'missing_macs');
    if (macs.length > 2000) throw badRequest('單次上限 2000 筆', 'too_many');
    const out = {};
    for (const m of macs) out[m] = lookupMac(m);
    return { results: out };
  });

  app.get('/oui/status', async req => {
    if (!req.user) throw unauthorized();
    return ouiStatus();
  });

  /**
   * 向 IEEE 查有無更新，有的話更新本機資料。
   *
   * 需要容器能連外；內網封閉環境請改在有網路的機器上執行
   * scripts/update-oui.mjs，再把 seed/ 下的檔案帶進來。
   */
  app.post('/oui/refresh', { preHandler: requirePerm('admin') }, async req => {
    const check = req.query?.check === 'true';
    const args = [resolve(root, 'scripts/update-oui.mjs')];
    if (check) args.push('--check');

    const result = await new Promise(res => {
      const p = spawn(process.execPath, args, { cwd: root });
      let out = '';
      let err = '';
      p.stdout.on('data', d => { out += d; });
      p.stderr.on('data', d => { err += d; });
      p.on('error', e => res({ code: -1, out, err: e.message }));
      p.on('close', code => res({ code, out, err }));
      setTimeout(() => { try { p.kill(); } catch { /* 已結束 */ } }, 180000);
    });

    if (!check && result.code === 0) resetOuiCache();

    audit({
      ...reqMeta(req), action: 'oui_refresh',
      summary: check
        ? `檢查 IEEE OUI 更新：${result.code === 10 ? '有新版' : '已是最新'}`
        : `更新 IEEE OUI 資料（離開碼 ${result.code}）`,
    });

    return {
      checkedOnly: check,
      // 離開碼 10 是 --check 的約定：代表官方有更新
      updateAvailable: result.code === 10,
      ok: result.code === 0 || result.code === 10,
      output: (result.out + result.err).trim().split('\n').slice(-20).join('\n'),
      status: ouiStatus(),
    };
  });
}

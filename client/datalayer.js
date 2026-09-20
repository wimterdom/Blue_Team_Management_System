/* ============================================================
   資料存取層
   ------------------------------------------------------------
   同一份介面有兩種實作，由建置腳本在產生輸出時擇一嵌入：

     server — 正式部署。所有讀寫走 /api/v1，資料存在伺服器的
              SQLite，逐筆寫入並帶版本號，30 人同時編輯互不覆蓋；
              異動經 SSE 即時推播給其他人。

     demo   — 靜態單檔展示（Artifact）。同樣的介面改以 localStorage
              實作，無需後端即可完整操作 UI，供驗收與修正使用。

   上層所有畫面只呼叫 STORE.*，不知道也不在意目前是哪一種。
   ============================================================ */
const MODE = '__BTMS_MODE__';
const IS_SERVER = MODE === 'server';

const SEED = {
  cases: JSON.parse(JSON.stringify(CASES)),
  detail: JSON.parse(JSON.stringify(DETAIL)),
  users: JSON.parse(JSON.stringify(USERS)),
  stats: { ...STATS },
  verdict: JSON.parse(JSON.stringify(VERDICT_DIST)),
  trend: JSON.parse(JSON.stringify(TREND)),
  requests: JSON.parse(JSON.stringify(REQUESTS)),
  rdetail: JSON.parse(JSON.stringify(RDETAIL)),
  assets: JSON.parse(JSON.stringify(ASSETS)),
  adetail: JSON.parse(JSON.stringify(ADETAIL)),
  sensors: JSON.parse(JSON.stringify(SENSORS)),
  apts: JSON.parse(JSON.stringify(APTS)),
  intels: JSON.parse(JSON.stringify(INTELS)),
  hunts: JSON.parse(JSON.stringify(HUNTS)),
};

/* 用戶端狀態鍵 ↔ 伺服器集合代碼。順序即寫入順序：
   母紀錄先於 detail，避免 detail 先到而找不到擁有者。 */
const COLL = [
  ['cases', 'cases', 'list'],
  ['case_detail', 'detail', 'map'],
  ['requests', 'requests', 'list'],
  ['request_detail', 'rdetail', 'map'],
  ['assets', 'assets', 'list'],
  ['asset_detail', 'adetail', 'map'],
  ['sensors', 'sensors', 'list'],
  ['apts', 'apts', 'list'],
  ['intels', 'intels', 'list'],
  ['hunts', 'hunts', 'list'],
  ['ttp_marks', 'marks', 'list'],
];

const LIVE = {
  cases: CASES, detail: DETAIL, requests: REQUESTS, rdetail: RDETAIL,
  assets: ASSETS, adetail: ADETAIL, sensors: SENSORS,
  apts: APTS, intels: INTELS, hunts: HUNTS, marks: TTP_MARKS,
};

function replaceAll(target, src) {
  if (Array.isArray(target)) { target.length = 0; target.push(...(src || [])); }
  else { Object.keys(target).forEach(k => delete target[k]); Object.assign(target, src || {}); }
}

function applyTree(data) {
  for (const [, key] of COLL) {
    if (data[key] !== undefined) replaceAll(LIVE[key], data[key]);
  }
}

function applyDashboard(d) {
  if (!d) return;
  Object.assign(STATS, d.stats || {});
  if (Array.isArray(d.verdict)) d.verdict.forEach((x, i) => { if (VERDICT_DIST[i]) VERDICT_DIST[i].v = x.v; });
  if (Array.isArray(d.trend)) {
    TREND.length = 0;
    TREND.push(...d.trend);
  }
}

/* TTP_MARKS 在原型裡沒有 id，改以內容雜湊當識別碼，同步時才能對得起來 */
function markId(m) {
  return 'MARK-' + String(m.ttp || '').replace(/[^A-Za-z0-9.]/g, '') + '-' + String(m.by || 'x');
}
function ensureMarkIds() {
  TTP_MARKS.forEach(m => { if (!m.id) m.id = markId(m); });
}

/* ---- 快照：用來比對出「哪幾筆真的變了」 ---- */
function snapshot() {
  ensureMarkIds();
  const out = {};
  for (const [coll, key, kind] of COLL) {
    const bucket = (out[coll] = {});
    const src = LIVE[key];
    if (kind === 'map') {
      for (const [id, v] of Object.entries(src)) bucket[id] = JSON.stringify(v);
    } else {
      for (const v of src) if (v && v.id) bucket[v.id] = JSON.stringify(v);
    }
  }
  return out;
}

function diffOps(before, after, versions) {
  const ops = [];
  for (const [coll] of COLL) {
    const b = before[coll] || {}, a = after[coll] || {};
    for (const [id, json] of Object.entries(a)) {
      if (b[id] !== json) {
        ops.push({ collection: coll, id, op: 'upsert', data: JSON.parse(json), version: versions[coll]?.[id] });
      }
    }
    for (const id of Object.keys(b)) {
      if (!(id in a)) ops.push({ collection: coll, id, op: 'delete' });
    }
  }
  return ops;
}

/* ============================================================
   伺服器實作
   ============================================================ */
function ServerStore() {
  let csrf = null;
  let shadow = null;
  const versions = {};
  let queued = null;
  let inflight = null;
  let es = null;

  async function call(path, { method = 'GET', body, raw, headers = {} } = {}) {
    const opt = { method, credentials: 'same-origin', headers: { ...headers } };
    if (body !== undefined) {
      if (raw) opt.body = body;
      else { opt.headers['content-type'] = 'application/json'; opt.body = JSON.stringify(body); }
    }
    if (csrf && method !== 'GET') opt.headers['x-btms-csrf'] = csrf;

    const res = await fetch('/api/v1' + path, opt);
    const ct = res.headers.get('content-type') || '';
    const payload = ct.includes('application/json') ? await res.json() : await res.text();
    if (!res.ok) {
      const e = new Error(payload?.error?.message || `伺服器回應 ${res.status}`);
      e.code = payload?.error?.code || String(res.status);
      e.status = res.status;
      e.details = payload?.error?.details;
      throw e;
    }
    return payload;
  }

  function applyBootstrap(b) {
    applyTree(b.data);
    for (const k of Object.keys(versions)) delete versions[k];
    Object.assign(versions, b.versions || {});
    applyDashboard(b.dashboard);
    replaceAll(TTP_HIDDEN, b.settings?.ttpHidden || {});
    replaceAll(USERS, Object.fromEntries((b.users || []).map(u => [u.id, u])));
    shadow = snapshot();
  }

  return {
    mode: 'server',

    async session() {
      try {
        const r = await call('/auth/me');
        csrf = r.csrfToken;
        return r.user;
      } catch { return null; }
    },

    async login(username, password) {
      const r = await call('/auth/login', { method: 'POST', body: { username, password } });
      csrf = r.csrfToken;
      return r.user;
    },

    async logout() {
      try { await call('/auth/logout', { method: 'POST' }); } catch { /* 仍要清除本地狀態 */ }
      csrf = null; shadow = null;
      if (es) { es.close(); es = null; }
    },

    async changePassword(currentPassword, newPassword) {
      return call('/auth/password', { method: 'POST', body: { currentPassword, newPassword } });
    },

    async authMethods() {
      try { return await call('/auth/methods'); } catch { return { providers: [], ssoEnabled: false }; }
    },

    async load() {
      applyBootstrap(await call('/bootstrap'));
    },

    async reload() {
      applyBootstrap(await call('/bootstrap'));
    },

    /** 取得系統配發的下一個編號，避免多人同時建立撞號。 */
    async nextId(coll) {
      const r = await call('/next-id/' + coll);
      return r.id;
    },

    /**
     * 把記憶體中的異動推上伺服器。
     * 上層沿用原本的 persist() 呼叫方式，這裡負責比對出差異、
     * 合併連續呼叫，並在版本衝突時提示使用者重新載入。
     */
    flush() {
      if (!shadow) return Promise.resolve();
      if (inflight) { queued = true; return inflight; }

      const after = snapshot();
      const ops = diffOps(shadow, after, versions);
      if (!ops.length) return Promise.resolve();

      inflight = (async () => {
        try {
          const r = await call('/sync', { method: 'POST', body: { ops } });
          for (const res of r.results) {
            if (res.ok && res.version !== undefined) {
              (versions[res.collection] ||= {})[res.id] = res.version;
            }
          }
          shadow = snapshot();
          applyDashboard(r.dashboard);

          const conflicts = r.results.filter(x => !x.ok && x.code === 'version_conflict');
          const denied = r.results.filter(x => !x.ok && x.code === 'forbidden');
          if (conflicts.length) {
            toast(`有 ${conflicts.length} 筆資料已被其他人修改，正在重新載入`);
            await this.reload();
            render();
          } else if (denied.length) {
            toast(denied[0].message || '權限不足，部分變更未儲存');
            await this.reload();
            render();
          } else {
            const other = r.results.filter(x => !x.ok);
            if (other.length) toast(other[0].message || '部分變更未能儲存');
          }
        } catch (err) {
          toast(err.status === 401 ? '登入已逾時，請重新登入' : `儲存失敗：${err.message}`);
          if (err.status === 401) { S.me = null; S.route = 'login'; render(); }
        } finally {
          inflight = null;
          if (queued) { queued = false; this.flush(); }
        }
      })();
      return inflight;
    },

    async saveTtpHidden() {
      try { await call('/settings/ttp-hidden', { method: 'PUT', body: { ...TTP_HIDDEN } }); }
      catch (err) { toast('顯示設定儲存失敗：' + err.message); }
    },

    /* ---- 附件 ---- */
    async uploadImages(collection, recordId, files) {
      const fd = new FormData();
      fd.append('collection', collection);
      fd.append('recordId', recordId);
      for (const f of files) fd.append('file', f, f.name);
      const r = await call('/attachments', { method: 'POST', body: fd, raw: true });
      return r.attachments;
    },
    async listImages(collection, recordId) {
      const r = await call(`/attachments?collection=${encodeURIComponent(collection)}&recordId=${encodeURIComponent(recordId)}`);
      return r.attachments;
    },
    async deleteImage(id) {
      return call('/attachments/' + encodeURIComponent(id), { method: 'DELETE' });
    },

    /* ---- 帳號管理 ---- */
    users: {
      list: () => call('/users'),
      create: u => call('/users', { method: 'POST', body: u }),
      update: (id, u) => call('/users/' + encodeURIComponent(id), { method: 'PUT', body: u }),
      remove: id => call('/users/' + encodeURIComponent(id), { method: 'DELETE' }),
    },

    /* ---- 稽核 ---- */
    audit: {
      list: q => call('/audit?' + new URLSearchParams(q).toString()),
      actions: () => call('/audit/actions'),
    },

    /* ---- 即時推播 ---- */
    subscribe(onChange) {
      if (es) es.close();
      es = new EventSource('/api/v1/events', { withCredentials: true });
      let pending = null;
      const debounce = () => {
        clearTimeout(pending);
        pending = setTimeout(() => onChange(), 400);
      };
      es.addEventListener('record', debounce);
      es.addEventListener('users', debounce);
      es.addEventListener('settings', debounce);
      es.onerror = () => { /* EventSource 會自行重連 */ };
      return () => { es?.close(); es = null; };
    },
  };
}

/* ============================================================
   展示實作（localStorage）
   ============================================================ */
function DemoStore() {
  const LS_DATA = 'btms.demo.v1', LS_SESSION = 'btms.demo.session.v1';
  let warned = false;

  const write = () => {
    try {
      ensureMarkIds();
      localStorage.setItem(LS_DATA, JSON.stringify({
        v: 1, cases: CASES, detail: DETAIL, users: USERS,
        requests: REQUESTS, rdetail: RDETAIL, assets: ASSETS, adetail: ADETAIL,
        sensors: SENSORS, apts: APTS, intels: INTELS, hunts: HUNTS,
        marks: TTP_MARKS, ttpHidden: TTP_HIDDEN,
      }));
    } catch (e) {
      if (!warned) { warned = true; toast('瀏覽器儲存空間不足，本次變更僅保留在記憶體中'); }
    }
  };

  const recompute = () => {
    const occ = c => (Array.isArray(c.occur) ? c.occur[0] : c.occurStart) || c.created || '';
    const day = v => String(v || '').slice(0, 10);
    STATS.total = CASES.length;
    STATS.active = CASES.filter(c => c.progress === '進行中').length;
    STATS.malicious = CASES.filter(c => c.verdict === '惡意行為').length;
    const wk = day(new Date(Date.now() - 6 * 86400000).toISOString());
    STATS.week = CASES.filter(c => day(occ(c)) >= wk).length;
    const n = k => CASES.filter(c => c.verdict === k).length;
    VERDICT_DIST[0].v = n('惡意行為');
    VERDICT_DIST[1].v = n('授權行為');
    VERDICT_DIST[2].v = n('正常行為');
    TREND.forEach(t => { t.v = CASES.filter(c => day(occ(c)) === t.date).length; });
  };

  return {
    mode: 'demo',

    async session() {
      try {
        const raw = localStorage.getItem(LS_SESSION);
        if (!raw) return null;
        const [who, app] = raw.split('|');
        if (!USERS[who]) return null;
        S.app = APPS[app] ? app : 'cases';
        return { ...USERS[who], mustChangePassword: false };
      } catch { return null; }
    },

    /** 展示模式不做身分驗證：選一個職務即可進入，登入頁不顯示任何帳密。 */
    async login(username) {
      const u = USERS[username];
      if (!u) { const e = new Error('找不到此示範身分'); e.code = 'invalid_credentials'; throw e; }
      try { localStorage.setItem(LS_SESSION, u.id + '|' + S.app); } catch { /* 無痕模式忽略 */ }
      return { ...u, mustChangePassword: false };
    },

    async logout() {
      try { localStorage.removeItem(LS_SESSION); } catch { /* 忽略 */ }
    },

    async changePassword() { return { ok: true }; },
    async authMethods() { return { providers: [{ id: 'demo', kind: 'demo' }], ssoEnabled: false }; },

    async load() {
      let raw = null;
      try { raw = localStorage.getItem(LS_DATA); } catch { /* 忽略 */ }
      if (raw) {
        try {
          const d = JSON.parse(raw);
          if (d.v === 1 && Array.isArray(d.cases) && d.users) {
            applyTree(d);
            replaceAll(USERS, d.users);
            replaceAll(TTP_MARKS, d.marks || []);
            replaceAll(TTP_HIDDEN, d.ttpHidden || {});
          }
        } catch { /* 毀損就沿用種子資料 */ }
      }
      recompute();
    },

    async reload() { recompute(); },

    async nextId(coll) {
      const map = { cases: ['CASE', CASES], apts: ['APT', APTS], intels: ['INTEL', INTELS], hunts: ['HUNT', HUNTS] };
      const [prefix, arr] = map[coll] || ['ID', []];
      const max = arr.reduce((m, x) => {
        const n = Number(String(x.id || '').split('-')[1]);
        return Number.isFinite(n) ? Math.max(m, n) : m;
      }, 0);
      return `${prefix}-${String(max + 1).padStart(4, '0')}`;
    },

    flush() { write(); recompute(); return Promise.resolve(); },
    async saveTtpHidden() { write(); },

    /** 展示模式沒有伺服器可放檔案，縮成 data URL 隨資料一起保存。 */
    async uploadImages(collection, recordId, files) {
      const out = [];
      for (const f of files) {
        const url = await toThumbURL(f);
        out.push({ id: 'demo-' + Math.random().toString(36).slice(2), filename: f.name, url, mime: f.type });
      }
      return out;
    },
    async listImages() { return []; },
    async deleteImage() { return { ok: true }; },

    users: {
      async list() {
        return { users: Object.values(USERS).map(u => ({ ...u, disabled: !!u.disabled, hasPassword: true })), roles: ROLES, perms: Object.keys(PERMS) };
      },
      async create(u) { USERS[u.id] = { id: u.id, name: u.name, role: u.role, perm: u.perm }; write(); return USERS[u.id]; },
      async update(id, u) { Object.assign(USERS[id], u); write(); return USERS[id]; },
      async remove(id) { delete USERS[id]; write(); return { ok: true }; },
    },

    audit: {
      async list() { return { total: 0, items: [] }; },
      async actions() { return { actions: [] }; },
    },

    subscribe() { return () => {}; },

    /** 展示模式專屬：回到出廠資料。 */
    reset() {
      applyTree(SEED);
      replaceAll(USERS, JSON.parse(JSON.stringify(SEED.users)));
      TTP_MARKS.length = 0;
      Object.keys(TTP_HIDDEN).forEach(k => delete TTP_HIDDEN[k]);
      try { localStorage.removeItem(LS_DATA); } catch { /* 忽略 */ }
      recompute();
      if (!USERS[S.me]) S.me = null;
    },
  };
}

const STORE = IS_SERVER ? ServerStore() : DemoStore();

/** 上層沿用的儲存入口。所有畫面呼叫 persist() 的地方都不必改。 */
function persist() { return STORE.flush(); }
const saveSession = () => {};

function resetDemoData() {
  if (STORE.mode !== 'demo') return;
  STORE.reset();
  closeOverlay(); render();
  toast('已重設為預設示範資料');
}

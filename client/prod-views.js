/* ============================================================
   正式版專屬畫面：變更密碼、稽核紀錄
   ============================================================ */

/**
 * 變更密碼。首次登入時由伺服器強制導向此畫面，
 * 未完成變更之前 API 一律擋下，無法略過。
 */
function viewPwChange(){
  const forced = !!USERS[S.me]?.mustChangePassword || S.pwForced;
  const box = el('div',{class:'wrap', style:'max-width:520px;padding-top:38px'},
    el('section',{class:'card sec'},
      el('h3',{}, forced ? '首次登入，請變更密碼' : '變更密碼'),
      el('p',{style:'font-size:12.5px;color:var(--ink-2);line-height:1.75;margin:6px 0 16px'},
        forced
          ? '此帳號目前使用的是管理員配發的初始密碼。為確保「誰改了什麼」的紀錄確實對應到本人，請先設定只有你知道的密碼。'
          : '變更後，此帳號在其他裝置上的登入狀態會一併失效，需重新登入。'),
      el('div',{class:'form-grid'},
        el('div',{class:'field full'},
          el('label',{for:'pw-cur'},'目前密碼',el('span',{class:'req'},'*')),
          el('input',{class:'inp', id:'pw-cur', type:'password', autocomplete:'current-password'})),
        el('div',{class:'field full'},
          el('label',{for:'pw-new'},'新密碼',el('span',{class:'req'},'*')),
          el('input',{class:'inp', id:'pw-new', type:'password', autocomplete:'new-password',
            oninput:paintPwMeter}),
          el('div',{class:'pwmeter', id:'pw-meter'}, el('i',{}), el('i',{}), el('i',{}), el('i',{})),
          el('span',{class:'hint', id:'pw-hint'},
            '至少 12 個字元。中日韓文字以兩個字元計，但實際不得少於 8 字。不得包含帳號或姓名，也不要用常見字加數字。')),
        el('div',{class:'field full'},
          el('label',{for:'pw-c2'},'再輸入一次新密碼',el('span',{class:'req'},'*')),
          el('input',{class:'inp', id:'pw-c2', type:'password', autocomplete:'new-password',
            onkeydown:e=>{if(e.key==='Enter')submitPwChange();}}))),
      el('p',{id:'pw-err', class:'login-err hidden', style:'margin-top:10px'}),
      el('div',{style:'display:flex;gap:8px;margin-top:16px'},
        el('button',{class:'btn btn-primary', id:'pw-btn', onclick:submitPwChange},
          el('span',{html:svgIcon(I.check)}),'變更密碼'),
        forced
          ? el('button',{class:'btn', onclick:doLogout},'改用其他帳號登入')
          : el('button',{class:'btn', onclick:()=>go('dashboard')},'取消'))));
  setTimeout(()=>$('#pw-cur')?.focus(),0);
  return box;
}

/* 強度提示只是給使用者的參考，真正的把關在伺服器端。 */
function pwScore(v){
  if(!v) return 0;
  let n = 0;
  const len = [...v].length;
  // 用 \u 逃脫而非字面字元：若頁面被以非 UTF-8 解讀，字面範圍會變成亂碼而丟出 SyntaxError
  const cjk = /[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/.test(v);
  if(len >= (cjk ? 6 : 12)) n++;
  if(len >= (cjk ? 9 : 16)) n++;
  if(/[a-z]/.test(v) && /[A-Z]/.test(v) || cjk) n++;
  if(/\d/.test(v) && /[^\w\s]/.test(v)) n++;
  if(/^(.)\1+$/.test(v)) n = 0;
  return Math.min(4, n);
}
function paintPwMeter(){
  const v = $('#pw-new')?.value || '';
  const n = pwScore(v);
  const bars = $('#pw-meter')?.children;
  if(!bars) return;
  const label = ['','太弱','尚可','良好','很好'][n];
  [...bars].forEach((b,i)=>{ b.dataset.on = i < n ? '1' : '0'; b.dataset.lvl = n; });
  const hint = $('#pw-hint');
  if(hint && v) hint.textContent = `目前強度：${label}。至少 12 個字元（中日韓文字以兩個字元計），不得包含帳號或姓名。`;
}

async function submitPwChange(){
  const cur=$('#pw-cur').value, nw=$('#pw-new').value, c2=$('#pw-c2').value;
  const err=$('#pw-err'), btn=$('#pw-btn');
  const fail=m=>{ err.textContent=m; err.classList.remove('hidden'); btn.disabled=false;
                  btn.innerHTML=''; btn.append(el('span',{html:svgIcon(I.check)}),'變更密碼'); };
  if(!cur || !nw) return fail('請填寫目前密碼與新密碼。');
  if(nw !== c2)   return fail('兩次輸入的新密碼不一致。');
  if(nw === cur)  return fail('新密碼不得與目前密碼相同。');

  err.classList.add('hidden');
  btn.disabled=true; btn.textContent='處理中…';
  try{
    await STORE.changePassword(cur, nw);
    if(USERS[S.me]) USERS[S.me].mustChangePassword=false;
    S.pwForced=false;
    await STORE.load();
    S.route='dashboard'; render(); subscribeLive();
    toast('密碼已變更，其他裝置上的登入已失效');
  }catch(e){
    fail(e.message || '變更失敗，請稍後再試。');
  }
}

/* ============================================================
   稽核紀錄（僅系統管理員）
   ============================================================ */
const AUDIT_LABEL = {
  login:'登入', login_failed:'登入失敗', logout:'登出',
  password_changed:'變更密碼', password_change_failed:'變更密碼失敗',
  create:'建立', update:'更新', delete:'刪除',
  user_create:'建立帳號', user_update:'變更帳號', user_delete:'刪除帳號',
  user_disable:'停用帳號', user_sessions_revoked:'強制登出',
  attachment_upload:'上傳附件', attachment_delete:'刪除附件',
  settings_update:'變更設定', bootstrap_admin:'建立初始管理員', seed_demo:'載入示範資料',
};
const AUDIT_TONE = {
  login_failed:'var(--critical)', password_change_failed:'var(--critical)',
  delete:'var(--serious)', user_delete:'var(--serious)', attachment_delete:'var(--serious)',
  create:'var(--good)', user_create:'var(--good)',
};

function viewAudit(){
  const page = el('div',{class:'wrap'},
    el('div',{class:'pagehead'},
      el('div',{},
        el('div',{class:'eyebrow'},'系統管理'),
        el('h1',{},'稽核紀錄'),
        el('p',{class:'lead'},
          '每一次登入、建立、修改與刪除都留下紀錄，含異動欄位的前後值。' +
          '規格要求「帳號即是誰改了什麼的憑據」，這裡就是該憑據的查詢入口。')),
      el('div',{class:'pagehead-act'},
        el('button',{class:'btn', onclick:()=>{ location.href='/api/v1/audit.csv'; }},
          el('span',{html:svgIcon(I.download)}),'匯出 CSV'))),

    el('div',{class:'card', style:'overflow:visible'},
      el('div',{class:'filters'},
        el('input',{class:'inp', id:'au-q', placeholder:'帳號或紀錄編號…', style:'max-width:200px',
          onkeydown:e=>{if(e.key==='Enter')loadAudit(1);}}),
        el('select',{class:'inp', id:'au-act', style:'max-width:170px', onchange:()=>loadAudit(1)},
          el('option',{value:''},'全部動作'),
          ...Object.entries(AUDIT_LABEL).map(([k,v])=>el('option',{value:k},v))),
        el('select',{class:'inp', id:'au-coll', style:'max-width:170px', onchange:()=>loadAudit(1)},
          el('option',{value:''},'全部集合'),
          ...[['cases','調查報告'],['requests','請求表'],['assets','資產'],
              ['sensors','感測器'],['apts','APT 報告'],['intels','情資報告'],
              ['hunts','獵補計畫'],['users','帳號']]
            .map(([k,v])=>el('option',{value:k},v))),
        el('select',{class:'inp', id:'au-per', style:'max-width:130px', onchange:()=>loadAudit(1)},
          ...[25,50,100,200].map(n=>el('option',{value:n, selected:n===50?'':null},`每頁 ${n}`))),
        el('button',{class:'btn btn-sm', onclick:()=>loadAudit(1)},
          el('span',{html:svgIcon(I.search)}),'查詢')),
      el('div',{class:'tablewrap'},
        el('table',{class:'tbl'},
          el('thead',{}, el('tr',{},
            ...['時間','帳號','動作','對象','摘要','來源 IP'].map(h=>el('th',{},h)))),
          el('tbody',{id:'au-body'},
            el('tr',{}, el('td',{colspan:6, style:'padding:22px;text-align:center;color:var(--ink-3)'},'載入中…'))))),
      el('div',{class:'pager', id:'au-pager'})));

  setTimeout(()=>loadAudit(1),0);
  return page;
}

let auditPage = 1;
async function loadAudit(page){
  auditPage = page || 1;
  const per = Number($('#au-per')?.value || 50);
  const q = ($('#au-q')?.value || '').trim();
  const query = { limit: per, offset: (auditPage-1)*per };
  if($('#au-act')?.value)  query.action = $('#au-act').value;
  if($('#au-coll')?.value) query.collection = $('#au-coll').value;
  // 同一個輸入框同時比對帳號與紀錄編號：有連字號的看起來就是編號
  if(q) { if(/-/.test(q)) query.recordId = q; else query.user = q; }

  const body = $('#au-body'); if(!body) return;
  let r;
  try{ r = await STORE.audit.list(query); }
  catch(e){
    body.innerHTML='';
    body.append(el('tr',{}, el('td',{colspan:6, style:'padding:22px;text-align:center;color:var(--critical)'},
      '載入失敗：'+e.message)));
    return;
  }

  body.innerHTML='';
  if(!r.items.length){
    body.append(el('tr',{}, el('td',{colspan:6, style:'padding:22px;text-align:center;color:var(--ink-3)'},
      '沒有符合條件的稽核紀錄。')));
  }
  for(const x of r.items){
    const tr = el('tr',{},
      el('td',{}, el('span',{class:'mono', style:'font-size:11.5px'}, x.ts.replace('T',' ').slice(0,19))),
      el('td',{}, el('span',{class:'mono', style:'font-size:11.5px'}, x.userId || '—')),
      el('td',{}, el('span',{class:'chip', style:`--kc:${AUDIT_TONE[x.action]||'var(--ink-3)'}`},
        el('i',{class:'dot', style:`background:${AUDIT_TONE[x.action]||'var(--rule-2)'}`}),
        AUDIT_LABEL[x.action] || x.action)),
      el('td',{}, x.recordId
        ? el('span',{class:'cid'}, x.recordId)
        : el('span',{style:'color:var(--ink-3)'},'—')),
      el('td',{}, el('div',{class:'ctitle', style:'max-width:420px'}, x.summary || '')),
      el('td',{}, el('span',{class:'mono', style:'font-size:11px;color:var(--ink-3)'}, x.ip || '—')));

    if(x.changes && Object.keys(x.changes).length){
      tr.style.cursor='pointer';
      tr.title='點擊展開異動欄位';
      tr.onclick=()=>toggleAuditDetail(tr, x);
    }
    body.append(tr);
  }

  const pager = $('#au-pager'); pager.innerHTML='';
  const pages = Math.max(1, Math.ceil(r.total / per));
  const start = r.total ? (auditPage-1)*per + 1 : 0;
  pager.append(
    el('span',{class:'pagenote'}, r.total
      ? `顯示第 ${start}–${Math.min(start+per-1, r.total)} 筆，共 ${r.total} 筆` : '無紀錄'),
    el('span',{class:'spacer'}),
    el('button',{class:'btn btn-sm', disabled:auditPage<=1?true:null, onclick:()=>loadAudit(auditPage-1)},'上一頁'),
    el('span',{class:'pagenote'}, `${auditPage} / ${pages}`),
    el('button',{class:'btn btn-sm', disabled:auditPage>=pages?true:null, onclick:()=>loadAudit(auditPage+1)},'下一頁'));
}

function toggleAuditDetail(tr, x){
  const next = tr.nextElementSibling;
  if(next && next.dataset.detail === '1'){ next.remove(); return; }
  const rows = Object.entries(x.changes).map(([k,v])=>el('div',{class:'chg'},
    el('span',{class:'chg-k'}, k),
    el('span',{class:'chg-from'}, v.from === undefined ? '（原無此欄）' : String(v.from)),
    el('span',{class:'chg-arrow'},'→'),
    el('span',{class:'chg-to'}, v.to === undefined ? '（已移除）' : String(v.to))));
  const det = el('tr',{'data-detail':'1'},
    el('td',{colspan:6, style:'background:var(--surface-2);padding:12px 16px'},
      el('div',{class:'eyebrow', style:'margin-bottom:8px'},'異動欄位'),
      el('div',{class:'chglist'}, ...rows)));
  tr.after(det);
}

/* ============================================================
   外部資料來源（僅系統管理員）
   ============================================================ */

/**
 * 系統有兩份來自外部的參照資料：IEEE 的 MAC 配發登錄檔，以及 MITRE 的
 * ATT&CK 技術表。兩者都會更新，本機副本放久了就會與官方脫節。
 * 這一區讓管理員看得到目前用的是哪一版、何時取得，並直接檢查與更新。
 */
function viewDataSources() {
  const page = el('div', { class: 'wrap' },
    el('div', { class: 'pagehead' },
      el('div', {},
        el('div', { class: 'eyebrow' }, '系統管理'),
        el('h1', {}, '外部資料來源'),
        el('p', { class: 'lead' },
          '比對一律在本機進行——系統可能部署在不能連外的環境，' +
          '而且每查一個 MAC 就打一次外部網站既慢又會把內部資產資訊送出去。' +
          '這裡檢查官方有無更新，並把本機副本換成新版。'))),
    el('div', { id: 'ds-body' },
      el('p', { class: 'hint', style: 'padding:14px 0' }, '載入中…')));
  setTimeout(loadDataSources, 0);
  return page;
}

async function loadDataSources() {
  const host = $('#ds-body');
  if (!host) return;
  let oui = null;
  try { oui = await STORE.oui.status(); } catch (e) { /* 顯示為不可用 */ }

  host.innerHTML = '';
  host.append(
    el('section', { class: 'card sec' },
      el('h3', {}, 'IEEE MAC 位址配發登錄檔'),
      el('p', { style: 'font-size:12.5px;color:var(--ink-2);line-height:1.75;margin:4px 0 12px' },
        '資產填入 MAC 後自動帶出製造商與國別。收錄 MA-L（/24）、MA-M（/28）與 MA-S（/36）三個登錄檔，' +
        '查詢時由長前綴往短的找，小廠商拿到的區段才不會被持有整段的大廠蓋掉。'),
      el('div', { class: 'meta' },
        row('來源', el('span', { class: 'mono', style: 'font-size:11.5px' }, 'standards-oui.ieee.org')),
        row('本機筆數', el('span', { class: 'tnum' }, oui ? oui.loaded.toLocaleString() : '—'),
          oui?.subset ? '展示版使用子集' : '完整登錄檔'),
        row('取得日期', el('span', { class: 'mono', style: 'font-size:12px' }, oui?.retrieved || '—')),
        row('查得到國別', el('span', { class: 'tnum' }, oui?.withCountry ? oui.withCountry.toLocaleString() : '—'))),
      el('p', { style: 'font-size:11.5px;color:var(--ink-3);margin-top:10px;line-height:1.7' },
        '登錄檔記的是「註冊地址」的國別，不一定等於品牌母國——TP-Link 有 79 個前綴登記在美國、' +
        'Lenovo 有 142 個。資產的「製造商（國家）」是用來辨識設備來源的，' +
        '因此系統對知名品牌另以母國為準（對照表在 seed/vendor-origin.json），' +
        '查詢結果會同時回傳登錄國別，判斷依據不會被藏起來。'),
      el('div', { style: 'display:flex;gap:8px;margin-top:14px;align-items:center;flex-wrap:wrap' },
        el('button', { class: 'btn', id: 'ds-check', onclick: () => refreshOui(true) },
          el('span', { html: svgIcon(I.search) }), '檢查有無更新'),
        el('button', { class: 'btn btn-primary', id: 'ds-update', onclick: () => refreshOui(false) },
          el('span', { html: svgIcon(I.download) }), '立即更新本機資料'),
        el('span', { class: 'hint', id: 'ds-msg' }, '需要容器能連外；封閉環境請在有網路的機器上執行 scripts/update-oui.mjs 後帶入 seed/')),
      el('pre', { class: 'file-pre hidden', id: 'ds-out', style: 'margin-top:12px;max-height:240px' })),

    el('section', { class: 'card sec', style: 'margin-top:14px' },
      el('h3', {}, 'MITRE ATT&CK Enterprise'),
      el('p', { style: 'font-size:12.5px;color:var(--ink-2);line-height:1.75;margin:4px 0 12px' },
        '情資系統的 TTP Mapping 熱圖與各系統的技術挑選器都用這份技術表。'),
      el('div', { class: 'meta' },
        row('來源', el('span', { class: 'mono', style: 'font-size:11.5px' }, 'github.com/mitre-attack/attack-stix-data')),
        row('目前版本', el('span', { class: 'mono', style: 'font-size:12.5px' }, ATTACK_VERSION)),
        row('戰術', el('span', { class: 'tnum' }, String(ATTACK_FULL.length))),
        row('技術', el('span', { class: 'tnum' },
          String(ATTACK_FULL.reduce((n, t) => n + t.techs.length
            + t.techs.reduce((m, p) => m + p.subs.length, 0), 0)))),
        row('作廢編號對照', el('span', { class: 'tnum' }, String(Object.keys(ATTACK_REVOKED).length)),
          '載入舊資料時自動換成現行編號')),
      el('p', { style: 'font-size:11.5px;color:var(--ink-3);margin-top:10px;line-height:1.7' },
        '技術表與中文名稱是建置時產生的，更新需重新建置映像檔：在原始碼目錄執行 ' +
        el('code', {}, 'node scripts/update-attack.mjs').textContent +
        '（加 --check 只檢查有無新版，有新版以離開碼 10 回報，便於排程或 CI），' +
        '官方新增而尚未翻譯的技術會列出清單。')));
}

async function refreshOui(checkOnly) {
  const msg = $('#ds-msg');
  const pre = $('#ds-out');
  const btns = [$('#ds-check'), $('#ds-update')].filter(Boolean);
  btns.forEach(b => { b.disabled = true; });
  msg.textContent = checkOnly ? '檢查中…' : '更新中，IEEE 的檔案約 5 MB，請稍候…';
  try {
    const r = await STORE.oui.refresh(checkOnly);
    if (r.subset) { msg.textContent = '展示版使用內建子集，更新功能需在正式部署環境操作'; return; }
    msg.textContent = checkOnly
      ? (r.updateAvailable ? '官方已有更新，可按「立即更新本機資料」' : '本機資料與官方一致')
      : (r.ok ? '已更新完成' : '更新失敗，詳見下方輸出');
    if (r.output) { pre.classList.remove('hidden'); pre.textContent = r.output; }
    if (!checkOnly && r.ok) setTimeout(loadDataSources, 600);
  } catch (e) {
    msg.textContent = '操作失敗：' + e.message;
  } finally {
    btns.forEach(b => { b.disabled = false; });
  }
}

/* ============================================================
   專案封存與還原（僅系統管理員）
   ============================================================ */

const COLL_LABEL = {
  cases: '調查報告', case_detail: '報告內容', requests: '請求表',
  request_detail: '請求表內容', assets: '資產', asset_detail: '資產內容',
  sensors: '感測器佈署', apts: 'APT 組織報告', intels: '情資報告',
  hunts: '威脅獵補計畫', ttp_marks: 'TTP 標註',
};

/** 大小：小檔要看到小數才有意義，上 GB 的數字帶兩位小數只是雜訊。 */
const mb = n => {
  const m = n / 1048576;
  if (m >= 1024) return (m / 1024).toFixed(2) + ' GB';
  return (m >= 100 ? Math.round(m) : m.toFixed(2)) + ' MB';
};

/** 目前專案的規模，還原預覽時與封存檔並列比較。 */
let ARC_NOW = {};

function viewArchive() {
  const page = el('div', { class: 'wrap', style: 'max-width:900px' },
    el('div', { class: 'pagehead' },
      el('div', {},
        el('div', { class: 'eyebrow' }, '系統管理'),
        el('h1', {}, '專案封存'),
        el('p', { class: 'lead' },
          '把五套系統的全部資料與附件打包成一個 zip。' +
          '裡面同時放了給人看的 Markdown 樹狀目錄，與給機器看的 manifest.json——' +
          '前者不需要本系統也讀得懂，後者是還原時實際讀的那一份。'))),
    el('div', { id: 'arc-body' },
      el('p', { class: 'hint', style: 'padding:14px 0' }, '載入中…')));
  setTimeout(loadArchiveView, 0);
  return page;
}

async function loadArchiveView() {
  const host = $('#arc-body');
  if (!host) return;
  let st = null;
  let err = null;
  try { st = await STORE.archive.status(); } catch (e) { err = e; }

  if (!st) {
    // 兩種「做不到」要分清楚：展示版沒有後端，與帳號權限不足。
    // 一律顯示前者會讓分析員以為是系統壞了。
    const demo = STORE.mode !== 'server';
    host.innerHTML = '';
    host.append(el('section', { class: 'card sec' },
      el('h3', {}, demo ? '此環境無法使用' : '需要系統管理員權限'),
      el('p', { style: 'font-size:12.5px;color:var(--ink-2);line-height:1.75;margin-top:6px' },
        demo
          ? '封存需要伺服器端讀取附件的實體檔案並重建資料庫，展示版沒有後端可做。'
            + '請在正式部署環境操作。'
          : '專案封存與還原會一次動到全部資料，僅限系統管理員執行。'
            + '若你需要封存，請洽系統管理員。'),
      err && STORE.mode === 'server' && !/權限|403/.test(err.message)
        ? el('p', { class: 'hint', style: 'margin-top:8px' }, err.message)
        : null));
    return;
  }

  ARC_NOW = st;   // 還原預覽要拿它跟封存檔的筆數並列比較
  const total = Object.values(st.counts).reduce((a, b) => a + b, 0);
  const rows = Object.entries(COLL_LABEL)
    .filter(([k]) => st.counts[k])
    .map(([k, label]) => [label, String(st.counts[k])]);

  host.innerHTML = '';
  host.append(
    /* ---- 封存 ---- */
    el('section', { class: 'card sec' },
      el('h3', {}, '封存目前專案'),
      el('div', { class: 'arc-grid' },
        el('div', {},
          el('div', { class: 'eyebrow', style: 'margin-bottom:7px' }, '將被封存的資料'),
          el('table', { class: 'tbl spec-tbl' },
            el('tbody', {}, ...rows.map(r => el('tr', {},
              el('td', {}, r[0]),
              el('td', { style: 'text-align:right' }, el('span', { class: 'tnum' }, r[1]))))))),
        el('div', {},
          el('div', { class: 'meta' },
            row('紀錄總數', el('span', { class: 'tnum' }, String(total))),
            row('附件', el('span', { class: 'tnum' }, String(st.attachments)),
              st.attachmentBytes ? mb(st.attachmentBytes) : null),
            row('帳號', el('span', { class: 'tnum' }, String(st.users)), '不含密碼'),
            row('單片上限', el('span', {}, mb(st.volumeBytes)), '超過就自動分片'),
            st.lastRestore
              ? row('上次還原', el('span', { class: 'mono', style: 'font-size:11.5px' },
                  String(st.lastRestore.at).replace('T', ' ').slice(0, 16)))
              : null))),
      el('div', { class: 'field full', style: 'margin-top:14px' },
        el('label', { for: 'arc-note' }, '備註（寫進封存的 README，方便日後辨識）'),
        el('input', { class: 'inp', id: 'arc-note', maxlength: '500',
          placeholder: '例：2026 第四季結案封存' })),
      el('div', { style: 'display:flex;gap:9px;align-items:center;margin-top:13px;flex-wrap:wrap' },
        el('button', { class: 'btn btn-primary', id: 'arc-go', onclick: () => doArchive() },
          el('span', { html: svgIcon(I.download) }), '產生封存檔並下載'),
        el('span', { class: 'hint', id: 'arc-msg' },
          '資料量大時需要幾秒，請勿重複點擊'))),

    /* ---- 伺服器上已產生的封存 ----
       分片封存要下載好幾個檔案，中途斷掉一片就得全部重來。
       留在伺服器上，缺哪片補哪片。 */
    st.stored.length
      ? el('section', { class: 'card sec', style: 'margin-top:14px' },
          el('h3', {}, '伺服器上的封存'),
          el('p', { class: 'hint', style: 'margin:5px 0 11px' },
            `產生後保留 ${st.keepHours} 小時，供分片下載中斷時補抓；`
            + '之後會在下次封存時自動清除。'),
          ...st.stored.map(a => el('div', { class: 'arc-stored' },
            el('div', { style: 'min-width:0' },
              el('div', { style: 'font-size:12.5px' },
                String(a.createdAt).replace('T', ' ').slice(0, 16),
                el('span', { class: 'hint', style: 'margin-left:8px' },
                  `${a.parts.length} 片・${mb(a.bytes)}`)),
              el('div', { class: 'arc-parts' },
                ...a.parts.map(p => el('button', {
                  class: 'btn btn-sm', title: p.filename,
                  onclick: ev => downloadPart(ev.currentTarget, a.archiveId, p),
                }, a.parts.length > 1 ? `第 ${p.part} 片` : '下載', ' ',
                  el('span', { class: 'hint' }, mb(p.bytes)))))),
            el('button', { class: 'iconbtn', title: '刪除這份封存',
              html: svgIcon(I.trash),
              onclick: async () => {
                await STORE.archive.remove(a.archiveId);
                loadArchiveView();
              } }))))
      : null,

    /* ---- 還原 ---- */
    el('section', { class: 'card sec', style: 'margin-top:14px' },
      el('h3', {}, '匯入封存檔還原'),
      el('div', { class: 'arc-warn' },
        el('span', { html: svgIcon(I.shield) }),
        el('div', {},
          el('b', {}, '還原會清空目前所有業務資料'),
          el('div', { style: 'margin-top:4px;line-height:1.7' },
            '五套系統的紀錄與附件都會被封存檔的內容取代，這個動作沒有復原鍵。' +
            '系統會先問你要不要把目前的專案也封存一份。'),
          el('div', { style: 'margin-top:4px;line-height:1.7;color:var(--ink-3)' },
            '帳號不會被清除——封存檔裡有而目前沒有的帳號，會以「停用、無密碼、' +
            '一般分析員」補建，只為了讓報告的作者資訊對得上。'))),
      el('div', { class: 'dropzone', style: 'margin-top:13px', id: 'arc-drop',
        onclick: () => $('#arc-file').click(),
        ondragover: e => { e.preventDefault(); e.currentTarget.dataset.over = '1'; },
        ondragleave: e => { delete e.currentTarget.dataset.over; },
        ondrop: e => {
          e.preventDefault();
          delete e.currentTarget.dataset.over;
          const fs = [...e.dataTransfer.files];
          if (fs.length) inspectArchiveFiles(fs);
        } },
        el('span', { html: svgIcon(I.upload) }),
        el('div', {},
          el('div', { style: 'font-size:13px;font-weight:600' }, '選擇或拖曳封存 zip'),
          el('div', { style: 'font-size:11.5px;color:var(--ink-3);margin-top:3px' },
            '先讀取內容讓你確認，不會立刻動到資料。'
            + '分成多片的封存請一次選取全部')),
        el('input', { type: 'file', id: 'arc-file', accept: '.zip,application/zip',
          multiple: '', style: 'display:none',
          onchange: e => {
            const fs = [...e.target.files];
            if (fs.length) inspectArchiveFiles(fs);
          } })),
      el('div', { id: 'arc-preview' })));
}

/** 補抓單獨一片。 */
async function downloadPart(btn, archiveId, p) {
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = '下載中…';
  try {
    const { blob, filename } = await STORE.archive.part(archiveId, p.part);
    await saveBlob(blob, filename);
  } catch (e) {
    toast('下載失敗：' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

/**
 * 產生封存並下載。
 *
 * 資料超過單片上限時伺服器會切成多片，這裡逐片抓下來。一片一個請求、
 * 一片一次 saveBlob——幾 GB 的東西沒辦法塞進一個回應，瀏覽器也擋不住。
 */
async function doArchive() {
  const btn = $('#arc-go');
  const msg = $('#arc-msg');
  btn.disabled = true;
  msg.textContent = '封存中…';
  try {
    const { archiveId, parts, stats } = await STORE.archive.build($('#arc-note')?.value || '');

    for (const p of parts) {
      msg.textContent = parts.length > 1
        ? `下載第 ${p.part} 片／共 ${parts.length} 片（${mb(p.bytes)}）…`
        : '下載中…';
      const { blob, filename } = await STORE.archive.part(archiveId, p.part);
      await saveBlob(blob, filename);
    }

    const done = parts.length > 1
      ? `已產生 ${parts.length} 片、共 ${mb(stats.zipBytes)}。還原時要把所有片一起選取。`
      : `已產生 ${parts[0].filename}（${mb(stats.zipBytes)}）`;
    // 重新整理「伺服器上的封存」清單會重畫整個版面，連同這則訊息一起沖掉，
    // 所以等它畫完再寫回去
    await loadArchiveView();
    const after = $('#arc-msg');
    if (after) after.textContent = done;
    return true;
  } catch (e) {
    msg.textContent = '封存失敗：' + e.message;
    return false;
  } finally {
    // 成功時版面已重畫，btn 是舊節點；對新的那顆重新取一次
    const live = $('#arc-go') || btn;
    live.disabled = false;
  }
}

/** 先讀內容給人確認，這一步不動任何資料。files 可以是多片。 */
async function inspectArchiveFiles(files) {
  const host = $('#arc-preview');
  host.innerHTML = '';
  host.append(el('p', { class: 'hint', style: 'padding:10px 0' },
    files.length > 1 ? `讀取 ${files.length} 片封存檔…` : '讀取封存檔…'));

  let info;
  try {
    info = await STORE.archive.inspect(files);
  } catch (e) {
    host.innerHTML = '';
    // 缺片、混到別次封存的片，訊息本身就說明了該怎麼辦，照實顯示
    host.append(el('div', { class: 'arc-warn' },
      el('span', { html: svgIcon(I.shield) }),
      el('div', {},
        el('b', {}, '無法讀取'),
        el('div', { style: 'margin-top:4px;line-height:1.7' }, e.message))),
      el('p', { class: 'hint', style: 'margin-top:9px' },
        '已選 ' + files.length + ' 個檔案：'
        + files.map(f => f.name).join('、')));
    return;
  }

  const total = Object.values(info.counts).reduce((a, b) => a + b, 0);
  host.innerHTML = '';
  host.append(
    el('div', { class: 'imp-sum' },
      el('span', { class: 'chip' }, el('i', { class: 'dot', style: 'background:var(--data)' }),
        `紀錄 ${total}`),
      el('span', { class: 'chip' }, el('i', { class: 'dot', style: 'background:var(--good)' }),
        `附件 ${info.attachments}`),
      el('span', { class: 'chip' }, el('i', { class: 'dot', style: 'background:var(--ink-3)' }),
        `帳號 ${info.users}`),
      info.parts > 1
        ? el('span', { class: 'chip' },
            el('i', { class: 'dot', style: 'background:var(--accent)' }),
            `${info.parts} 片已齊`)
        : null,
      el('span', { class: 'hint', style: 'margin-left:auto' },
        info.filenames.length > 1
          ? `${info.filenames.length} 個檔案`
          : info.filenames[0])),
    el('div', { class: 'meta', style: 'margin-top:10px' },
      row('封存時間', el('span', { class: 'mono', style: 'font-size:12px' },
        String(info.exportedAt).replace('T', ' ').slice(0, 16))),
      row('封存者', el('span', {}, info.exportedBy || '—')),
      info.note ? row('備註', el('span', {}, info.note)) : null),
    el('div', { class: 'tablewrap', style: 'margin-top:10px' },
      el('table', { class: 'tbl' },
        el('thead', {}, el('tr', {},
          el('th', {}, '資料'), el('th', { style: 'text-align:right' }, '封存檔'),
          el('th', { style: 'text-align:right' }, '目前'))),
        el('tbody', {}, ...Object.entries(COLL_LABEL).map(([k, label]) => el('tr', {},
          el('td', {}, label),
          el('td', { style: 'text-align:right' },
            el('span', { class: 'tnum' }, String(info.counts[k] || 0))),
          el('td', { style: 'text-align:right;color:var(--ink-3)' },
            el('span', { class: 'tnum' }, String(ARC_NOW.counts?.[k] || 0)))))))),
    el('div', { style: 'display:flex;gap:9px;align-items:center;margin-top:14px;flex-wrap:wrap' },
      el('button', { class: 'btn btn-danger', onclick: () => confirmRestore(files, info) },
        el('span', { html: svgIcon(I.exchange) }), '以這份封存取代目前專案'),
      el('span', { class: 'hint' }, '下一步會先問你要不要封存目前的資料')));
}

/**
 * 還原前的確認。
 *
 * 規格要求「匯入前須詢問是否先封存目前專案」，所以這裡是兩段式：
 * 先問封存，再要求手動輸入確認字樣。把目前資料清掉這種事，
 * 不該只隔著一個「確定」按鈕。
 */
function confirmRestore(files, info) {
  const body = el('div', {},
    el('div', { class: 'arc-warn' },
      el('span', { html: svgIcon(I.shield) }),
      el('div', {},
        el('b', {}, '目前專案的所有業務資料將被清空'),
        el('div', { style: 'margin-top:4px;line-height:1.7' },
          '並以'
          + (info.parts > 1 ? `這份 ${info.parts} 片的封存` : ` ${info.filenames[0]}`)
          + '（封存於 '
          + String(info.exportedAt).replace('T', ' ').slice(0, 16) + '）的內容取代。'))),

    el('div', { style: 'margin-top:14px' },
      el('div', { class: 'eyebrow', style: 'margin-bottom:7px' }, '要先封存目前的專案嗎？'),
      el('label', { class: 'radio' },
        el('input', { type: 'radio', name: 'arc-pre', value: 'yes', checked: '' }),
        el('span', { class: 'mark' }), '先封存目前專案並下載，再進行還原（建議）'),
      el('label', { class: 'radio', style: 'margin-top:5px' },
        el('input', { type: 'radio', name: 'arc-pre', value: 'no' }),
        el('span', { class: 'mark' }), '不用，直接還原')),

    el('div', { class: 'field full', style: 'margin-top:14px' },
      el('label', { for: 'arc-confirm' },
        '請輸入 ', el('code', {}, 'REPLACE'), ' 以確認'),
      el('input', { class: 'inp mono', id: 'arc-confirm', autocomplete: 'off',
        placeholder: 'REPLACE',
        oninput: e => { $('#arc-do').disabled = e.target.value.trim() !== 'REPLACE'; } })),
    el('p', { id: 'arc-run', class: 'hint', style: 'margin-top:10px' }));

  const modal = el('div', { class: 'modal', style: 'max-width:600px' },
    el('div', { class: 'modal-head' },
      el('h3', {}, '確認還原'),
      el('button', { class: 'iconbtn', onclick: closeOverlay, html: svgIcon(I.close), title: '關閉' })),
    el('div', { class: 'modal-body' }, body),
    el('div', { class: 'modal-foot' },
      el('span', { class: 'spacer' }),
      el('button', { class: 'btn', onclick: closeOverlay }, '取消'),
      el('button', { class: 'btn btn-danger', id: 'arc-do', disabled: true,
        onclick: () => runRestore(files) },
        el('span', { html: svgIcon(I.exchange) }), '清空並還原')));

  const ov = $('#overlay');
  ov.innerHTML = '';
  ov.append(el('div', { class: 'scrim', onclick: e => { if (e.target === e.currentTarget) closeOverlay(); } }, modal));
  setTimeout(() => $('#arc-confirm')?.focus(), 0);
}

async function runRestore(files) {
  const msg = $('#arc-run');
  const btn = $('#arc-do');
  const pre = document.querySelector('input[name="arc-pre"]:checked')?.value === 'yes';
  btn.disabled = true;

  if (pre) {
    msg.textContent = '正在封存目前的專案…';
    // 先封存失敗就停手——使用者要的是「先留一份」，沒留到就不該往下走
    const ok = await doArchive();
    if (!ok) {
      msg.textContent = '目前專案封存失敗，已中止還原。請確認後再試，'
        + '或改選「不用，直接還原」。';
      btn.disabled = false;
      return;
    }
  }

  msg.textContent = '還原中，請勿關閉頁面…';
  try {
    const r = await STORE.archive.restore(files);
    const n = Object.values(r.result.restored).reduce((a, b) => a + b, 0);
    closeOverlay();
    await STORE.load();
    S.route = 'dashboard';
    render();
    toast(`還原完成：寫入 ${n} 筆紀錄、${r.result.attachments} 個附件`
      + (r.result.usersAdded.length ? `，補建 ${r.result.usersAdded.length} 個停用帳號` : ''));
  } catch (e) {
    msg.textContent = '還原失敗：' + e.message;
    btn.disabled = false;
  }
}

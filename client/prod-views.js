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

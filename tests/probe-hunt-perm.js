<script type="module">
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const out=[],errs=[];
window.addEventListener('error',e=>errs.push(e.message));
window.addEventListener('unhandledrejection',e=>errs.push('rej: '+(e.reason?.message||e.reason)));
const click=async el=>{ el.click(); await sleep(170); };
const T=()=>window.__T;

(async()=>{
 try{
  await sleep(1200);
  // 以管理員登入，啟用一個「主機分析員」帳號（非情資分析員）
  $('#lg-u').value='admin'; $('#lg-p').value=window.__E2E_PW;
  await click($('#lg-btn')); await sleep(1800);
  $('#pw-cur').value=window.__E2E_PW;
  $('#pw-new').value=window.__E2E_NEW_PW; $('#pw-c2').value=window.__E2E_NEW_PW;
  await click($('#pw-btn')); await sleep(2500);

  const csrf=(await fetch('/api/v1/auth/me',{credentials:'same-origin'}).then(r=>r.json())).csrfToken;
  const pw='Host#Analyst#'+Math.random().toString(36).slice(2,8);
  await fetch('/api/v1/users/chen',{method:'PUT',credentials:'same-origin',
    headers:{'content-type':'application/json','x-btms-csrf':csrf},
    body:JSON.stringify({disabled:false,password:pw})});
  out.push('已啟用 chen（主機分析員）');

  // 找一份非 chen 建立的獵補計畫
  const h=T().HUNTS.find(x=>x.analyst!=='chen');
  out.push(`測試標的：${h.id}（建立者 ${h.analyst}）`);

  // 登出改以 chen 登入
  await fetch('/api/v1/auth/logout',{method:'POST',credentials:'same-origin',headers:{'x-btms-csrf':csrf}});
  let r=await fetch('/api/v1/auth/login',{method:'POST',credentials:'same-origin',
    headers:{'content-type':'application/json'},body:JSON.stringify({username:'chen',password:pw})}).then(x=>x.json());
  const c2=r.csrfToken;
  // 強制改密
  const np='Hunt#Collab#'+Math.random().toString(36).slice(2,8);
  await fetch('/api/v1/auth/password',{method:'POST',credentials:'same-origin',
    headers:{'content-type':'application/json','x-btms-csrf':c2},
    body:JSON.stringify({currentPassword:pw,newPassword:np})});
  r=await fetch('/api/v1/auth/login',{method:'POST',credentials:'same-origin',
    headers:{'content-type':'application/json'},body:JSON.stringify({username:'chen',password:np})}).then(x=>x.json());
  const c3=r.csrfToken;
  out.push('chen 身分：'+r.user.role+' / '+r.user.perm);

  // 直接打 API 驗證伺服器端放行
  const cur=await fetch('/api/v1/collections/hunts/'+h.id,{credentials:'same-origin'}).then(x=>x.json());
  const upd=await fetch('/api/v1/collections/hunts/'+h.id,{method:'PUT',credentials:'same-origin',
    headers:{'content-type':'application/json','x-btms-csrf':c3},
    body:JSON.stringify({version:cur.version,data:{...cur.data,analytics:'由主機分析員補寫的抽象分析法'}})
  }).then(x=>x.json());
  out.push('改他人獵補計畫 → '+(upd.error? '被擋：'+upd.error.message : '成功 v'+upd.version));

  // 對照組：改他人的調查報告應仍被擋
  const cs=T().CASES.find(x=>x.analyst!=='chen');
  const cc=await fetch('/api/v1/collections/cases/'+cs.id,{credentials:'same-origin'}).then(x=>x.json());
  const bad=await fetch('/api/v1/collections/cases/'+cs.id,{method:'PUT',credentials:'same-origin',
    headers:{'content-type':'application/json','x-btms-csrf':c3},
    body:JSON.stringify({version:cc.version,data:{...cc.data,title:'不該成功'}})}).then(x=>x.json());
  out.push('改他人調查報告 → '+(bad.error? '被擋（正確）：'+bad.error.code : '成功（錯誤！）'));

  // TTP 標註
  const mk=await fetch('/api/v1/collections/ttp_marks',{method:'POST',credentials:'same-origin',
    headers:{'content-type':'application/json','x-btms-csrf':c3},
    body:JSON.stringify({data:{ttp:'T1595',note:'測試',by:'tsai'}})}).then(x=>x.json());
  const del=await fetch('/api/v1/collections/ttp_marks/'+mk.id,{method:'DELETE',credentials:'same-origin',
    headers:{'x-btms-csrf':c3}}).then(x=>x.json());
  out.push('刪除他人的 TTP 標註 → '+(del.error? '被擋：'+del.error.message : '成功'));

  // 介面判斷：把目前身分切到 chen（主機分析員）後檢查各種類的權限
  T().S.me='chen';
  out.push('UI 權限（主機分析員）：'
    + ' 獵補計畫=' + T().canEditIntel('hunt')
    + ' 情資報告=' + T().canEditIntel('intel')
    + ' APT報告=' + T().canEditIntel('apt'));
  T().S.me='tsai';
  out.push('UI 權限（情資分析員）：'
    + ' 獵補計畫=' + T().canEditIntel('hunt')
    + ' 情資報告=' + T().canEditIntel('intel')
    + ' APT報告=' + T().canEditIntel('apt'));
  T().S.me='li';
  out.push('UI 權限（藍隊隊長）：'
    + ' 獵補計畫=' + T().canEditIntel('hunt')
    + ' 情資報告=' + T().canEditIntel('intel')
    + ' APT報告=' + T().canEditIntel('apt'));
 }catch(e){ out.push('EX: '+e.message+' @ '+(e.stack||'').split('\n')[1]); }
 const d=document.createElement('div'); d.id='__report';
 d.textContent='ERR['+errs.length+'] '+errs.slice(0,3).join(' ;; ')+'\n'+out.join('\n');
 document.body.append(d);
})();
</script>

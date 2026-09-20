<script type="module">
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const out=[],errs=[];
window.addEventListener('error',e=>errs.push(e.message));
window.addEventListener('unhandledrejection',e=>errs.push('rej: '+(e.reason?.message||e.reason)));
const T=s=>{const n=$(s); return n?n.textContent.replace(/\s+/g,' ').trim():'X';};
const click=async el=>{ el.click(); await sleep(150); };
const api=(p,o)=>fetch('/api/v1'+p,{credentials:'same-origin',...o}).then(r=>r.json());

(async()=>{
 try{
  await sleep(1200);
  out.push('登入頁：h2='+T('.login-box h2')+'｜示範帳號區塊='+$$('.acct').length+'｜預填='+JSON.stringify($('#lg-u').value));

  $('#lg-u').value='admin'; $('#lg-p').value='wrong-password-here';
  await click($('#lg-btn')); await sleep(800);
  out.push('錯誤密碼：'+T('#lg-err'));

  $('#lg-u').value='admin'; $('#lg-p').value=window.__E2E_PW;
  await click($('#lg-btn')); await sleep(1800);
  out.push('強制改密：'+T('.card.sec h3'));

  $('#pw-cur').value=window.__E2E_PW;
  $('#pw-new').value='password1234'; $('#pw-new').dispatchEvent(new Event('input'));
  $('#pw-c2').value='password1234';
  await click($('#pw-btn')); await sleep(900);
  out.push('弱密碼：'+T('#pw-err'));

  $('#pw-cur').value=window.__E2E_PW;
  $('#pw-new').value=window.__E2E_NEW_PW; $('#pw-new').dispatchEvent(new Event('input'));
  $('#pw-c2').value=window.__E2E_NEW_PW;
  await click($('#pw-btn')); await sleep(2500);

  out.push('儀表板：'+T('h1').slice(0,18)+'｜案件列='+$$('#tbody tr').length+'｜'+T('.pager').slice(0,24));

  await click($$('button').find(b=>/系統管理員/.test(b.textContent)));
  out.push('帳號選單：'+$$('.mi').map(m=>m.textContent.trim()).join(' / '));
  document.body.click(); await sleep(200);

  await click($$('button').find(b=>/建立調查報告|新增報告|建立報告/.test(b.textContent)));
  await sleep(900);
  if(!$('#f-title')) throw new Error('表單未開啟');
  $('#f-title').value='端對端測試案件';
  $('#f-occ-a').value='2026-09-13T10:00';
  $('#f-occ-b').value='2026-09-13T11:00';
  $('#f-host').value='TEST-HOST-01';
  $('#f-con').value='端對端測試：確認資料確實寫入伺服器。';
  if($('#f-nar')) $('#f-nar').value='由自動化探針建立。';
  const saves=$$('button.btn-primary').filter(b=>/建立報告|儲存報告|儲存變更/.test(b.textContent));
  await click(saves[saves.length-1]);
  await sleep(2500);
  out.push('存檔後：'+T('h1').slice(0,20));

  const r=await api('/collections/cases');
  const mine=r.items.find(x=>x.data.title==='端對端測試案件');
  out.push('伺服器：案件數='+r.total+'｜新案='+(mine?mine.id+' v'+mine.version+' analyst='+mine.data.analyst:'未寫入'));

  const dash=await api('/dashboard');
  out.push('儀表板統計：'+JSON.stringify(dash.stats));

  const au=await api('/audit?limit=2');
  out.push('稽核：'+au.items.map(x=>x.action+'→'+(x.summary||'')).join('｜').slice(0,90));

  // 稽核畫面
  await click($$('button').find(b=>/系統管理員/.test(b.textContent)));
  await click($$('.mi').find(m=>/稽核紀錄/.test(m.textContent)));
  await sleep(1200);
  out.push('稽核頁：'+T('h1')+'｜列數='+$$('#au-body tr').length+'｜'+T('#au-pager').slice(0,22));
 }catch(e){ out.push('EX: '+e.message+' @ '+(e.stack||'').split('\n')[1]); }
 const d=document.createElement('div'); d.id='__report';
 d.textContent='ERR['+errs.length+'] '+errs.slice(0,3).join(' ;; ')+'\n'+out.join('\n');
 document.body.append(d);
})();
</script>

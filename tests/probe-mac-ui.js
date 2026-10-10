<script type="module">
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const out=[],errs=[];
window.addEventListener('error',e=>errs.push(e.message));
window.addEventListener('unhandledrejection',e=>errs.push('rej: '+(e.reason?.message||e.reason)));
const click=async el=>{ el.click(); await sleep(160); };
const T=()=>window.__T;

(async()=>{
 try{
  await sleep(1200);
  $('#lg-u').value='admin'; $('#lg-p').value=window.__E2E_PW;
  await click($('#lg-btn')); await sleep(1800);
  $('#pw-cur').value=window.__E2E_PW;
  $('#pw-new').value=window.__E2E_NEW_PW; $('#pw-c2').value=window.__E2E_NEW_PW;
  await click($('#pw-btn')); await sleep(2500);

  await click($('#app-switch')); await sleep(200);
  await click($$('.appmi-txt').find(n=>/資產管理/.test(n.textContent)).closest('button')); await sleep(1200);
  await click($$('button').find(b=>/建立資產/.test(b.textContent))); await sleep(1000);
  out.push('資產表單='+(!!$('#as-mac'))+'｜製造商欄='+(!!$('#as-vendor')));

  // 使用者在網站上看到的寫法：A8-3A-79
  for(const [mac,note] of [['A8-3A-79-11-22-33','連字號'],
                           ['A8:3A:79:11:22:33','冒號'],
                           ['a83a79112233','無分隔小寫'],
                           ['A8-3A-79','只有前綴']]){
    $('#as-vendor').value='';          // 清空才會自動填
    $('#as-mac').value=mac;
    $('#as-mac').dispatchEvent(new Event('input'));
    await sleep(900);
    out.push(`  ${note.padEnd(8)} ${mac.padEnd(20)} → 製造商="${$('#as-vendor').value}"`);
  }

  // 查不到的前綴
  $('#as-vendor').value=''; $('#as-mac').value='02-00-00-11-22-33';
  $('#as-mac').dispatchEvent(new Event('input')); await sleep(900);
  out.push('  查無的前綴 → 製造商="'+$('#as-vendor').value+'" 提示="'+($('#as-mac-oui')?.textContent||'')+'"');

  // 已填寫的製造商不應被覆寫
  $('#as-vendor').value='自行填寫的廠商';
  $('#as-mac').value='B0-83-FE-11-22-33';
  $('#as-mac').dispatchEvent(new Event('input')); await sleep(900);
  out.push('  已有內容時 → 製造商="'+$('#as-vendor').value+'"（應保持不變）');

  // 中國品牌標註
  $('#as-vendor').value=''; $('#as-mac').value='18-69-45-00-00-01';
  $('#as-mac').dispatchEvent(new Event('input')); await sleep(900);
  out.push('  TP-Link → "'+$('#as-vendor').value+'"');
  out.push('  提示文字="'+($('#as-mac-oui')?.textContent||'').slice(0,90)+'"');

  const st=await T().STORE.oui.status();
  out.push('OUI 筆數='+st.loaded);
 }catch(e){ out.push('EX: '+e.message+' @ '+(e.stack||'').split('\n')[1]); }
 const d=document.createElement('div'); d.id='__report';
 d.textContent='ERR['+errs.length+'] '+errs.slice(0,3).join(' ;; ')+'\n'+out.join('\n');
 document.body.append(d);
})();
</script>

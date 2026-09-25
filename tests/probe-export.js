<script type="module">
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const out=[],errs=[];
window.addEventListener('error',e=>errs.push(e.message));
window.addEventListener('unhandledrejection',e=>errs.push('rej: '+(e.reason?.message||e.reason)));
const T=s=>{const n=$(s); return n?n.textContent.replace(/\s+/g,' ').trim():'X';};
const click=async el=>{ el.click(); await sleep(160); };

// 攔截下載，記錄檔名與位元組數，不真的存檔
const saved=[];
const realCreate=URL.createObjectURL.bind(URL);
URL.createObjectURL=b=>{ saved.push({type:b.type, size:b.size}); return realCreate(b); };
const realClick=HTMLAnchorElement.prototype.click;
HTMLAnchorElement.prototype.click=function(){ if(this.download){ saved[saved.length-1].name=this.download; return; } return realClick.call(this); };
// 列印改為記錄，不開對話框
let printed=0; window.print=()=>{ printed++; };

(async()=>{
 try{
  await sleep(1200);
  $('#lg-u').value='admin'; $('#lg-p').value=window.__E2E_PW;
  await click($('#lg-btn')); await sleep(1800);
  $('#pw-cur').value=window.__E2E_PW;
  $('#pw-new').value=window.__E2E_NEW_PW; $('#pw-c2').value=window.__E2E_NEW_PW;
  await click($('#pw-btn')); await sleep(2500);

  /* ---- 1. 案件報告 PDF ---- */
  await click($$('#tbody tr')[0]); await sleep(1000);
  out.push('案件詳情='+T('h1').slice(0,18));
  await click($$('button').find(b=>/匯出 PDF/.test(b.textContent))); await sleep(500);
  const pr=$('#print-root');
  out.push('列印節點='+(!!pr)+' 呼叫 print='+printed
    +' 標題='+(pr?pr.querySelector('.p-title').textContent.slice(0,16):'X')
    +' 中繼列='+(pr?pr.querySelectorAll('.p-meta tr').length:0)
    +' 章節='+(pr?[...pr.querySelectorAll('.p-sec h2')].map(h=>h.textContent).join('/'):''));
  out.push('列印內含表格='+(pr?pr.querySelectorAll('.p-tbl').length:0)
    +' Markdown 段落='+(pr?pr.querySelectorAll('.p-body p').length:0));
  window.dispatchEvent(new Event('afterprint')); await sleep(200);
  out.push('清理後 print-root='+(!!$('#print-root'))+' body 標記='+(document.body.dataset.printing||'無'));

  /* ---- 2. 圖表 PNG ---- */
  await click($$('button').find(b=>/返回總覽/.test(b.textContent))); await sleep(900);
  await click($$('button').find(b=>b.textContent.trim().startsWith('匯出'))); await sleep(250);
  out.push('案件匯出選單='+$$('.mi').map(m=>m.textContent.trim()).join(' | '));
  await click($$('.mi').find(m=>/趨勢圖 PNG/.test(m.textContent))); await sleep(2500);
  out.push('PNG 產出='+JSON.stringify(saved[saved.length-1]||null));

  /* ---- 3. 資產 XLSX + CSV ---- */
  await click($('#app-switch')); await sleep(200);
  await click($$('.appmi-txt').find(n=>/資產管理/.test(n.textContent)).closest('button')); await sleep(1200);
  out.push('資產總覽='+T('h1'));
  await click($$('button').find(b=>b.textContent.trim().startsWith('匯出'))); await sleep(250);
  out.push('資產匯出選單='+$$('.mi').map(m=>m.textContent.trim()).join(' | '));
  await click($$('.mi').find(m=>/XLSX（全部）/.test(m.textContent))); await sleep(900);
  out.push('XLSX='+JSON.stringify(saved[saved.length-1]||null));

  await click($$('button').find(b=>b.textContent.trim().startsWith('匯出'))); await sleep(250);
  await click($$('.mi').find(m=>/CSV$/.test(m.textContent.trim()))); await sleep(700);
  out.push('CSV='+JSON.stringify(saved[saved.length-1]||null));

  /* ---- 4. 資產 PDF ---- */
  await click($$('#abody tr')[0]); await sleep(900);
  await click($$('button').find(b=>/匯出 PDF/.test(b.textContent))); await sleep(500);
  const ap=$('#print-root');
  out.push('資產 PDF 章節='+(ap?[...ap.querySelectorAll('.p-sec h2')].map(h=>h.textContent).join('/'):'X'));
  window.dispatchEvent(new Event('afterprint')); await sleep(200);

  /* ---- 5. CSV 匯入 ---- */
  await click($$('button').find(b=>/返回總覽/.test(b.textContent))); await sleep(900);
  await click($$('button').find(b=>/匯入 CSV/.test(b.textContent))); await sleep(500);
  out.push('匯入對話框='+T('.modal-head h3')+' 拖放區='+(!!$('#csv-drop')));
  await click($$('button').find(b=>/欄位說明/.test(b.textContent))); await sleep(400);
  out.push('欄位說明列數='+$$('.spec-tbl tbody tr').length);
 }catch(e){ out.push('EX: '+e.message+' @ '+(e.stack||'').split('\n')[1]); }
 const d=document.createElement('div'); d.id='__report';
 d.textContent='ERR['+errs.length+'] '+errs.slice(0,3).join(' ;; ')+'\n'+out.join('\n');
 document.body.append(d);
})();
</script>

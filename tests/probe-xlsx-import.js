<script type="module">
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const out=[],errs=[]; let b64='';
window.addEventListener('error',e=>errs.push(e.message));
window.addEventListener('unhandledrejection',e=>errs.push('rej: '+(e.reason?.message||e.reason)));
const T=s=>{const n=$(s); return n?n.textContent.replace(/\s+/g,' ').trim():'X';};
const click=async el=>{ el.click(); await sleep(160); };
const toB64=async b=>{ const u=new Uint8Array(await b.arrayBuffer()); let s=''; 
  for(let i=0;i<u.length;i++) s+=String.fromCharCode(u[i]); return btoa(s); };

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
  const before = __T.ASSETS.length;
  out.push('匯入前資產數='+before);

  /* 直接呼叫產生器，取得真正的位元組 */
  const blob = __T.buildXlsx({ sheetName:'資產清冊',
    columns:[...__T.ASSET_COLUMNS, {label:'服務數',width:9},{label:'漏洞數',width:9},{label:'待立即修補',width:12}],
    rows: __T.ASSETS.slice(0,5).map(a=>{ const d=__T.ADETAIL[a.id]||{};
      return [...__T.ASSET_COLUMNS.map(c=>__T.assetCellValue(a,c)),
        (d.services||[]).length,(d.vulns||[]).length,(d.vulns||[]).filter(v=>v.urgent).length]; }) });
  b64 = await toB64(blob);
  out.push('XLSX bytes='+blob.size);

  /* 範本 CSV 走一次解析＋驗證 */
  const tpl = __T.assetCsvTemplate();
  const parsed = __T.parseCsv(tpl);
  out.push('範本列數='+parsed.length+' 欄數='+parsed[0].length);
  const v = __T.validateAssetRows(parsed);
  out.push('範本驗證：可匯入='+v.items.filter(x=>!x.errors.length).length
    +' 有錯='+v.items.filter(x=>x.errors.length).length
    +' 提醒='+JSON.stringify(v.items.flatMap(x=>x.warnings)));

  /* 真的匯入範本的兩筆 */
  __T.commitAssetImport(v.items.filter(x=>!x.errors.length));
  await sleep(1200);
  out.push('匯入後資產數='+__T.ASSETS.length+'（+'+(__T.ASSETS.length-before)+'）');
  const added = __T.ASSETS.find(a=>a.hostname==='TPE-WEB-05');
  out.push('新資產='+(added? `${added.id} ip=${added.ip} imp=${added.importance} tags=${added.tags.join('/')} 用途=${(__T.ADETAIL[added.id]||{}).purpose?.slice(0,12)}` : '未建立'));

  /* 錯誤資料要被擋 */
  const badCsv = __T.buildCsv(
    ['資產編號','主機名稱','IPv4','MAC','重要性','網段'],
    [['','TPE-DC-01','1.2.3.4','','中',''],
     ['','BAD-IP-HOST','999.1.1.1','','中',''],
     ['','BAD-MAC-HOST','10.0.0.9','ZZ:ZZ','中',''],
     ['','BAD-IMP-HOST','10.0.0.10','','超級重要',''],
     ['','',    '10.0.0.11','','中',''],
     ['ASSET-9999','GHOST','10.0.0.12','','中',''],
     ['','DUP-HOST','10.0.0.13','','中',''],
     ['','DUP-HOST','10.0.0.14','','中','']]);
  const bv = __T.validateAssetRows(__T.parseCsv(badCsv));
  out.push('錯誤檔驗證：');
  bv.items.forEach(x=>out.push(`  第${x.line}列 ${x.hostname||'(空)'} -> ${x.errors.join('；')||'通過'}`));

  /* 伺服器端確認真的寫進去了 */
  await sleep(1500);
  const r = await fetch('/api/v1/collections/assets',{credentials:'same-origin'}).then(x=>x.json());
  out.push('伺服器資產數='+r.total+' 含新匯入='+r.items.some(i=>i.data.hostname==='TPE-WEB-05'));
 }catch(e){ out.push('EX: '+e.message+' @ '+(e.stack||'').split('\n')[1]); }
 const d=document.createElement('div'); d.id='__report';
 d.textContent='ERR['+errs.length+'] '+errs.slice(0,3).join(' ;; ')+'\n'+out.join('\n');
 document.body.append(d);
 const x=document.createElement('div'); x.id='__xlsx'; x.textContent=b64; document.body.append(x);
})();
</script>

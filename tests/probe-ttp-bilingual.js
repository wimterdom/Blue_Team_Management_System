<script type="module">
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const out=[],errs=[];
window.addEventListener('error',e=>errs.push(e.message));
window.addEventListener('unhandledrejection',e=>errs.push('rej: '+(e.reason?.message||e.reason)));
const click=async el=>{ el.click(); await sleep(180); };
const T=()=>window.__T;
const txt=n=>n?n.textContent.replace(/\s+/g,' ').trim():'—';

(async()=>{
 try{
  await sleep(1200);
  $('#lg-u').value='admin'; $('#lg-p').value=window.__E2E_PW;
  await click($('#lg-btn')); await sleep(1800);
  $('#pw-cur').value=window.__E2E_PW;
  $('#pw-new').value=window.__E2E_NEW_PW; $('#pw-c2').value=window.__E2E_NEW_PW;
  await click($('#pw-btn')); await sleep(2500);

  // 資料層
  const idx=T().TECH_INDEX;
  out.push('TECH_INDEX 總數='+Object.keys(idx).length);
  const noEn=Object.values(idx).filter(t=>!t.en);
  out.push('缺英文名的技術='+(noEn.length?noEn.slice(0,5).map(t=>t.id).join(','):'無'));
  for(const id of ['T1059.001','T1685.005','T1595']){
    out.push(`  ${id}: 中="${idx[id].name}" 英="${idx[id].en}"`);
  }

  // 案件表單的挑選器：搜尋英文關鍵字
  await click($$('button').find(b=>/建立調查報告/.test(b.textContent))); await sleep(900);
  await click($$('button').find(b=>/挑選技術/.test(b.textContent))); await sleep(500);
  const inp=$('.modal input.inp');
  out.push('挑選視窗='+!!inp+'｜頁尾說明='+txt($('.modal-foot .note')));
  inp.value='PowerShell'; inp.dispatchEvent(new Event('input')); await sleep(500);
  const rows=$$('.modal .tech');
  out.push('搜尋「PowerShell」命中 '+rows.length+' 項');
  out.push('  首列='+txt(rows[0]));
  out.push('  含英文 span='+(rows[0]?.querySelector('.ttp-en')?.textContent||'無'));
  inp.value='憑證'; inp.dispatchEvent(new Event('input')); await sleep(500);
  out.push('搜尋中文「憑證」命中 '+$$('.modal .tech').length+' 項，首列='+txt($$('.modal .tech')[0]));
  // 選一項確認已選清單也是中英
  await click($$('.modal .tech')[0]);
  await click($$('.modal button').find(b=>/確認選取/.test(b.textContent))); await sleep(600);
  out.push('已選清單首列='+txt($$('#ttp-list .ttp-row')[0]));

  // 情資系統：熱圖提示與詳情
  await click($('#app-switch')); await sleep(200);
  await click($$('.appmi-txt').find(n=>/情資管理/.test(n.textContent)).closest('button')); await sleep(2000);
  const cell=$('#heat-home .heat-svg [data-tech]');
  out.push('熱圖格子提示='+(cell?.querySelector('title')?.textContent||'無').slice(0,70));

  // 情資報告詳情的 TTP 列
  const row=$$('#ib-intel tr')[0];
  if(row){ await click(row); await sleep(1200);
    const tr=$$('.ttp-row')[0];
    out.push('情資詳情 TTP 列='+txt(tr)+'｜英文 span='+(tr?.querySelector('.ttp-en')?.textContent||'無'));
  }
 }catch(e){ out.push('EX: '+e.message+' @ '+(e.stack||'').split('\n')[1]); }
 const d=document.createElement('div'); d.id='__report';
 d.textContent='ERR['+errs.length+'] '+errs.slice(0,3).join(' ;; ')+'\n'+out.join('\n');
 document.body.append(d);
})();
</script>

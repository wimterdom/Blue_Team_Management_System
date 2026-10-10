<script type="module">
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const out=[],errs=[];
window.addEventListener('error',e=>errs.push(e.message));
window.addEventListener('unhandledrejection',e=>errs.push('rej: '+(e.reason?.message||e.reason)));
const click=async el=>{ el.click(); await sleep(160); };

(async()=>{
 try{
  await sleep(1200);
  $('#lg-u').value='admin'; $('#lg-p').value=window.__E2E_PW;
  await click($('#lg-btn')); await sleep(1800);
  $('#pw-cur').value=window.__E2E_PW;
  $('#pw-new').value=window.__E2E_NEW_PW; $('#pw-c2').value=window.__E2E_NEW_PW;
  await click($('#pw-btn')); await sleep(2500);

  const T=window.__T;
  // 1. 現有惡意案件的 TTP 有沒有進到 analystTtps
  const mal = T.CASES.filter(c=>c.verdict==='惡意行為');
  const malTtps = new Set();
  mal.forEach(c=>(T.DETAIL[c.id]?.ttps||[]).forEach(t=>malTtps.add(t.id)));
  out.push(`惡意案件 ${mal.length} 件，TTP ${malTtps.size} 項`);
  out.push('DETAIL 有載入='+Object.keys(T.DETAIL).length+' 筆');

  const marks = T.analystTtps();
  out.push('analystTtps 回傳 '+marks.size+' 項');
  const notMarked=[...malTtps].filter(t=>!marks.has(t));
  out.push('惡意案件 TTP 未被標註的='+(notMarked.length?notMarked.join(','):'無'));

  const layers = T.ttpLayers();
  const noLayer=[...malTtps].filter(t=>!layers.has(t));
  out.push('沒有圖層的='+(noLayer.length?noLayer.join(','):'無'));

  // 2. 熱圖上實際畫出來了嗎
  await click($('#app-switch')); await sleep(200);
  await click($$('.appmi-txt').find(n=>/情資管理/.test(n.textContent)).closest('button')); await sleep(2000);
  const svg=$('#heat-home .heat-svg');
  out.push('熱圖 SVG='+(!!svg));
  if(svg){
    const cells=[...svg.querySelectorAll('[data-tech]')];
    out.push('熱圖格子數='+cells.length);
    const painted=cells.filter(c=>c.getAttribute('data-layers')&&c.getAttribute('data-layers')!=='0');
    out.push('有圖層的格子='+painted.length);
    const sample=[...malTtps].slice(0,6);
    sample.forEach(t=>{
      const cell=svg.querySelector(`[data-tech="${t}"]`);
      out.push(`  ${t}: 格子=${!!cell} layers=${cell?cell.getAttribute('data-layers'):'-'}`);
    });
  }
 }catch(e){ out.push('EX: '+e.message+' @ '+(e.stack||'').split('\n')[1]); }
 const d=document.createElement('div'); d.id='__report';
 d.textContent='ERR['+errs.length+'] '+errs.slice(0,3).join(' ;; ')+'\n'+out.join('\n');
 document.body.append(d);
})();
</script>

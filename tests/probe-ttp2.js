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

  // 挑一個目前完全沒被標註的母技術來測
  const layersBefore = T().ttpLayers();
  let target=null;
  for(const tac of T().ATTACK_FULL){
    for(const p of tac.techs){
      if(!p.common) continue;
      const any = layersBefore.has(p.id) || p.subs.some(s=>layersBefore.has(s.id));
      if(!any){ target={tac, p}; break; }
    }
    if(target) break;
  }
  out.push('測試用技術='+(target? `${target.p.id} ${target.p.name}（${target.tac.name}）`:'找不到未標註的'));
  if(!target) throw new Error('no target');

  // 建立惡意行為案件，直接塞 TTP 進表單狀態（等同使用者從挑選視窗選取）
  await click($$('button').find(b=>/建立調查報告/.test(b.textContent))); await sleep(1000);
  T().S.form.ttps.push({tac:`${target.tac.id} ${target.tac.name}`, id:target.p.id, name:target.p.name});
  $('#f-title').value='TTP 自動標註測試';
  $('#f-occ-a').value='2026-10-10T09:00'; $('#f-occ-b').value='2026-10-10T10:00';
  $('#f-host').value='TEST-TTP-01';
  $('#f-con').value='確認惡意行為案件的 TTP 會自動出現在熱圖。';
  // 判定選「惡意行為」
  const mal=[...document.querySelectorAll('input[type=radio]')].find(r=>r.value==='惡意行為');
  out.push('惡意行為選項='+(!!mal)); if(mal) mal.click();
  const saves=$$('button.btn-primary').filter(b=>/建立報告|儲存報告/.test(b.textContent));
  await click(saves[saves.length-1]); await sleep(2500);
  out.push('存檔後='+($('h1')?.textContent||'').slice(0,20));

  const c = T().CASES.find(x=>x.title==='TTP 自動標註測試');
  out.push('案件='+(c? `${c.id} verdict=${c.verdict}`:'未建立'));
  out.push('DETAIL.ttps='+JSON.stringify((T().DETAIL[c.id]||{}).ttps));

  const marks=T().analystTtps();
  out.push(`analystTtps 含 ${target.p.id} = ${marks.has(target.p.id)}`);

  // 切到情資熱圖看格子
  await click($('#app-switch')); await sleep(200);
  await click($$('.appmi-txt').find(n=>/情資管理/.test(n.textContent)).closest('button')); await sleep(2000);
  const cell=$(`#heat-home .heat-svg [data-tech="${target.p.id}"]`);
  out.push(`熱圖格子 ${target.p.id}: 存在=${!!cell} layers=${cell?cell.getAttribute('data-layers'):'-'} class=${cell?cell.getAttribute('class'):'-'}`);
 }catch(e){ out.push('EX: '+e.message+' @ '+(e.stack||'').split('\n')[1]); }
 const d=document.createElement('div'); d.id='__report';
 d.textContent='ERR['+errs.length+'] '+errs.slice(0,3).join(' ;; ')+'\n'+out.join('\n');
 document.body.append(d);
})();
</script>

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

  const A=T().ATTACK_FULL;
  let par=0, sub=0, common=0;
  A.forEach(t=>t.techs.forEach(p=>{ par++; if(p.common) common++; sub+=p.subs.length; }));
  out.push(`ATT&CK 戰術 ${A.length}｜母技術 ${par}（預設顯示 ${common}）｜子技術 ${sub}`);
  out.push('戰術清單='+A.map(t=>t.id).join(','));
  out.push('含 TA0112='+A.some(t=>t.id==='TA0112')+'｜TA0005 名稱='+(A.find(t=>t.id==='TA0005')||{}).name);

  // 新編號查得到、舊編號遷移得到
  const chk=['T1685','T1685.001','T1685.005','T1686','T1574.001','T1687','T1690'];
  out.push('新編號在索引中：'+chk.map(t=>`${t}=${!!T().TECH_INDEX[t]}`).join(' '));

  // 所有資料的 TTP 都要對得到格子
  const all=new Set();
  Object.values(T().DETAIL).forEach(d=>(d.ttps||[]).forEach(t=>all.add(t.id)));
  const bad=[...all].filter(t=>!T().TECH_INDEX[t]);
  out.push(`案件引用技術 ${all.size} 項｜索引查不到的: ${bad.length? bad.join(','):'無'}`);

  // 惡意案件的 TTP 一定要被標註
  const mal=T().CASES.filter(c=>c.verdict==='惡意行為');
  const malT=new Set(); mal.forEach(c=>(T().DETAIL[c.id]?.ttps||[]).forEach(t=>malT.add(t.id)));
  const layers=T().ttpLayers();
  const noLayer=[...malT].filter(t=>!layers.has(t));
  out.push(`惡意案件 ${mal.length} 件、TTP ${malT.size} 項｜沒有圖層的: ${noLayer.length?noLayer.join(','):'無'}`);

  // 熱圖上實際有畫出來
  await click($('#app-switch')); await sleep(200);
  await click($$('.appmi-txt').find(n=>/情資管理/.test(n.textContent)).closest('button')); await sleep(2500);
  const svg=$('#heat-home .heat-svg');
  const cells=[...svg.querySelectorAll('[data-tech]')];
  out.push(`熱圖格子 ${cells.length}｜有圖層 ${cells.filter(c=>c.getAttribute('data-layers')!=='0').length}`);
  // 逐一確認惡意案件的技術在熱圖上看得到（母技術或其母層）
  const seen=new Map(cells.map(c=>[c.getAttribute('data-tech'), c.getAttribute('data-layers')]));
  const invisible=[...malT].filter(t=>{
    if(seen.has(t)) return seen.get(t)==='0';
    const p=t.split('.')[0];
    return !(seen.has(p) && seen.get(p)!=='0');
  });
  out.push('惡意案件技術在熱圖上看不到的: '+(invisible.length?invisible.join(','):'無'));
 }catch(e){ out.push('EX: '+e.message+' @ '+(e.stack||'').split('\n')[1]); }
 const d=document.createElement('div'); d.id='__report';
 d.textContent='ERR['+errs.length+'] '+errs.slice(0,3).join(' ;; ')+'\n'+out.join('\n');
 document.body.append(d);
})();
</script>

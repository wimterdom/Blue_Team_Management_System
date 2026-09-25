<script type="module">
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const out=[],errs=[]; let b64='';
window.addEventListener('error',e=>errs.push(e.message));
window.addEventListener('unhandledrejection',e=>errs.push('rej: '+(e.reason?.message||e.reason)));
const click=async el=>{ el.click(); await sleep(160); };
const toB64=async b=>{ const u=new Uint8Array(await b.arrayBuffer()); let s='';
  for(let i=0;i<u.length;i++) s+=String.fromCharCode(u[i]); return btoa(s); };
// 攔下 blob 以便取出 PNG
let lastBlob=null;
const realCreate=URL.createObjectURL.bind(URL);
URL.createObjectURL=b=>{ lastBlob=b; return realCreate(b); };
HTMLAnchorElement.prototype.click=function(){};

(async()=>{
 try{
  await sleep(1200);
  $('#lg-u').value='admin'; $('#lg-p').value=window.__E2E_PW;
  await click($('#lg-btn')); await sleep(1800);
  $('#pw-cur').value=window.__E2E_PW;
  $('#pw-new').value=window.__E2E_NEW_PW; $('#pw-c2').value=window.__E2E_NEW_PW;
  await click($('#pw-btn')); await sleep(2500);

  // 拓撲圖 PNG——最複雜的一張，含連線、箭頭、標籤
  await click($('#app-switch')); await sleep(200);
  await click($$('.appmi-txt').find(n=>/主機標定/.test(n.textContent)).closest('button')); await sleep(2000);
  const svg=$('.topo-svg');
  out.push('拓撲 SVG='+(!!svg)+' viewBox='+(svg?svg.getAttribute('viewBox'):'X')
    +' 節點數='+(svg?svg.querySelectorAll('g,rect,path,text').length:0));
  await __T.svgToPng(svg, 'topo.png');
  await sleep(1500);
  out.push('PNG blob='+(lastBlob?`${lastBlob.type} ${lastBlob.size}B`:'無'));
  if(lastBlob) b64 = await toB64(lastBlob);
 }catch(e){ out.push('EX: '+e.message+' @ '+(e.stack||'').split('\n')[1]); }
 const d=document.createElement('div'); d.id='__report';
 d.textContent='ERR['+errs.length+'] '+errs.slice(0,3).join(' ;; ')+'\n'+out.join('\n');
 document.body.append(d);
 const x=document.createElement('div'); x.id='__xlsx'; x.textContent=b64; document.body.append(x);
})();
</script>

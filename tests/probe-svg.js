<script type="module">
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const out=[],errs=[]; let b64='';
window.addEventListener('error',e=>errs.push(e.message));
window.addEventListener('unhandledrejection',e=>errs.push('rej: '+(e.reason?.message||e.reason)));
const click=async el=>{ el.click(); await sleep(160); };
let lastBlob=null;
const realCreate=URL.createObjectURL.bind(URL);
URL.createObjectURL=b=>{ lastBlob=b; return realCreate(b); };
HTMLAnchorElement.prototype.click=function(){};
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

  // 選單應同時有 PNG 與 SVG
  await click($$('button').find(b=>b.textContent.trim().startsWith('匯出'))); await sleep(300);
  out.push('案件選單='+$$('.mi').map(m=>m.textContent.replace(/\s+/g,' ').trim()).join(' | '));
  document.body.click(); await sleep(200);

  // 拓撲圖 SVG
  await click($('#app-switch')); await sleep(200);
  await click($$('.appmi-txt').find(n=>/主機標定/.test(n.textContent)).closest('button')); await sleep(2000);
  await click($$('button').find(b=>b.textContent.trim().startsWith('匯出'))); await sleep(300);
  out.push('拓撲選單='+$$('.mi').map(m=>m.textContent.replace(/\s+/g,' ').trim()).join(' | '));
  const svgItem=$$('.mi').find(m=>/網路拓撲圖/.test(m.textContent) && /SVG/.test(m.textContent));
  await click(svgItem); await sleep(1500);
  out.push('SVG blob='+(lastBlob?`${lastBlob.type} ${lastBlob.size}B`:'無'));
  if(lastBlob){
    const txt = await lastBlob.text();
    out.push('XML 宣告='+txt.startsWith('<?xml'));
    out.push('含 xmlns='+/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/.test(txt));
    out.push('viewBox='+(txt.match(/viewBox="([^"]+)"/)||[,'無'])[1]);
    out.push('背景 rect='+/<rect[^>]*fill="[^"]+"/.test(txt));
    out.push('文字節點數='+(txt.match(/<text/g)||[]).length);
    out.push('殘留 CSS 變數='+(txt.match(/var\(--/g)||[]).length+'（應為 0）');
    out.push('殘留 class 屬性='+(txt.match(/ class="/g)||[]).length+'（應為 0）');
    b64 = await toB64(lastBlob);
  }
  // PNG 仍可用
  lastBlob=null;
  await click($$('button').find(b=>b.textContent.trim().startsWith('匯出'))); await sleep(300);
  await click($$('.mi').find(m=>/網路拓撲圖/.test(m.textContent) && /PNG/.test(m.textContent)));
  await sleep(2000);
  out.push('PNG 仍正常='+(lastBlob?`${lastBlob.type} ${lastBlob.size}B`:'無'));
 }catch(e){ out.push('EX: '+e.message+' @ '+(e.stack||'').split('\n')[1]); }
 const d=document.createElement('div'); d.id='__report';
 d.textContent='ERR['+errs.length+'] '+errs.slice(0,3).join(' ;; ')+'\n'+out.join('\n');
 document.body.append(d);
 const x=document.createElement('div'); x.id='__xlsx'; x.textContent=b64; document.body.append(x);
})();
</script>

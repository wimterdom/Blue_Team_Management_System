<script type="module">
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const click=async el=>{ el.click(); await sleep(180); };
(async()=>{
  await sleep(1200);
  $('#lg-u').value='admin'; $('#lg-p').value=window.__E2E_PW;
  await click($('#lg-btn')); await sleep(1800);
  $('#pw-cur').value=window.__E2E_PW;
  $('#pw-new').value=window.__E2E_NEW_PW; $('#pw-c2').value=window.__E2E_NEW_PW;
  await click($('#pw-btn')); await sleep(2500);
  await click($$('button').find(b=>/建立調查報告/.test(b.textContent))); await sleep(900);
  await click($$('button').find(b=>/挑選技術/.test(b.textContent))); await sleep(600);
  const inp=$('.modal input.inp');
  inp.value='credential'; inp.dispatchEvent(new Event('input')); await sleep(600);
  const d=document.createElement('div'); d.id='__report'; d.textContent='ready'; document.body.append(d);
})();
</script>

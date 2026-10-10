<script type="module">
/**
 * 專案封存與還原。
 *
 * 重點不在「按鈕會不會動」，而在三件事：
 *   1. 非管理員看不到、也繞不進去
 *   2. 還原前確實問了「要不要先封存目前專案」，且需手動輸入 REPLACE
 *   3. 還原後畫面上的資料真的換掉了
 */
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const out=[],errs=[];
window.addEventListener('error',e=>errs.push(e.message));
window.addEventListener('unhandledrejection',e=>errs.push('rej: '+(e.reason?.message||e.reason)));
const T=s=>{const n=$(s); return n?n.textContent.replace(/\s+/g,' ').trim():'X';};
const click=async el=>{ el.click(); await sleep(170); };
const btn=re=>$$('button').find(b=>re.test(b.textContent));

// 攔截下載，記錄檔名與位元組數，不真的存檔
const saved=[];
const realCreate=URL.createObjectURL.bind(URL);
// 連 Blob 本身一起留著：還原要用的就是使用者真正下載到的那一份
URL.createObjectURL=b=>{ saved.push({type:b.type,size:b.size,blob:b}); return realCreate(b); };
const realClick=HTMLAnchorElement.prototype.click;
HTMLAnchorElement.prototype.click=function(){
  if(this.download){ saved[saved.length-1].name=this.download; return; }
  return realClick.call(this);
};

const ANA_PW='Pr0be-Analyst-'+Math.random().toString(36).slice(2,10);

async function loginAs(u,p){
  $('#lg-u').value=u; $('#lg-p').value=p;
  await click($('#lg-btn')); await sleep(2000);
}
async function openMenu(){
  const w=$$('button').find(b=>/系統管理員|測試分析員/.test(b.textContent));
  if(w){ await click(w); await sleep(250); }
  return $$('.mi').map(m=>m.textContent.trim());
}
async function logout(){
  await openMenu();
  const q=$$('.mi').find(m=>/登出/.test(m.textContent));
  if(q){ await click(q); await sleep(1600); }
}

(async()=>{
 try{
  await sleep(1200);
  await loginAs('admin', window.__E2E_PW);
  // 強制改密
  $('#pw-cur').value=window.__E2E_PW;
  $('#pw-new').value=window.__E2E_NEW_PW; $('#pw-new').dispatchEvent(new Event('input'));
  $('#pw-c2').value=window.__E2E_NEW_PW;
  await click($('#pw-btn')); await sleep(2500);

  const {S,STORE,render,CASES}=window.__T;

  /* ---- 建一個一般分析員帳號 ---- */
  await STORE.users.create({id:'probe_ana',name:'測試分析員',role:'網路分析員',
    perm:'analyst',password:ANA_PW});
  out.push('建立分析員帳號 probe_ana（一般分析員）');

  /* ---- 1. 管理員選單應有「專案封存」 ---- */
  out.push('管理員選單：'+(await openMenu()).join(' / '));
  document.body.click(); await sleep(200);

  /* ---- 2. 分析員看不到、也繞不進去 ---- */
  await logout();
  await loginAs('probe_ana', ANA_PW);
  out.push('分析員選單：'+(await openMenu()).join(' / '));
  document.body.click(); await sleep(200);
  S.route='archive'; render(); await sleep(1000);
  out.push('分析員直接開 archive 路由：封存鈕='+(!!$('#arc-go'))
    +'｜拖放區='+(!!$('#arc-drop'))+'｜畫面訊息='+T('#arc-body h3'));
  await logout();

  /* ---- 3. 管理員進封存畫面 ---- */
  await loginAs('admin', window.__E2E_NEW_PW);
  const items=await openMenu();
  const mi=$$('.mi').find(m=>/專案封存/.test(m.textContent));
  if(!mi) throw new Error('管理員選單無專案封存：'+items.join('/'));
  await click(mi); await sleep(1500);
  out.push('封存畫面：標題='+T('h1')+'｜資料種類='
    +$$('#arc-body .spec-tbl tbody tr').length+' 類｜紀錄總數='
    +T('#arc-body .meta .tnum'));

  /* ---- 4. 產生封存檔 ---- */
  $('#arc-note').value='端對端測試';
  await click($('#arc-go'));
  for(let i=0;i<100 && !saved.length;i++) await sleep(250);
  const z=saved[saved.length-1]||{};
  out.push('封存產出：'+(z.name||'（逾時）')+'｜'+Math.round((z.size||0)/1024)+' KB｜'
    +z.type+'｜訊息='+T('#arc-msg'));

  /* ---- 5. 改動資料，才看得出還原生效 ---- */
  const before=CASES.length;
  const probeId=await STORE.nextId('cases');
  CASES.push({id:probeId, title:'封存後才建立，還原後應消失', sev:'低',
    verdict:'未判定', progress:'進行中', analyst:'admin', cat:'其他',
    occur:['2026-10-01 09:00','2026-10-01 10:00'], created:'2026-10-01 11:00',
    host:'PROBE-HOST', hostUser:'probe', tags:[], conns:[]});
  await STORE.flush();
  await sleep(600);
  out.push('新增測試資料 '+probeId+'：案件數 '+before+' → '+CASES.length);

  /* ---- 6. 餵真正的檔案輸入，走使用者會走的路。
           用的是步驟 4 下載到的那份封存檔——它成形於 CASE-0096 之前，
           所以還原後那筆資料應該要消失。 ---- */
  const file=new File([saved[0].blob], saved[0].name, {type:'application/zip'});
  const dt=new DataTransfer(); dt.items.add(file);
  $('#arc-file').files=dt.files;
  $('#arc-file').dispatchEvent(new Event('change'));
  await sleep(3200);
  out.push('封存檔預覽：'+T('#arc-preview .imp-sum')+'｜並列比較='
    +$$('#arc-preview .tbl tbody tr').length+' 列');

  const go=$$('#arc-preview button').find(b=>/以這份封存取代/.test(b.textContent));
  if(!go) throw new Error('找不到取代按鈕');
  await click(go); await sleep(900);

  /* ---- 7. 確認對話框的防呆 ---- */
  const pre=$$('input[name="arc-pre"]');
  out.push('詢問是否先封存：選項='+pre.length
    +'｜預設='+(pre[0]&&pre[0].checked?'先封存':'（未預選）')
    +'｜'+$$('.modal-body .radio').map(l=>l.textContent.trim()).join(' ／ '));
  out.push('未輸入 REPLACE：執行鈕 disabled='+$('#arc-do').disabled);
  $('#arc-confirm').value='REPLAC'; $('#arc-confirm').dispatchEvent(new Event('input'));
  await sleep(150);
  out.push('輸入 REPLAC（不完整）：disabled='+$('#arc-do').disabled);
  $('#arc-confirm').value='REPLACE'; $('#arc-confirm').dispatchEvent(new Event('input'));
  await sleep(150);
  out.push('輸入 REPLACE：disabled='+$('#arc-do').disabled);

  /* ---- 8. 執行還原。保留「先封存目前專案」，連帶驗證那條路徑 ---- */
  const n0=saved.length;
  await click($('#arc-do'));
  for(let i=0;i<200;i++){
    await sleep(250);
    if(S.route==='dashboard' && !$('#arc-do')) break;
  }
  out.push('還原前自動封存：新增下載 '+(saved.length-n0)+' 個（'
    +((saved[saved.length-1]||{}).name||'—')+'）');
  const after=window.__T.CASES;
  out.push('還原後：route='+S.route+'｜案件數='+after.length+'（封存時 '+before+'）'
    +'｜'+probeId+' 仍在='+after.some(c=>c.id===probeId)
    +'｜畫面列數='+$$('#tbody tr').length
    +'｜提示='+T('.toast'));
 }catch(e){ errs.push('FATAL: '+e.message); }

 const d=document.createElement('div'); d.id='__report';
 d.textContent='ERR['+errs.length+'] '+errs.slice(0,3).join(' ;; ')+'\n'+out.join('\n');
 document.body.append(d);
})();
</script>

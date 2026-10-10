<script type="module">
/* README 用的畫面截圖腳本。由 scripts/screenshots.sh 驅動，
   每次只拍一張——以 window.__SHOT 指定要拍哪一個畫面。 */
const sleep = ms => new Promise(r => setTimeout(r, ms));
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const click = async el => { if (el) { el.click(); await sleep(220); } };
const byText = (sel, re) => $$(sel).find(n => re.test(n.textContent));

async function login() {
  await sleep(1100);
  if (!$('#lg-u')) return;
  $('#lg-u').value = 'admin';
  $('#lg-p').value = window.__SHOT_PW;
  await click($('#lg-btn'));
  await sleep(2200);
}

async function switchApp(name) {
  await click($('#app-switch'));
  await sleep(250);
  const mi = $$('.appmi-txt').find(n => n.textContent.includes(name));
  await click(mi && mi.closest('button'));
  await sleep(2200);
}

/** 截圖前把捲軸拉到頂，避免拍到半截版面。 */
const top = () => window.scrollTo(0, 0);

const SHOTS = {
  async login() {
    await sleep(1400);           // 等登入頁的背景圖畫完
  },

  async cases() {
    await login();
    await sleep(900);
    top();
  },

  async caseDetail() {
    await login();
    await click($$('#tbody tr')[0]);
    await sleep(1400);
    top();
  },

  async requests() {
    await login();
    await switchApp('請求管理');
    top();
  },

  async assets() {
    await login();
    await switchApp('資產管理');
    top();
  },

  async assetImport() {
    await login();
    await switchApp('資產管理');
    await click(byText('button', /匯入 CSV/));
    await sleep(700);
    // 透過真正的檔案輸入觸發，拍到的就是使用者實際會看到的預覽
    const file = new File([window.__SHOT_NMAP], 'scan.xml', { type: 'text/xml' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const input = $('#csv-file');
    input.files = dt.files;
    input.dispatchEvent(new Event('change'));
    await sleep(2200);
  },

  async topology() {
    await login();
    await switchApp('主機標定');
    await sleep(1600);
    top();
  },

  async intel() {
    await login();
    await switchApp('情資管理');
    await sleep(1600);
    top();
  },

  async matrix() {
    await login();
    await switchApp('情資管理');
    await sleep(1200);
    await click(byText('button, a', /TTP Mapping|細部設定|完整矩陣/));
    await sleep(2000);
    top();
  },

  async audit() {
    await login();
    await click(byText('button', /系統管理員/));
    await sleep(300);
    await click($$('.mi').find(m => /稽核紀錄/.test(m.textContent)));
    await sleep(1500);
    top();
  },

  async light() {
    await login();
    // 切到日間模式：主題鈕循環 系統 → 日間 → 夜間
    for (let i = 0; i < 3; i += 1) {
      await click($('#theme-btn') || byText('button', /佈景|主題/));
      await sleep(350);
      if (document.documentElement.dataset.theme === 'light') break;
    }
    await sleep(900);
    top();
  },
};

(async () => {
  let err = '';
  try {
    await (SHOTS[window.__SHOT] || SHOTS.cases)();
  } catch (e) {
    err = e.message;
  }
  await sleep(500);
  const d = document.createElement('div');
  d.id = '__report';
  d.textContent = err ? 'ERR ' + err : 'ok';
  d.style.cssText = 'position:fixed;left:-9999px';
  document.body.append(d);
})();
</script>

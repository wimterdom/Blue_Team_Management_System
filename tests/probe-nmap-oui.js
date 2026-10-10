<script type="module">
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const out=[],errs=[];
window.addEventListener('error',e=>errs.push(e.message));
window.addEventListener('unhandledrejection',e=>errs.push('rej: '+(e.reason?.message||e.reason)));
const click=async el=>{ el.click(); await sleep(160); };
const T=()=>window.__T;
const XML="<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE nmaprun>\n<nmaprun scanner=\"nmap\" args=\"nmap -sS -sV -O -oX scan.xml 10.32.7.0/24\" start=\"1791600000\" version=\"7.95\">\n<host starttime=\"1791600001\" endtime=\"1791600050\">\n<status state=\"up\" reason=\"arp-response\" reason_ttl=\"0\"/>\n<address addr=\"10.32.7.61\" addrtype=\"ipv4\"/>\n<address addr=\"B0:83:FE:AA:BB:01\" addrtype=\"mac\" vendor=\"Dell Inc.\"/>\n<hostnames><hostname name=\"TPE-WEB-11.corp.local\" type=\"PTR\"/><hostname name=\"tpe-web-11\" type=\"user\"/></hostnames>\n<ports>\n<port protocol=\"tcp\" portid=\"22\"><state state=\"open\" reason=\"syn-ack\" reason_ttl=\"64\"/><service name=\"ssh\" product=\"OpenSSH\" version=\"9.6p1 Ubuntu 3ubuntu13\" method=\"probed\" conf=\"10\"/></port>\n<port protocol=\"tcp\" portid=\"80\"><state state=\"open\" reason=\"syn-ack\" reason_ttl=\"64\"/><service name=\"http\" product=\"nginx\" version=\"1.24.0\" method=\"probed\" conf=\"10\"/></port>\n<port protocol=\"tcp\" portid=\"443\"><state state=\"open\" reason=\"syn-ack\" reason_ttl=\"64\"/><service name=\"https\" product=\"nginx\" version=\"1.24.0\" method=\"probed\" conf=\"10\"/></port>\n<port protocol=\"tcp\" portid=\"3306\"><state state=\"closed\" reason=\"reset\" reason_ttl=\"64\"/><service name=\"mysql\" method=\"table\" conf=\"3\"/></port>\n</ports>\n<os><osmatch name=\"Linux 5.15 - 6.8\" accuracy=\"96\" line=\"1\"/><osmatch name=\"Linux 4.15\" accuracy=\"88\" line=\"2\"/></os>\n</host>\n<host starttime=\"1791600002\" endtime=\"1791600060\">\n<status state=\"up\" reason=\"arp-response\" reason_ttl=\"0\"/>\n<address addr=\"10.32.7.62\" addrtype=\"ipv4\"/>\n<address addr=\"2001:db8:32:7::62\" addrtype=\"ipv6\"/>\n<address addr=\"00:23:89:11:22:33\" addrtype=\"mac\" vendor=\"Hangzhou H3C Technologies\"/>\n<hostnames><hostname name=\"TPE-SW-LAB.corp.local\" type=\"PTR\"/></hostnames>\n<ports>\n<port protocol=\"tcp\" portid=\"22\"><state state=\"open\" reason=\"syn-ack\" reason_ttl=\"60\"/><service name=\"ssh\" product=\"Comware SSH\" method=\"probed\" conf=\"8\"/></port>\n<port protocol=\"tcp\" portid=\"161\"><state state=\"open\" reason=\"syn-ack\" reason_ttl=\"60\"/><service name=\"snmp\" method=\"table\" conf=\"3\"/></port>\n</ports>\n<os><osmatch name=\"H3C Comware 7\" accuracy=\"92\" line=\"3\"/></os>\n</host>\n<host>\n<status state=\"down\" reason=\"no-response\" reason_ttl=\"0\"/>\n<address addr=\"10.32.7.99\" addrtype=\"ipv4\"/>\n</host>\n<host starttime=\"1791600003\" endtime=\"1791600070\">\n<status state=\"up\" reason=\"syn-ack\" reason_ttl=\"128\"/>\n<address addr=\"10.32.7.44\" addrtype=\"ipv4\"/>\n<address addr=\"18:69:45:CC:DD:EE\" addrtype=\"mac\" vendor=\"TP-Link Systems\"/>\n<hostnames></hostnames>\n<ports>\n<port protocol=\"tcp\" portid=\"445\"><state state=\"open\" reason=\"syn-ack\" reason_ttl=\"128\"/><service name=\"microsoft-ds\" product=\"Windows Server 2019 microsoft-ds\" method=\"probed\" conf=\"10\"/></port>\n</ports>\n<os><osmatch name=\"Microsoft Windows Server 2019\" accuracy=\"94\" line=\"4\"/></os>\n</host>\n<runstats><finished time=\"1791600080\" timestr=\"Sat Oct 10 10:01:20 2026\" elapsed=\"80.12\"/><hosts up=\"3\" down=\"1\" total=\"4\"/></runstats>\n</nmaprun>\n";
const GNMAP="# Nmap 7.95 scan initiated Sat Oct 10 10:05:00 2026 as: nmap -sV -oG scan.gnmap 10.32.8.0/28\nHost: 10.32.8.5 (TPE-PRN-01.corp.local)\tStatus: Up\nHost: 10.32.8.5 (TPE-PRN-01.corp.local)\tPorts: 9100/open/tcp//jetdirect///, 631/open/tcp//ipp//CUPS 2.4/\tIgnored State: closed (997)\nHost: 10.32.8.9 ()\tStatus: Up\nHost: 10.32.8.9 ()\tPorts: 22/open/tcp//ssh//OpenSSH 8.9/, 3389/closed/tcp//ms-wbt-server///\n# Nmap done at Sat Oct 10 10:06:10 2026 -- 16 IP addresses (2 hosts up) scanned in 70.2 seconds\n";

(async()=>{
 try{
  await sleep(1200);
  $('#lg-u').value='admin'; $('#lg-p').value=window.__E2E_PW;
  await click($('#lg-btn')); await sleep(1800);
  $('#pw-cur').value=window.__E2E_PW;
  $('#pw-new').value=window.__E2E_NEW_PW; $('#pw-c2').value=window.__E2E_NEW_PW;
  await click($('#pw-btn')); await sleep(2500);

  /* ---- OUI ---- */
  const st=await T().STORE.oui.status();
  out.push(`OUI 資料：${st.loaded} 筆，取得於 ${st.retrieved}`);
  for(const mac of ['B0:83:FE:AA:BB:01','00:23:89:11:22:33','18:69:45:CC:DD:EE','F0:1B:24:00:00:01']){
    const m=await T().STORE.oui.lookup(mac);
    out.push(`  ${mac} → ${m? m.vendor:'查無'}${m&&m.originOverridden?` ※登錄國=${m.registryCountry}`:''}`);
  }

  /* ---- nmap XML ---- */
  out.push('XML 判定='+T().detectNmapFormat(XML)+'｜gnmap 判定='+T().detectNmapFormat(GNMAP));
  const px=T().parseNmap(XML);
  out.push(`XML：${px.meta.tool}｜存活主機 ${px.hosts.length}（掃 4 台、1 台 down）`);
  const rows=await T().nmapToRows(px);
  rows.forEach(r=>out.push(`  ${r.values.hostname} ip=${r.values.ip} mac=${r.values.mac||'-'} 廠商=${r.values.vendor||'-'} os=${r.values.os||'-'} 服務=${r.services.length} 網段=${r.values.cidr}`));
  out.push('  IPv6 帶入='+(rows.find(r=>r.values.ip==='10.32.7.62')||{}).values?.ipv6);

  /* ---- 轉成 CSV 後走同一條驗證 ---- */
  const csv=T().nmapRowsToCsv(rows);
  const v=T().validateAssetRows(T().parseCsv(csv));
  out.push(`轉 CSV 後驗證：可匯入 ${v.items.filter(x=>!x.errors.length).length}、有錯 ${v.items.filter(x=>x.errors.length).length}`);
  v.items.forEach(x=>{ if(x.errors.length) out.push(`    第${x.line}列 ${x.hostname}: ${x.errors.join('；')}`); });

  /* ---- gnmap ---- */
  const pg=T().parseNmap(GNMAP);
  out.push(`gnmap：主機 ${pg.hosts.length}`);
  const rg=await T().nmapToRows(pg);
  rg.forEach(r=>out.push(`  ${r.values.hostname} ip=${r.values.ip} 服務=${r.services.map(s=>s.port+'/'+s.name).join(',')}`));

  /* ---- 實際匯入 ---- */
  const before=T().ASSETS.length;
  v.items.forEach((it,i)=>{ it.services=rows[i].services; });
  T().commitAssetImport(v.items.filter(x=>!x.errors.length));
  await sleep(1500);
  out.push(`匯入：${before} → ${T().ASSETS.length} 筆`);
  const a=T().ASSETS.find(x=>x.hostname==='TPE-WEB-11');
  out.push('新資產='+(a?`${a.id} vendor=${a.vendor} os=${a.os} ip=${a.ip}`:'未建立'));
  const d=a?T().ADETAIL[a.id]:null;
  out.push('服務寫入='+(d?d.services.map(s=>s.port+'/'+s.name+(s.version?' '+s.version:'')).join('｜'):'無'));
  out.push('用途說明='+(d?d.purpose.slice(0,70).replace(/\n/g,' / '):'無'));

  /* ---- 服務合併不重複 ---- */
  const merged=T().mergeServices([{name:'ssh',port:'22',version:''}],[{name:'ssh',port:'22',version:'OpenSSH 9.6'},{name:'http',port:'80',version:'nginx'}]);
  out.push('服務合併='+JSON.stringify(merged));

  /* ---- 伺服器確認 ---- */
  const r=await fetch('/api/v1/collections/assets',{credentials:'same-origin'}).then(x=>x.json());
  out.push('伺服器資產數='+r.total+'｜含 TPE-WEB-11='+r.items.some(i=>i.data.hostname==='TPE-WEB-11'));
 }catch(e){ out.push('EX: '+e.message+' @ '+(e.stack||'').split('\n')[1]); }
 const d=document.createElement('div'); d.id='__report';
 d.textContent='ERR['+errs.length+'] '+errs.slice(0,3).join(' ;; ')+'\n'+out.join('\n');
 document.body.append(d);
})();
</script>

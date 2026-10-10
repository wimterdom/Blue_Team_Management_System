/* ============================================================
   nmap 報告 → 資產欄位
   ------------------------------------------------------------
   掃描結果直接丟進來就能建檔，不必先人工整理成 CSV。

   支援兩種輸出：
     -oX  XML      欄位最齊全（MAC、廠商、OS 指紋、服務版本），優先使用
     -oG  greppable 只有 IP／主機名／開放埠，資訊較少但常見於既有流程

   解析遵循 nmap 官方 DTD（docs/nmap.dtd）：
     address[@addrtype=ipv4|ipv6|mac]、address/@vendor
     hostnames/hostname/@name、os/osmatch/@name+@accuracy
     ports/port[state/@state='open']/service/@product+@version
   ============================================================ */

/** 這份文字看起來是哪一種 nmap 輸出？ */
function detectNmapFormat(text) {
  const head = text.slice(0, 4000);
  if (/<nmaprun\b/.test(head)) return 'xml';
  if (/^#\s*Nmap\s.*scan initiated/mi.test(head) && /\bHost:\s/m.test(text)) return 'gnmap';
  return null;
}

/**
 * 挑主機名稱。
 *
 * nmap 會同時給好幾個名稱並標示來源：PTR 是反解記錄（權威），
 * user 是使用者在命令列給的寫法。優先用 PTR，再取第一段網域標籤，
 * TPE-WEB-11.corp.local 就會成為 TPE-WEB-11——與系統既有的命名一致。
 * 純 IP 形式的「名稱」不算數。
 */
function pickHostname(entries) {
  if (!entries.length) return '';
  const label = n => (n.includes('.') && !/^\d+(\.\d+)*$/.test(n) ? n.split('.')[0] : n);
  const usable = entries.filter(e => e.name && !/^\d+(\.\d+)*$/.test(e.name));
  if (!usable.length) return '';
  const ptr = usable.find(e => e.type === 'PTR');
  return label((ptr || usable[0]).name);
}

const cidrOf = ip => {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/.exec(ip || '');
  // 掃描結果不含遮罩，依慣例以 /24 推定，匯入預覽中可改
  return m ? `${m[1]}.${m[2]}.${m[3]}.0/24` : '';
};

/* ---------- XML ---------- */

function parseNmapXml(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('XML 格式不正確，無法解析');

  const run = doc.querySelector('nmaprun');
  const meta = {
    tool: `${run?.getAttribute('scanner') || 'nmap'} ${run?.getAttribute('version') || ''}`.trim(),
    args: run?.getAttribute('args') || '',
    when: run?.querySelector('runstats finished')?.getAttribute('timestr') || '',
  };

  const hosts = [];
  for (const h of doc.querySelectorAll('host')) {
    // 只收掃描時存活的主機；down 的沒有建檔價值
    if (h.querySelector('status')?.getAttribute('state') !== 'up') continue;

    let ip = '';
    let ipv6 = '';
    let mac = '';
    let macVendor = '';
    for (const a of h.querySelectorAll('address')) {
      const t = a.getAttribute('addrtype');
      if (t === 'ipv4') ip = a.getAttribute('addr') || '';
      else if (t === 'ipv6') ipv6 = a.getAttribute('addr') || '';
      else if (t === 'mac') {
        mac = (a.getAttribute('addr') || '').toUpperCase();
        macVendor = a.getAttribute('vendor') || '';
      }
    }

    const entries = [...h.querySelectorAll('hostnames hostname')]
      .map(n => ({ name: n.getAttribute('name') || '', type: n.getAttribute('type') || '' }))
      .filter(e => e.name);
    const names = entries.map(e => e.name);

    const osm = [...h.querySelectorAll('os osmatch')]
      .sort((a, b) => Number(b.getAttribute('accuracy')) - Number(a.getAttribute('accuracy')))[0];

    const services = [];
    for (const p of h.querySelectorAll('ports port')) {
      if (p.querySelector('state')?.getAttribute('state') !== 'open') continue;
      const s = p.querySelector('service');
      const product = s?.getAttribute('product') || '';
      const version = s?.getAttribute('version') || '';
      services.push({
        name: s?.getAttribute('name') || `port-${p.getAttribute('portid')}`,
        port: p.getAttribute('portid') || '',
        version: [product, version].filter(Boolean).join(' '),
      });
    }

    hosts.push({
      ip, ipv6, mac, macVendor,
      hostname: pickHostname(entries),
      allHostnames: names,
      os: osm?.getAttribute('name') || '',
      osAccuracy: osm ? Number(osm.getAttribute('accuracy')) : null,
      cidr: cidrOf(ip),
      services,
    });
  }
  return { meta, hosts };
}

/* ---------- greppable ---------- */

/**
 * -oG 的每一行長這樣：
 *   Host: 10.32.9.10 (TPE-DC-01.corp.local)  Status: Up
 *   Host: 10.32.9.10 (TPE-DC-01.corp.local)  Ports: 53/open/tcp//domain///, 88/open/tcp//kerberos-sec///
 * 同一台主機會分散在多行，依 IP 合併。
 */
function parseNmapGrepable(text) {
  const byIp = new Map();
  const meta = { tool: 'nmap (greppable)', args: '', when: '' };

  const banner = /^#\s*Nmap\s+(\S+)\s+scan initiated\s+(.+?)\s+as:\s*(.+)$/mi.exec(text);
  if (banner) {
    meta.tool = `nmap ${banner[1]}`;
    meta.when = banner[2];
    meta.args = banner[3];
  }

  for (const line of text.split(/\r?\n/)) {
    const m = /^Host:\s+(\S+)\s+\(([^)]*)\)\s*(.*)$/.exec(line.trim());
    if (!m) continue;
    const [, ip, nameRaw, rest] = m;
    const entry = byIp.get(ip) || {
      ip, ipv6: '', mac: '', macVendor: '', hostname: '', allHostnames: [],
      os: '', osAccuracy: null, cidr: cidrOf(ip), services: [],
    };
    if (nameRaw && !entry.allHostnames.includes(nameRaw)) entry.allHostnames.push(nameRaw);

    const ports = /Ports:\s*(.+?)(?:\tIgnored|$)/.exec(rest);
    if (ports) {
      for (const chunk of ports[1].split(',')) {
        // portid/state/protocol/owner/service/rpc/version/
        const f = chunk.trim().split('/');
        if (f[1] !== 'open') continue;
        entry.services.push({ name: f[4] || `port-${f[0]}`, port: f[0] || '', version: f[6] || '' });
      }
    }
    const os = /OS:\s*([^\t]+)/.exec(rest);
    if (os) entry.os = os[1].trim();

    byIp.set(ip, entry);
  }

  const hosts = [...byIp.values()];
  hosts.forEach(h => { h.hostname = pickHostname(h.allHostnames.map(n => ({ name: n, type: 'PTR' }))); });
  return { meta, hosts };
}

function parseNmap(text) {
  const fmt = detectNmapFormat(text);
  if (fmt === 'xml') return { format: 'xml', ...parseNmapXml(text) };
  if (fmt === 'gnmap') return { format: 'gnmap', ...parseNmapGrepable(text) };
  throw new Error('看起來不是 nmap 的 XML（-oX）或 greppable（-oG）輸出');
}

/**
 * 把 nmap 主機轉成匯入用的 CSV 列。
 *
 * 沒有的欄位一律留空，不猜測——網段依 IPv4 推定 /24 是唯一的例外，
 * 且會在預覽中標示出來讓人確認。製造商優先用 nmap 自己判定的 MAC 廠商，
 * 查不到時再回退到系統的 IEEE 對照。
 */
async function nmapToRows(parsed) {
  const macs = parsed.hosts.map(h => h.mac).filter(Boolean);
  let oui = {};
  if (macs.length) {
    try { oui = await STORE.oui.batch(macs); } catch (e) { /* 查不到就留空 */ }
  }

  return parsed.hosts.map(h => {
    const hit = h.mac ? oui[h.mac] : null;
    // nmap 的廠商名沒有國別，系統的 OUI 對照有，所以優先用後者
    const vendor = hit?.vendor || h.macVendor || '';
    const svc = h.services;
    return {
      values: {
        id: '',
        hostname: h.hostname || (h.ip ? `HOST-${h.ip.replace(/\./g, '-')}` : ''),
        device: '',
        vendor,
        os: h.os,
        ip: h.ip,
        cidr: h.cidr,
        ipv6: h.ipv6,
        mac: h.mac,
        uplink: '',
        vlan: '',
        location: '',
        importance: '',
        analyst: '',
        tags: ['nmap', ...(svc.some(s => /^(http|https)$/.test(s.name)) ? ['web'] : [])].join(';'),
        purpose: buildPurpose(h),
      },
      services: svc,
      source: h,
    };
  });
}

function buildPurpose(h) {
  const parts = [];
  if (h.os) parts.push(`nmap 指紋判定為 ${h.os}${h.osAccuracy ? `（吻合度 ${h.osAccuracy}%）` : ''}。`);
  if (h.services.length) {
    const list = h.services.slice(0, 12)
      .map(s => `${s.port}/${s.name}${s.version ? ` ${s.version}` : ''}`).join('、');
    parts.push(`掃描到的開放埠：${list}${h.services.length > 12 ? ` 等 ${h.services.length} 項` : ''}。`);
  }
  if (h.allHostnames.length > 1) parts.push(`其他名稱：${h.allHostnames.join('、')}。`);
  return parts.join('\n\n');
}

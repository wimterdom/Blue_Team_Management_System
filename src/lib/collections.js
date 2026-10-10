/**
 * 集合登錄表。
 *
 * 五套子系統的資料在此集中定義：集合代碼、對外名稱、識別碼前綴，
 * 以及該集合在用戶端狀態樹中的鍵名（bootstrap 與同步時據此對應）。
 *
 * detail 類集合以「母紀錄的 id」為主鍵，所以沒有自己的編號序列。
 *
 * shared:true 代表「團隊共同維護」——任何登入者都能編輯，不限建立者。
 * 獵補計畫是全隊一起推進的工作（假說由一個人提出，分析與調查結果常由
 * 不同人補上），TTP 標註則是共用的覆蓋圖層，都不該綁在建立者身上。
 */
export const COLLECTIONS = {
  cases:          { label: '調查報告',     clientKey: 'cases',    idPrefix: 'CASE',  kind: 'list' },
  case_detail:    { label: '報告內容',     clientKey: 'detail',   parent: 'cases',   kind: 'map'  },
  requests:       { label: '請求表',       clientKey: 'requests', idPrefix: null,    kind: 'list' },
  request_detail: { label: '請求表內容',   clientKey: 'rdetail',  parent: 'requests', kind: 'map' },
  assets:         { label: '資產',         clientKey: 'assets',   idPrefix: null,    kind: 'list' },
  asset_detail:   { label: '資產內容',     clientKey: 'adetail',  parent: 'assets',  kind: 'map'  },
  sensors:        { label: '感測器佈署',   clientKey: 'sensors',  idPrefix: 'S',     kind: 'list' },
  apts:           { label: 'APT 組織報告', clientKey: 'apts',     idPrefix: 'APT',   kind: 'list' },
  intels:         { label: '情資報告',     clientKey: 'intels',   idPrefix: 'INTEL', kind: 'list' },
  hunts:          { label: '威脅獵補計畫', clientKey: 'hunts',    idPrefix: 'HUNT',  kind: 'list', shared: true },
  ttp_marks:      { label: 'TTP 標註',     clientKey: 'marks',    idPrefix: 'MARK',  kind: 'list', shared: true },
};

export const COLLECTION_NAMES = Object.keys(COLLECTIONS);

export const isCollection = name =>
  Object.prototype.hasOwnProperty.call(COLLECTIONS, name);

/** 用戶端狀態鍵 → 集合代碼 */
export const CLIENT_KEY_TO_COLLECTION = Object.fromEntries(
  Object.entries(COLLECTIONS).map(([name, c]) => [c.clientKey, name]),
);

/** 以 settings 表保存的整體設定（非逐筆紀錄）。 */
export const SETTING_KEYS = {
  ttpHidden: 'ttp_hidden',       // 熱圖技術顯示／隱藏
  siteTitle: 'site_title',
};

/**
 * 集合登錄表。
 *
 * 五套子系統的資料在此集中定義：集合代碼、對外名稱、識別碼前綴，
 * 以及該集合在用戶端狀態樹中的鍵名（bootstrap 與同步時據此對應）。
 *
 * detail 類集合以「母紀錄的 id」為主鍵，所以沒有自己的編號序列。
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
  hunts:          { label: '威脅獵補計畫', clientKey: 'hunts',    idPrefix: 'HUNT',  kind: 'list' },
  ttp_marks:      { label: 'TTP 標註',     clientKey: 'marks',    idPrefix: 'MARK',  kind: 'list' },
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

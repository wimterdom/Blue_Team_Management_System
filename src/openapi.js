/**
 * OpenAPI 3.1 文件。
 *
 * 規格要求「與其他系統的整合空間」，因此所有功能都走有文件的 API 層，
 * 而不是只有伺服器端算好的畫面。此文件由 /api/v1/openapi.json 提供，
 * 可直接匯入 Swagger UI、Postman 或 API Gateway。
 */
import { COLLECTIONS } from './lib/collections.js';
import { version } from './lib/version.js';

const err = desc => ({
  description: desc,
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/Error' },
    },
  },
});

export function buildOpenApi() {
  return {
    openapi: '3.1.0',
    info: {
      title: '藍隊管理系統 API',
      version,
      description:
        '獵補案件簿、請求管理、資產管理、主機標定與情資管理五套子系統共用的資料 API。\n\n' +
        '認證採會話 Cookie；寫入類請求需於 `X-BTMS-CSRF` 標頭帶回登入時取得的 csrfToken。\n\n' +
        '集合代碼：' +
        Object.entries(COLLECTIONS).map(([k, v]) => `\`${k}\`（${v.label}）`).join('、'),
    },
    servers: [{ url: '/api/v1' }],
    tags: [
      { name: 'auth', description: '認證與會話' },
      { name: 'data', description: '業務資料（五套子系統共用）' },
      { name: 'attachments', description: '附件' },
      { name: 'admin', description: '帳號管理與稽核' },
      { name: 'ops', description: '健康檢查與版本' },
    ],
    components: {
      securitySchemes: {
        sessionCookie: { type: 'apiKey', in: 'cookie', name: 'btms_session' },
        csrfHeader: { type: 'apiKey', in: 'header', name: 'X-BTMS-CSRF' },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            error: {
              type: 'object',
              properties: {
                code: { type: 'string', example: 'version_conflict' },
                message: { type: 'string', example: '這筆紀錄已被其他人修改，請重新載入後再儲存' },
              },
            },
          },
        },
        User: {
          type: 'object',
          properties: {
            id: { type: 'string', example: 'chen' },
            name: { type: 'string', example: '陳彥廷' },
            role: { type: 'string', example: '主機分析員' },
            perm: { type: 'string', enum: ['admin', 'manage', 'analyst'] },
            disabled: { type: 'boolean' },
            mustChangePassword: { type: 'boolean' },
          },
        },
        Record: {
          type: 'object',
          properties: {
            id: { type: 'string', example: 'CASE-0087' },
            collection: { type: 'string', example: 'cases' },
            version: { type: 'integer', example: 3, description: '樂觀鎖版本；更新時需帶回' },
            data: { type: 'object', additionalProperties: true },
            createdAt: { type: 'string', format: 'date-time' },
            createdBy: { type: 'string' },
            updatedAt: { type: 'string', format: 'date-time' },
            updatedBy: { type: 'string' },
          },
        },
        SyncOp: {
          type: 'object',
          required: ['collection', 'id'],
          properties: {
            collection: { type: 'string', enum: Object.keys(COLLECTIONS) },
            id: { type: 'string' },
            op: { type: 'string', enum: ['upsert', 'delete'], default: 'upsert' },
            version: { type: 'integer', description: '省略則不做樂觀鎖檢查' },
            data: { type: 'object', additionalProperties: true },
          },
        },
        Dashboard: {
          type: 'object',
          properties: {
            stats: {
              type: 'object',
              properties: {
                total: { type: 'integer' }, active: { type: 'integer' },
                malicious: { type: 'integer' }, week: { type: 'integer' },
              },
            },
            verdict: { type: 'array', items: { type: 'object' } },
            trend: { type: 'array', items: { type: 'object' } },
          },
        },
      },
    },
    security: [{ sessionCookie: [] }],
    paths: {
      '/auth/methods': {
        get: {
          tags: ['auth'], security: [],
          summary: '查詢可用的認證方式',
          description: '回傳本地帳密與（若啟用）SSO 的狀態，登入畫面據此決定要顯示什麼。',
          responses: { 200: { description: '成功' } },
        },
      },
      '/auth/login': {
        post: {
          tags: ['auth'], security: [],
          summary: '以帳號密碼登入',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['username', 'password'],
                  properties: {
                    username: { type: 'string' },
                    password: { type: 'string', format: 'password' },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: '登入成功，會話 Cookie 由 Set-Cookie 下發',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      user: { $ref: '#/components/schemas/User' },
                      csrfToken: { type: 'string' },
                      expiresAt: { type: 'string', format: 'date-time' },
                    },
                  },
                },
              },
            },
            401: err('帳號或密碼不正確'),
            403: err('帳號已停用'),
            429: err('失敗次數過多，帳號暫時鎖定'),
          },
        },
      },
      '/auth/logout': {
        post: { tags: ['auth'], summary: '登出並作廢會話', responses: { 200: { description: '成功' } } },
      },
      '/auth/me': {
        get: {
          tags: ['auth'], summary: '取得目前登入者',
          responses: { 200: { description: '成功' }, 401: err('未登入') },
        },
      },
      '/auth/password': {
        post: {
          tags: ['auth'], summary: '變更自己的密碼',
          description: '首次登入的強制變更也走這支。變更後該帳號其他裝置的會話一律失效。',
          security: [{ sessionCookie: [], csrfHeader: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['currentPassword', 'newPassword'],
                  properties: {
                    currentPassword: { type: 'string', format: 'password' },
                    newPassword: { type: 'string', format: 'password' },
                  },
                },
              },
            },
          },
          responses: { 200: { description: '成功' }, 400: err('密碼不符政策或目前密碼錯誤') },
        },
      },
      '/bootstrap': {
        get: {
          tags: ['data'],
          summary: '一次取回整棵資料樹',
          description: '用戶端啟動時呼叫，回傳所有集合、版本表、儀表板統計與帳號清單。',
          responses: { 200: { description: '成功' }, 401: err('未登入') },
        },
      },
      '/dashboard': {
        get: {
          tags: ['data'], summary: '儀表板統計（即時彙算）',
          description: '案件總數、進行中、惡意判定、近七日新增，以及判定分佈與近 14 日趨勢。' +
            '趨勢與新增數一律以「案發時間」落日，而非紀錄建立時間。',
          responses: {
            200: { description: '成功', content: { 'application/json': { schema: { $ref: '#/components/schemas/Dashboard' } } } },
          },
        },
      },
      '/collections/{collection}': {
        parameters: [
          { name: 'collection', in: 'path', required: true, schema: { type: 'string', enum: Object.keys(COLLECTIONS) } },
        ],
        get: {
          tags: ['data'], summary: '列出集合內的紀錄',
          parameters: [
            { name: 'owner', in: 'query', schema: { type: 'string' }, description: '僅列出指定帳號建立的紀錄' },
            { name: 'limit', in: 'query', schema: { type: 'integer' } },
            { name: 'offset', in: 'query', schema: { type: 'integer' } },
          ],
          responses: { 200: { description: '成功' }, 404: err('未知的集合') },
        },
        post: {
          tags: ['data'], summary: '建立紀錄',
          description: '未指定 id 時由系統配號（如 CASE-0096），避免多人同時建立撞號。',
          security: [{ sessionCookie: [], csrfHeader: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { id: { type: 'string' }, data: { type: 'object', additionalProperties: true } },
                },
              },
            },
          },
          responses: {
            201: { description: '已建立', content: { 'application/json': { schema: { $ref: '#/components/schemas/Record' } } } },
            409: err('編號已存在'),
          },
        },
      },
      '/collections/{collection}/{id}': {
        parameters: [
          { name: 'collection', in: 'path', required: true, schema: { type: 'string', enum: Object.keys(COLLECTIONS) } },
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        get: {
          tags: ['data'], summary: '取得單筆紀錄',
          responses: { 200: { description: '成功' }, 404: err('不存在') },
        },
        put: {
          tags: ['data'], summary: '更新紀錄',
          description: '帶 version 時做樂觀鎖檢查；版本不符回 409，由前端提示重新載入。',
          security: [{ sessionCookie: [], csrfHeader: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { version: { type: 'integer' }, data: { type: 'object', additionalProperties: true } },
                },
              },
            },
          },
          responses: {
            200: { description: '已更新' },
            403: err('一般分析員僅能修改自己建立的紀錄'),
            409: err('版本衝突'),
          },
        },
        delete: {
          tags: ['data'], summary: '刪除紀錄（軟刪除，稽核可追）',
          security: [{ sessionCookie: [], csrfHeader: [] }],
          responses: { 200: { description: '已刪除' }, 403: err('權限不足') },
        },
      },
      '/sync': {
        post: {
          tags: ['data'], summary: '批次同步異動',
          description: '一次送出多筆新增／更新／刪除，逐筆回報結果；單筆失敗不影響其餘。',
          security: [{ sessionCookie: [], csrfHeader: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { ops: { type: 'array', items: { $ref: '#/components/schemas/SyncOp' } } },
                },
              },
            },
          },
          responses: { 200: { description: '逐筆結果' } },
        },
      },
      '/next-id/{collection}': {
        get: {
          tags: ['data'], summary: '取得下一個可用編號',
          parameters: [{ name: 'collection', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: '成功' } },
        },
      },
      '/events': {
        get: {
          tags: ['data'], summary: '即時異動推播（SSE）',
          description: '以 EventSource 連線。事件：hello、record、users、settings。',
          responses: { 200: { description: 'text/event-stream 串流' } },
        },
      },
      '/attachments': {
        get: {
          tags: ['attachments'], summary: '列出某筆紀錄的附件',
          parameters: [
            { name: 'collection', in: 'query', required: true, schema: { type: 'string' } },
            { name: 'recordId', in: 'query', required: true, schema: { type: 'string' } },
          ],
          responses: { 200: { description: '成功' } },
        },
        post: {
          tags: ['attachments'], summary: '上傳附件（multipart/form-data）',
          description: '欄位順序須為 collection、recordId，然後才是檔案。' +
            '型別以實際位元組嗅探，僅接受影像；內容相同的檔案自動去重。',
          security: [{ sessionCookie: [], csrfHeader: [] }],
          responses: { 201: { description: '已上傳' }, 400: err('型別不支援'), 413: err('檔案過大') },
        },
      },
      '/attachments/{id}': {
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        get: { tags: ['attachments'], summary: '下載附件', responses: { 200: { description: '檔案內容' } } },
        delete: {
          tags: ['attachments'], summary: '刪除附件',
          security: [{ sessionCookie: [], csrfHeader: [] }],
          responses: { 200: { description: '已刪除' } },
        },
      },
      '/users': {
        get: { tags: ['admin'], summary: '列出帳號', responses: { 200: { description: '成功' }, 403: err('需管理員權限') } },
        post: {
          tags: ['admin'], summary: '建立帳號',
          security: [{ sessionCookie: [], csrfHeader: [] }],
          responses: { 201: { description: '已建立' }, 409: err('帳號已存在') },
        },
      },
      '/users/{id}': {
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        put: {
          tags: ['admin'], summary: '變更帳號（姓名、職務、權限、密碼、停用、解鎖）',
          security: [{ sessionCookie: [], csrfHeader: [] }],
          responses: { 200: { description: '已變更' }, 400: err('不得移除最後一名管理員') },
        },
        delete: {
          tags: ['admin'], summary: '刪除帳號',
          description: '名下仍有紀錄時改為停用，以保留報告的作者資訊與稽核鏈。',
          security: [{ sessionCookie: [], csrfHeader: [] }],
          responses: { 200: { description: '已處理' } },
        },
      },
      '/audit': {
        get: {
          tags: ['admin'], summary: '查詢稽核紀錄',
          parameters: [
            { name: 'user', in: 'query', schema: { type: 'string' } },
            { name: 'action', in: 'query', schema: { type: 'string' } },
            { name: 'collection', in: 'query', schema: { type: 'string' } },
            { name: 'recordId', in: 'query', schema: { type: 'string' } },
            { name: 'from', in: 'query', schema: { type: 'string', format: 'date-time' } },
            { name: 'to', in: 'query', schema: { type: 'string', format: 'date-time' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 100 } },
          ],
          responses: { 200: { description: '成功' }, 403: err('需管理員權限') },
        },
      },
      '/audit.csv': {
        get: { tags: ['admin'], summary: '匯出稽核紀錄 CSV', responses: { 200: { description: 'CSV 檔' } } },
      },
      '/healthz': { get: { tags: ['ops'], security: [], summary: '存活檢查', responses: { 200: { description: 'ok' } } } },
      '/readyz': { get: { tags: ['ops'], security: [], summary: '就緒檢查（含資料庫）', responses: { 200: { description: 'ready' }, 503: err('尚未就緒') } } },
      '/version': { get: { tags: ['ops'], security: [], summary: '版本資訊', responses: { 200: { description: '成功' } } } },
    },
  };
}

export default buildOpenApi;

# 接上企業 SSO

系統預設使用內建帳密認證。規格要求「認證內建，但要留有日後接 SSO 的空間」，
因此所有呼叫端一律只透過 `AuthProvider` 介面取得身分，不直接做帳密比對。
要接上外部識別提供者（IdP），只需補完本文件所述的兩個端點，
路由、前端與權限判斷都不必更動。

## 目前的接縫在哪裡

```
src/auth/provider.js
├── LocalProvider   內建帳密（argon2id）      ← 已實作
└── OidcProvider    OpenID Connect            ← 介面就緒，待接上 IdP
```

兩者都提供 `describe()` 與 `authenticate()`。登入頁呼叫 `GET /api/v1/auth/methods`
取得目前可用的認證方式，據此決定要顯示帳密欄位、SSO 按鈕，或兩者皆顯示——
前端不自行假設，因此啟用 SSO 後登入頁會自動多出按鈕，無需改前端。

`OidcProvider.upsertFromClaims()` 已經寫好：拿到 IdP 回傳的 claims 後，
以 `sub` 對應到本地帳號；首次登入者自動建檔，權限採 `BTMS_SSO_DEFAULT_PERM`
與 `BTMS_SSO_DEFAULT_ROLE` 的設定值。帳號的 `provider` 欄位記為 `oidc`，
`pw_hash` 為 NULL，這類帳號不能用密碼登入，也無法在系統內變更密碼。

## 還缺什麼

`src/routes/auth.js` 裡的兩個端點目前回 501，需要補完：

| 端點 | 要做的事 |
|---|---|
| `GET /api/v1/auth/sso/start` | 產生 `state` 與 PKCE `code_verifier`（存入短期會話），導向 IdP 的 authorization endpoint |
| `GET /api/v1/auth/sso/callback` | 驗證 `state`、以 authorization code 換 token、驗證 ID token 簽章與 `aud`／`iss`／`exp`、呼叫 `upsertFromClaims()`、`createSession()`、下發 Cookie |

建議直接用 `openid-client` 套件處理探索（discovery）、PKCE 與 token 驗證，
不要自己實作 JWT 驗簽。

```bash
npm install openid-client
```

實作時務必做到：

- **PKCE（S256）** 與 **state** 兩者都要，不可只做其中之一
- ID token 的 `iss`、`aud`、`exp`、`nonce` 逐項驗證
- `redirect_uri` 必須與 IdP 端登錄的值完全一致
- 回呼成功後沿用既有的 `createSession()`，讓 SSO 登入與本地登入共用同一套
  會話逾時、CSRF 與稽核機制

## 組態

```bash
BTMS_SSO_ENABLED=true
BTMS_SSO_ISSUER=https://login.microsoftonline.com/<tenant-id>/v2.0
BTMS_SSO_CLIENT_ID=<application-id>
BTMS_SSO_CLIENT_SECRET=<client-secret>
BTMS_SSO_REDIRECT_URI=https://btms.example.com/api/v1/auth/sso/callback
BTMS_SSO_SCOPES="openid profile email"

# 外部帳號首次登入時自動建檔所採用的預設權限
BTMS_SSO_DEFAULT_PERM=analyst
BTMS_SSO_DEFAULT_ROLE=網路分析員

# IdP 故障時仍可用本地帳密登入。強烈建議保持 true——
# 否則 IdP 一掛，連管理員都進不了系統。
BTMS_SSO_LOCAL_FALLBACK=true
```

## 權限對應

系統的權限只有三級（`admin` / `manage` / `analyst`），IdP 的群組不會自動對應。
首次以 SSO 登入的帳號一律套用 `BTMS_SSO_DEFAULT_PERM`，之後由管理員在
「使用者管理」調整。

若貴單位希望由 IdP 群組直接決定權限，在 `upsertFromClaims()` 裡依
`claims.groups` 或 `claims.roles` 映射即可，映射表建議放在組態而非程式碼中。
但請留意：權限交給 IdP 管之後，系統內就不該再允許手動調整同一個欄位，
否則兩邊會互相覆蓋。

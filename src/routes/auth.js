/** 認證路由：登入、登出、目前身分、變更密碼、SSO 端點。 */
import config from '../config.js';
import { getDb } from '../db/index.js';
import { getProvider, listProviders, AuthError, oidcProvider } from '../auth/provider.js';
import {
  COOKIE, createSession, destroySession, destroyUserSessions, cookieOptions,
} from '../auth/session.js';
import { hashPassword, verifyPassword, checkPasswordPolicy } from '../auth/password.js';
import { audit, reqMeta } from '../lib/audit.js';
import { badRequest, unauthorized, forbidden } from '../lib/errors.js';
import { nowIso } from '../lib/time.js';

const publicUser = u => ({
  id: u.id,
  name: u.name,
  role: u.role,
  perm: u.perm,
  provider: u.provider,
  mustChangePassword: Boolean(u.must_change_pw),
  lastLoginAt: u.last_login_at,
});

export default async function authRoutes(app) {
  /** 登入畫面據此決定顯示帳密欄位、SSO 按鈕或兩者。 */
  app.get('/auth/methods', async () => ({
    providers: listProviders(),
    ssoEnabled: config.sso.enabled,
  }));

  app.post(
    '/auth/login',
    {
      config: { rateLimit: { max: config.rateLimit.loginMax, timeWindow: config.rateLimit.loginWindowMs } },
      schema: {
        body: {
          type: 'object',
          required: ['username', 'password'],
          properties: {
            username: { type: 'string', minLength: 1, maxLength: 128 },
            password: { type: 'string', minLength: 1, maxLength: 256 },
          },
        },
      },
    },
    async (req, reply) => {
      const { username, password } = req.body;
      try {
        const { user } = await getProvider('local').authenticate({
          username, password, ip: req.ip,
        });
        const s = createSession(user.id, { ip: req.ip, userAgent: req.headers['user-agent'] });
        reply.setCookie(COOKIE, s.token, cookieOptions());
        audit({ ...reqMeta(req), userId: user.id, action: 'login', summary: '登入成功' });
        return { user: publicUser(user), csrfToken: s.csrf, expiresAt: s.expiresAt };
      } catch (err) {
        if (err instanceof AuthError) {
          audit({
            ...reqMeta(req), userId: null, action: 'login_failed',
            summary: `帳號 ${String(username).slice(0, 64)}：${err.code}`,
          });
          return reply.code(err.status).send({ error: { code: err.code, message: err.message } });
        }
        throw err;
      }
    },
  );

  app.post('/auth/logout', async (req, reply) => {
    const raw = req.cookies?.[COOKIE];
    if (req.user) {
      audit({ ...reqMeta(req), action: 'logout', summary: '登出' });
    }
    destroySession(raw);
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/auth/me', async req => {
    if (!req.user) throw unauthorized();
    return { user: publicUser(req.user), csrfToken: req.session.csrf };
  });

  /** 變更自己的密碼。首次登入強制變更也走這支。 */
  app.post(
    '/auth/password',
    {
      schema: {
        body: {
          type: 'object',
          required: ['currentPassword', 'newPassword'],
          properties: {
            currentPassword: { type: 'string', maxLength: 256 },
            newPassword: { type: 'string', maxLength: 256 },
          },
        },
      },
    },
    async (req, reply) => {
      const user = req.user;
      if (!user) throw unauthorized();
      if (user.provider !== 'local') {
        throw forbidden('此帳號由外部識別提供者管理，請至該系統變更密碼');
      }

      const ok = await verifyPassword(user.pw_hash, req.body.currentPassword);
      if (!ok) {
        audit({ ...reqMeta(req), action: 'password_change_failed', summary: '目前密碼不正確' });
        throw badRequest('目前密碼不正確', 'invalid_current_password');
      }

      const policy = checkPasswordPolicy(req.body.newPassword, {
        username: user.id, name: user.name,
      });
      if (!policy.ok) throw badRequest(policy.reason, 'weak_password');

      if (await verifyPassword(user.pw_hash, req.body.newPassword)) {
        throw badRequest('新密碼不得與目前密碼相同', 'password_reused');
      }

      getDb().prepare(
        'UPDATE users SET pw_hash = ?, must_change_pw = 0, updated_at = ? WHERE id = ?',
      ).run(await hashPassword(req.body.newPassword), nowIso(), user.id);

      // 其他裝置上的舊會話一併失效，只留目前這一個
      destroyUserSessions(user.id, req.cookies?.[COOKIE]);
      audit({ ...reqMeta(req), action: 'password_changed', summary: '已變更密碼' });
      return reply.send({ ok: true });
    },
  );

  /* ---- SSO：授權碼流程的兩個端點。未啟用時回 404，不暴露內部細節。 ---- */
  app.get('/auth/sso/start', async (req, reply) => {
    if (!config.sso.enabled) return reply.code(404).send({ error: { code: 'sso_disabled', message: 'SSO 未啟用' } });
    const d = oidcProvider.describe();
    if (!d.enabled) throw badRequest('SSO 組態不完整：缺少 issuer 或 client id', 'sso_misconfigured');
    // 實作授權碼流程時於此導向 IdP 的 authorization endpoint。
    // 介面已就緒，接上 IdP 只需補完此處與下方 callback。
    return reply.code(501).send({
      error: {
        code: 'sso_not_implemented',
        message: 'SSO 接縫已就緒，尚未接上實際 IdP。請參閱 docs/SSO.md',
      },
    });
  });

  app.get('/auth/sso/callback', async (req, reply) => {
    if (!config.sso.enabled) return reply.code(404).send({ error: { code: 'sso_disabled', message: 'SSO 未啟用' } });
    return reply.code(501).send({
      error: {
        code: 'sso_not_implemented',
        message: 'SSO 接縫已就緒，尚未接上實際 IdP。請參閱 docs/SSO.md',
      },
    });
  });
}

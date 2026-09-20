/** 結構化日誌。密碼、權杖、Cookie 一律遮蔽，避免機敏值落入日誌。 */
import config from '../config.js';

export const loggerOptions = {
  level: config.log.level,
  redact: {
    paths: [
      'req.headers.cookie',
      'req.headers.authorization',
      'res.headers["set-cookie"]',
      'password', '*.password', 'body.password', 'body.newPassword',
      'clientSecret', '*.clientSecret',
    ],
    censor: '[已遮蔽]',
  },
  serializers: {
    req(req) {
      return {
        method: req.method,
        url: req.url,
        ip: req.ip,
        user: req.user?.id,
      };
    },
  },
};

export default loggerOptions;

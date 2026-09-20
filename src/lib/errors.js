/** 統一錯誤格式：{ error: { code, message } }，避免把堆疊或內部細節外洩給用戶端。 */

export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest  = (msg, code = 'bad_request', d) => new HttpError(400, code, msg, d);
export const unauthorized = (msg = '請先登入', code = 'unauthorized') => new HttpError(401, code, msg);
export const forbidden   = (msg = '權限不足', code = 'forbidden') => new HttpError(403, code, msg);
export const notFound    = (msg = '找不到指定資料', code = 'not_found') => new HttpError(404, code, msg);
export const conflict    = (msg, code = 'conflict', d) => new HttpError(409, code, msg, d);
export const tooLarge    = (msg, code = 'payload_too_large') => new HttpError(413, code, msg);

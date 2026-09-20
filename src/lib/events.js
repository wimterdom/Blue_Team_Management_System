/**
 * 即時推播（Server-Sent Events）。
 *
 * 規格要求「分析員寫下的證據與時間軸，其他隊員要能立即看到」。
 * SSE 單向、走既有的 HTTP 連線、自動重連，比 WebSocket 更貼合這個需求，
 * 也不必在反向代理另開通道。
 */
const clients = new Set();
let seq = 0;

export function addClient(reply, userId) {
  const client = { reply, userId, id: ++seq };
  clients.add(client);
  return client;
}

export function removeClient(client) {
  clients.delete(client);
}

export function clientCount() {
  return clients.size;
}

/**
 * 廣播異動。originUserId 是發動者，該使用者自己的瀏覽器不必再收一次。
 */
export function broadcast(event, payload, originUserId = null) {
  const frame = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const c of [...clients]) {
    if (originUserId && c.userId === originUserId && payload?.skipOrigin !== false) continue;
    try {
      c.reply.raw.write(frame);
    } catch {
      clients.delete(c);
    }
  }
}

/** 心跳：避免反向代理因閒置切斷連線。 */
export function heartbeat() {
  for (const c of [...clients]) {
    try {
      c.reply.raw.write(': ping\n\n');
    } catch {
      clients.delete(c);
    }
  }
}

export function closeAll() {
  for (const c of [...clients]) {
    try { c.reply.raw.end(); } catch { /* 關閉期間忽略 */ }
  }
  clients.clear();
}

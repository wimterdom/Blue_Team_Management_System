/**
 * 即時推播端點。用戶端以 EventSource 連上，資料一有異動立即收到，
 * 不必輪詢，也符合規格「其他隊員要能立即看到」的要求。
 */
import { addClient, removeClient, clientCount } from '../lib/events.js';
import { unauthorized } from '../lib/errors.js';

export default async function eventRoutes(app) {
  app.get('/events', async (req, reply) => {
    if (!req.user) throw unauthorized();

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // 反向代理（nginx）需要這個標頭才不會緩衝 SSE
      'X-Accel-Buffering': 'no',
    });
    reply.raw.write('retry: 5000\n\n');
    reply.raw.write(`event: hello\ndata: ${JSON.stringify({ user: req.user.id })}\n\n`);

    const client = addClient(reply, req.user.id);
    req.raw.on('close', () => removeClient(client));

    // 交給 raw socket 管理，Fastify 不再接手回應
    return reply;
  });

  app.get('/events/status', async req => {
    if (!req.user) throw unauthorized();
    return { connected: clientCount() };
  });
}

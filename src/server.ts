import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { canonicalUrl } from './domain';
import type { World } from './world';
import { ProviderError } from './providers';

const pageInput = z.strictObject({ url: z.string().min(1).max(2048), from: z.string().max(2048).optional(), ctx: z.string().max(200).optional() });
const searchInput = z.strictObject({ query: z.string().trim().min(1).max(500) });
class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
async function body(req: IncomingMessage): Promise<unknown> {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new HttpError(415, 'Use application/json');
  let size = 0; const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16384) throw new HttpError(413, 'Request too large');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new HttpError(400, 'Invalid JSON'); }
}
export function createApp(world: World) {
  let active = 0;
  return createServer(async (req, res) => {
    const send = (status: number, data: unknown) => {
      if (!res.destroyed) { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); }
    };
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    try {
      const host = req.headers.host || '';
      const hostname = new URL(`http://${host}`).hostname;
      if (!['127.0.0.1', 'localhost', '[::1]', world.providers.config.host].includes(hostname)) throw new HttpError(403, 'Host not allowed');
      if (req.headers.origin && req.headers.origin !== `http://${host}`) throw new HttpError(403, 'Cross-origin request denied');
      const url = new URL(req.url || '/', `http://${host}`);
      if (req.method === 'GET' && url.pathname === '/api/health') return send(200, {
        mode: world.providers.config.mode, world: world.store.stats(),
        configured: true, upstreamConnectivity: 'not-probed',
      });
      if (req.method === 'POST' && ['/api/page', '/api/search'].includes(url.pathname)) {
        if (active >= 8) throw new HttpError(429, 'Too many materializations');
        active++;
        try {
          const input = await body(req);
          if (url.pathname === '/api/search') {
            const q = searchInput.parse(input); return send(200, await world.search(q.query));
          }
          const p = pageInput.parse(input);
          try { canonicalUrl(p.url); if (p.from) canonicalUrl(p.from); }
          catch { throw new HttpError(400, 'Invalid simulated URL'); }
          return send(200, await world.page(p.url, p.from, p.ctx));
        } finally { active--; }
      }
      if (req.method !== 'GET') throw new HttpError(405, 'Method not allowed');
      const files: Record<string, [string, string]> = {
        '/': ['index.html', 'text/html; charset=utf-8'], '/search': ['index.html', 'text/html; charset=utf-8'],
        '/view': ['index.html', 'text/html; charset=utf-8'],
        '/assets/app.js': ['assets/app.js', 'text/javascript; charset=utf-8'],
        '/assets/app.css': ['assets/app.css', 'text/css; charset=utf-8'],
      };
      const file = files[url.pathname]; if (!file) throw new HttpError(404, 'Not found');
      const bytes = await readFile(new URL(`../dist/${file[0]}`, import.meta.url));
      res.writeHead(200, { 'Content-Type': file[1] }); res.end(bytes);
    } catch (e) {
      if (e instanceof HttpError) send(e.status, { error: e.message });
      else if (e instanceof z.ZodError) send(400, { error: 'Invalid request or generated document' });
      else if (e instanceof ProviderError) send(e.status, { error: e.message });
      // Never return arbitrary exception text: it can contain provider bodies or secrets.
      else send(500, { error: 'Materialization failed. Check configuration or retry. No failed page was cached.' });
    }
  });
}
export async function listen(app: ReturnType<typeof createApp>, port: number, host = '127.0.0.1') {
  await new Promise<void>((resolve, reject) => { app.once('error', reject); app.listen(port, host, resolve); });
  const address = app.address();
  if (!address || typeof address === 'string') throw new Error('Unexpected server address');
  return `http://${host}:${address.port}`;
}

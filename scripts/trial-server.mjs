import http from 'node:http';
import { readFile, stat, realpath } from 'node:fs/promises';
import { resolve, relative, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Serve only the built trial. No source directory, APIs or working browser data.
const root = await realpath(fileURLToPath(new URL('../dist-trial/', import.meta.url)));
await stat(resolve(root, 'index.html'));
const port = Number(process.env.SJ_TRIAL_PORT || 4174);
const host = process.env.SJ_TRIAL_HOST || '127.0.0.1';
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const withinRoot = path => { const part = relative(root, path); return part !== '..' && !part.startsWith(`..${sep}`) && !part.includes(':'); };
const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Cache-Control', 'no-store');
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return; }
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (pathname === '/healthz') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(req.method === 'HEAD' ? undefined : '{"ok":true,"mode":"trial","sharedData":false}'); return; }
    const requested = pathname === '/' ? 'index.html' : pathname.slice(1);
    if (requested !== 'index.html' && requested !== 'favicon.svg' && !requested.startsWith('assets/')) throw new Error('Not found');
    const candidate = resolve(root, requested);
    if (!withinRoot(candidate)) throw new Error('Not found');
    const actual = await realpath(candidate);
    if (!withinRoot(actual) || !mime[extname(actual)]) throw new Error('Not found');
    const body = await readFile(actual);
    res.writeHead(200, { 'Content-Type': mime[extname(actual)], 'Content-Length': body.length });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Not found'); }
});
server.listen(port, host, () => console.log(`Trial only: http://${host}:${port}/#/schedule\nNo shared data or login. Ctrl+C to stop.`));

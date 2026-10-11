import { resolve } from 'node:path';
import { createWebsiteServer } from './app.ts';

const port = Number(process.env.SJ_PORT || 4175);
const host = process.env.SJ_HOST || '127.0.0.1';
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('SJ_PORT 必须为有效端口');
const app = createWebsiteServer({
  dataDir: resolve(process.env.SJ_DATA_DIR || '.data'),
  staticDir: resolve(process.env.SJ_STATIC_DIR || 'dist-website'),
  allowedOrigins: process.env.SJ_ALLOWED_ORIGINS?.split(',').map(origin => origin.trim()).filter(Boolean),
  secureCookies: process.env.SJ_COOKIE_SECURE === 'true',
  setupToken: process.env.SJ_SETUP_TOKEN,
  trustProxy: process.env.SJ_TRUST_PROXY?.split(',').map(proxy => proxy.trim()).filter(Boolean),
});
app.server.listen(port, host, () => {
  console.log(`序间网站已启动：http://${host}:${port}`);
  console.log('网站使用服务端数据库；首次初始化口令保存在数据目录 setup-token.txt（已初始化后不再提供）。');
});
app.server.on('error', error => { console.error('网站启动失败：', error.message); void app.close().finally(() => { process.exitCode = 1; }); });
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void app.close().then(() => { process.exitCode = 0; }); });

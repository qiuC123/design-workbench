import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, createHash, timingSafeEqual, scrypt as scryptCallback } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync, realpathSync, statSync } from 'node:fs';
import { resolve, join, sep, extname } from 'node:path';
import { BlockList, isIP } from 'node:net';
import { execute } from '../src/workspace/model.ts';
import { validateState } from '../src/workspace/storage.ts';
import { DEFAULT_COMPANIES } from '../src/workspace/seed.ts';
import type { Command, WorkbenchState } from '../src/workspace/types.ts';

const scrypt = promisify(scryptCallback);
const MAX_BODY = 5 * 1024 * 1024;
const COOKIE = 'sj_session';
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;
const COMMANDS = new Set(['saveProject', 'saveCompany', 'saveContact', 'setProjectStatus', 'reviewProject', 'deleteProject', 'dismissMigration']);
type Row = Record<string, string | number>;
export interface WorkspaceEnvelope { state: WorkbenchState; revision: number; updatedAt: string }
export interface WebsiteOptions {
  dataDir: string;
  staticDir?: string;
  allowedOrigins?: string[];
  secureCookies?: boolean;
  setupToken?: string;
  sessionTtlMs?: number;
  trustProxy?: string[];
}
export interface WebsiteApplication {
  server: Server;
  dataFile: string;
  setupTokenPath: string;
  close(): Promise<void>;
}
class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string, public extra?: object) { super(message); }
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const secret = () => randomBytes(32).toString('base64url');
function equal(a: string, b: string): boolean { return timingSafeEqual(Buffer.from(hash(a)), Buffer.from(hash(b))); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, '请求内容必须是 JSON 对象', 'VALIDATION');
  return value as Record<string, unknown>;
}
function string(value: unknown, label: string, max = 128): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new HttpError(400, `${label}格式无效`, 'VALIDATION');
  return value;
}
function password(value: unknown): string {
  const result = string(value, '密码');
  if (result.length < 10) throw new HttpError(400, '密码至少需要 10 位', 'VALIDATION');
  return result;
}
async function passwordHash(value: string, salt = randomBytes(16).toString('hex')): Promise<string> {
  return `${salt}:${(await scrypt(value, salt, 64) as Buffer).toString('hex')}`;
}
async function verifyPassword(value: string, encoded: string): Promise<boolean> {
  const [salt] = encoded.split(':');
  return equal(await passwordHash(value, salt), encoded);
}
async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) throw new HttpError(415, '请使用 JSON 请求');
  if (Number(req.headers['content-length']) > MAX_BODY) throw new HttpError(413, '上传内容超过 5 MB');
  const chunks: Buffer[] = [];
  let size = 0;
  req.setTimeout(10_000, () => req.destroy());
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, '上传内容超过 5 MB');
    chunks.push(chunk);
  }
  try { return object(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
  catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400, 'JSON 内容无法读取', 'VALIDATION'); }
}
function initialState(): WorkbenchState {
  const at = new Date().toISOString();
  return { version: 4, companies: DEFAULT_COMPANIES.map(company => ({ ...company, note: '', createdAt: at, updatedAt: at })), contacts: [], projects: [], activities: [] };
}
function command(value: unknown): Command {
  const candidate = object(value);
  if (typeof candidate.type !== 'string' || !COMMANDS.has(candidate.type)) throw new HttpError(400, '不支持的操作', 'VALIDATION');
  const payload = object(candidate.payload);
  if (candidate.type === 'reviewProject' && (typeof payload.approved !== 'boolean' || typeof payload.note !== 'string')) throw new HttpError(400, '核验结果格式无效', 'VALIDATION');
  return candidate as unknown as Command;
}

// Trust is granted to the directly connected proxy first, never to a header.
// Walk appended forwarding hops from the socket towards the client so a forged
// prefix supplied by an Internet visitor cannot choose a rate-limit identity.
function clientAddressResolver(proxies: string[]): (req: IncomingMessage) => string {
  const trusted = new BlockList();
  const normalize = (value: string) => value.startsWith('::ffff:') && isIP(value.slice(7)) === 4 ? value.slice(7) : value;
  for (const configured of proxies) {
    const [rawAddress, prefix, extra] = configured.trim().split('/');
    const address = normalize(rawAddress);
    const version = isIP(address);
    if (!version || extra !== undefined || (prefix !== undefined && (!/^\d+$/.test(prefix) || Number(prefix) < 1 || Number(prefix) > (version === 4 ? 32 : 128)))) throw new Error('SJ_TRUST_PROXY 只能填写明确的代理 IP 或 CIDR，不能信任全部来源');
    if (prefix === undefined) trusted.addAddress(address, version === 4 ? 'ipv4' : 'ipv6');
    else trusted.addSubnet(address, Number(prefix), version === 4 ? 'ipv4' : 'ipv6');
  }
  const isTrusted = (address: string) => {
    const version = isIP(address);
    return Boolean(version && trusted.check(address, version === 4 ? 'ipv4' : 'ipv6'));
  };
  return req => {
    const socket = normalize(req.socket.remoteAddress || 'unknown');
    const header = req.headers['x-forwarded-for'];
    if (!isTrusted(socket) || typeof header !== 'string' || header.length > 2048) return socket;
    const forwarded = header.split(',').map(value => normalize(value.trim()));
    if (!forwarded.length || forwarded.length > 32 || forwarded.some(value => !isIP(value))) return socket;
    let current = socket;
    for (let index = forwarded.length - 1; index >= 0 && isTrusted(current); index--) current = forwarded[index];
    return current;
  };
}

export function createWebsiteServer(options: WebsiteOptions): WebsiteApplication {
  const clientAddress = clientAddressResolver(options.trustProxy || []);
  const dataDir = resolve(options.dataDir);
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const dataFile = join(dataDir, 'workbench.sqlite');
  const setupTokenPath = join(dataDir, 'setup-token.txt');
  const staticDir = resolve(options.staticDir || 'dist-website');
  const secureCookies = options.secureCookies ?? false;
  const sessionTtl = options.sessionTtlMs ?? SESSION_TTL;
  const allowedOrigins = new Set((options.allowedOrigins || []).map(value => {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== value || url.username || url.password) throw new Error('SJ_ALLOWED_ORIGINS 必须使用完整 origin，例如 https://example.com，不含末尾斜杠或路径');
    return value;
  }));
  const db = new DatabaseSync(dataFile);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS admin (id INTEGER PRIMARY KEY CHECK(id=1), username TEXT NOT NULL, password_hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY CHECK(id=1), state TEXT NOT NULL, revision INTEGER NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, csrf TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS backups (id INTEGER PRIMARY KEY AUTOINCREMENT, state TEXT NOT NULL, revision INTEGER NOT NULL, created_at TEXT NOT NULL, project_count INTEGER NOT NULL, reason TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, payload_hash TEXT NOT NULL, revision INTEGER NOT NULL);
  `);
  if (!db.prepare('SELECT id FROM workspace WHERE id=1').get()) {
    db.prepare('INSERT INTO workspace (id,state,revision,updated_at) VALUES (1,?,0,?)').run(JSON.stringify(initialState()), new Date().toISOString());
  }
  const admin = () => db.prepare('SELECT username,password_hash FROM admin WHERE id=1').get() as Row | undefined;
  let setupToken = '';
  if (!admin()) {
    setupToken = options.setupToken || (existsSync(setupTokenPath) ? readFileSync(setupTokenPath, 'utf8').trim() : secret());
    if (setupToken.length < 16) { db.close(); throw new Error('初始化口令至少需要 16 位'); }
    if (!options.setupToken && !existsSync(setupTokenPath)) writeFileSync(setupTokenPath, `${setupToken}\n`, { flag: 'wx', mode: 0o600 });
  } else if (existsSync(setupTokenPath)) unlinkSync(setupTokenPath);
  const limits = new Map<string, { count: number; until: number }>();
  function rateLimit(req: IncomingMessage): void {
    const now = Date.now();
    for (const [key, entry] of limits) if (entry.until <= now) limits.delete(key);
    const key = clientAddress(req);
    const entry = limits.get(key) || { count: 0, until: now + 15 * 60 * 1000 };
    if (entry.count >= 10) throw new HttpError(429, '尝试次数较多，请 15 分钟后再试', 'RATE_LIMIT');
    entry.count += 1;
    limits.set(key, entry);
  }
  function workspace(): WorkspaceEnvelope {
    const row = db.prepare('SELECT state,revision,updated_at FROM workspace WHERE id=1').get() as Row;
    return { state: JSON.parse(String(row.state)), revision: Number(row.revision), updatedAt: String(row.updated_at) };
  }
  function json(res: ServerResponse, status: number, value: object): void {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(value));
  }
  function setCookie(res: ServerResponse, token: string, maxAge = Math.floor(sessionTtl / 1000)): void {
    res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureCookies ? '; Secure' : ''}`);
  }
  function newSession(res: ServerResponse): Row {
    const token = secret();
    const session = { hash: hash(token), csrf: secret(), expires: Date.now() + sessionTtl };
    db.prepare('DELETE FROM sessions WHERE expires <= ?').run(Date.now());
    db.prepare('INSERT INTO sessions (hash,csrf,expires) VALUES (?,?,?)').run(session.hash, session.csrf, session.expires);
    setCookie(res, token);
    return session;
  }
  function sessionFor(req: IncomingMessage): Row | undefined {
    const cookie = req.headers.cookie?.split(';').map(item => item.trim()).find(item => item.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
    if (!cookie || cookie.length > 128) return undefined;
    const session = db.prepare('SELECT hash,csrf,expires FROM sessions WHERE hash=? AND expires>?').get(hash(cookie), Date.now()) as Row | undefined;
    return session;
  }
  function sessionView(session?: Row): object {
    const owner = admin();
    return { initialized: Boolean(owner), authenticated: Boolean(owner && session), ...(owner && session ? { user: { username: owner.username }, csrfToken: session.csrf } : {}) };
  }
  function originCheck(req: IncomingMessage): void {
    const origin = req.headers.origin;
    const address = server.address();
    const localOrigins = typeof address === 'object' && address ? [`http://127.0.0.1:${address.port}`, `http://localhost:${address.port}`, `http://[::1]:${address.port}`] : [];
    if (!origin || !(allowedOrigins.size ? allowedOrigins.has(origin) : localOrigins.includes(origin))) throw new HttpError(403, '请求来源不受信任，请从配置的网站地址打开', 'ORIGIN');
  }
  function mutation(path: string, input: Record<string, unknown>): WorkspaceEnvelope {
    const requestId = string(input.requestId, '请求标识');
    if (!/^[a-zA-Z0-9_-]{16,128}$/.test(requestId) || !Number.isSafeInteger(input.expectedRevision) || Number(input.expectedRevision) < 0) throw new HttpError(400, '请求标识或版本无效', 'VALIDATION');
    const fingerprint = hash(JSON.stringify({ path, input }));
    db.exec('BEGIN IMMEDIATE');
    try {
      const previous = db.prepare('SELECT payload_hash FROM requests WHERE id=?').get(requestId) as Row | undefined;
      const current = workspace();
      if (previous) {
        if (!equal(String(previous.payload_hash), fingerprint)) throw new HttpError(409, '同一请求标识不能用于不同修改', 'REQUEST_REUSED');
        db.exec('COMMIT');
        return current;
      }
      if (input.expectedRevision !== current.revision) throw new HttpError(409, '项目已在其他窗口更新，请查看最新数据后重试', 'CONFLICT', { workspace: current });
      let next: WorkbenchState;
      let reason: string;
      try {
        if (path === '/api/commands') {
          const action = command(input.command);
          next = validateState(execute(current.state, action));
          reason = action.type;
        } else if (path === '/api/import') {
          next = validateState(input.state);
          reason = 'import';
        } else {
          const backupId = Number(input.backupId);
          if (!Number.isSafeInteger(backupId) || backupId < 1) throw new HttpError(400, '备份标识无效', 'VALIDATION');
          const backup = db.prepare('SELECT state FROM backups WHERE id=?').get(backupId) as Row | undefined;
          if (!backup) throw new HttpError(404, '备份不存在或已过保留期限', 'NOT_FOUND');
          next = validateState(JSON.parse(String(backup.state)));
          reason = 'restore';
        }
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw new HttpError(400, error instanceof Error && !(error instanceof TypeError) ? error.message : '提交的数据格式无效', 'VALIDATION');
      }
      const serialized = JSON.stringify(next);
      if (Buffer.byteLength(serialized) > MAX_BODY - 4096) throw new HttpError(413, '项目数据超过 5 MB，请先导出整理历史记录');
      const at = new Date().toISOString();
      db.prepare('INSERT INTO backups (state,revision,created_at,project_count,reason) VALUES (?,?,?,?,?)').run(JSON.stringify(current.state), current.revision, at, current.state.projects.length, reason);
      db.prepare('UPDATE workspace SET state=?,revision=?,updated_at=? WHERE id=1').run(serialized, current.revision + 1, at);
      db.prepare('INSERT INTO requests (id,payload_hash,revision) VALUES (?,?,?)').run(requestId, fingerprint, current.revision + 1);
      db.exec('DELETE FROM backups WHERE id NOT IN (SELECT id FROM backups ORDER BY id DESC LIMIT 30)');
      db.exec('COMMIT');
      return { state: next, revision: current.revision + 1, updatedAt: at };
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  async function api(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
    if (req.method !== 'GET' && req.method !== 'POST') throw new HttpError(405, '不支持的请求方法');
    const session = sessionFor(req);
    if (req.method === 'GET' && path === '/api/session') { json(res, 200, sessionView(session)); return; }
    if (req.method === 'POST') originCheck(req);
    if (req.method === 'POST' && (path === '/api/setup' || path === '/api/login')) {
      rateLimit(req);
      const input = await body(req);
      const username = string(input.username, '用户名', 64).trim();
      const suppliedPassword = password(input.password);
      if (path === '/api/setup') {
        if (admin()) throw new HttpError(409, '网站已完成初始化，请登录', 'INITIALIZED');
        if (typeof input.token !== 'string' || !equal(input.token, setupToken)) throw new HttpError(403, '初始化口令无效', 'SETUP_TOKEN');
        const encoded = await passwordHash(suppliedPassword);
        db.exec('BEGIN IMMEDIATE');
        try {
          if (admin()) throw new HttpError(409, '网站已完成初始化，请登录', 'INITIALIZED');
          db.prepare('INSERT INTO admin (id,username,password_hash) VALUES (1,?,?)').run(username, encoded);
          const created = newSession(res);
          db.exec('COMMIT');
          setupToken = '';
          if (existsSync(setupTokenPath)) unlinkSync(setupTokenPath);
          json(res, 200, sessionView(created));
        } catch (error) { if (db.isTransaction) db.exec('ROLLBACK'); throw error; }
      } else {
        const owner = admin();
        const stored = owner ? String(owner.password_hash) : '00000000000000000000000000000000:invalid';
        const matches = await verifyPassword(suppliedPassword, stored);
        if (!owner || !equal(username, String(owner.username)) || !matches || admin()?.password_hash !== owner.password_hash) throw new HttpError(401, '用户名或密码不正确', 'AUTH');
        json(res, 200, sessionView(newSession(res)));
      }
      limits.delete(clientAddress(req));
      return;
    }
    if (!session) throw new HttpError(401, '请先登录', 'AUTH');
    if (req.method === 'POST' && (typeof req.headers['x-csrf-token'] !== 'string' || !equal(req.headers['x-csrf-token'], String(session.csrf)))) throw new HttpError(403, '登录校验已失效，请刷新页面重试', 'CSRF');
    if (req.method === 'GET' && (path === '/api/workspace' || path === '/api/export')) {
      if (path === '/api/export') res.setHeader('Content-Disposition', 'attachment; filename="workbench-backup.json"');
      json(res, 200, workspace()); return;
    }
    if (req.method === 'GET' && path === '/api/backups') {
      const rows = db.prepare('SELECT id,created_at,project_count,reason FROM backups ORDER BY id DESC').all() as Row[];
      json(res, 200, { backups: rows.map(row => ({ id: row.id, createdAt: row.created_at, projectCount: row.project_count, reason: row.reason })) }); return;
    }
    if (req.method === 'POST' && path === '/api/logout') {
      db.prepare('DELETE FROM sessions WHERE hash=?').run(session.hash);
      setCookie(res, '', 0); json(res, 200, sessionView()); return;
    }
    if (req.method === 'POST' && path === '/api/password') {
      rateLimit(req);
      const input = await body(req);
      const currentPassword = string(input.currentPassword, '当前密码');
      const newPassword = password(input.newPassword);
      const owner = admin()!;
      if (!await verifyPassword(currentPassword, String(owner.password_hash))) throw new HttpError(401, '当前密码不正确', 'PASSWORD');
      const encoded = await passwordHash(newPassword);
      db.exec('BEGIN IMMEDIATE');
      try {
        // Do not overwrite a concurrent password change using an old credential.
        if (admin()!.password_hash !== owner.password_hash) throw new HttpError(409, '密码已在其他窗口修改，请重新登录', 'CONFLICT');
        db.prepare('UPDATE admin SET password_hash=? WHERE id=1').run(encoded);
        db.exec('DELETE FROM sessions');
        const created = newSession(res);
        db.exec('COMMIT');
        json(res, 200, sessionView(created));
      } catch (error) { if (db.isTransaction) db.exec('ROLLBACK'); throw error; }
      return;
    }
    if (req.method === 'POST' && ['/api/commands', '/api/import', '/api/restore'].includes(path)) {
      json(res, 200, mutation(path, await body(req))); return;
    }
    throw new HttpError(404, '接口不存在', 'NOT_FOUND');
  }
  function serveStatic(req: IncomingMessage, res: ServerResponse, path: string): void {
    if (!['GET', 'HEAD'].includes(req.method || '')) throw new HttpError(405, '不支持的请求方法');
    if (!['/', '/index.html', '/favicon.svg'].includes(path) && !/^\/assets\/[a-zA-Z0-9_./-]+$/.test(path)) throw new HttpError(404, '页面不存在');
    let file: string;
    try {
      const root = realpathSync(staticDir);
      file = realpathSync(join(root, path === '/' ? 'index.html' : path));
      if (!file.startsWith(root + sep) || !statSync(file).isFile()) throw new Error('outside');
    } catch { throw new HttpError(404, '页面文件不存在，请先构建网站'); }
    const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': path.startsWith('/assets/') ? 'public, max-age=3600' : 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : readFileSync(file));
  }
  const server = createServer((req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'");
    void (async () => {
      const path = new URL(req.url || '/', 'http://localhost').pathname;
      if (path === '/healthz' && req.method === 'GET') { json(res, 200, { ok: true, mode: 'website', sharedData: true }); return; }
      if (path.startsWith('/api/')) await api(req, res, path);
      else {
        let decoded: string;
        try { decoded = decodeURIComponent(path); } catch { throw new HttpError(400, '页面地址格式无效'); }
        serveStatic(req, res, decoded);
      }
    })().catch(error => {
      const known = error instanceof HttpError;
      if (!res.headersSent) json(res, known ? error.status : 500, { error: known ? error.message : '服务器暂时无法处理，请稍后重试', ...(known && error.code ? { code: error.code } : {}), ...(known && error.extra ? error.extra : {}) });
      else res.end();
      if (!known) console.error('[website] request failed:', error instanceof Error ? error.message : 'unknown');
    });
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.timeout = 15_000;
  let closed = false;
  return { server, dataFile, setupTokenPath, close: async () => {
    if (closed) return;
    closed = true;
    if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    db.close();
  } };
}

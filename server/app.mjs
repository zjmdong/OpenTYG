/**
 * OpenTYG 后端：一个零依赖的 Node HTTP 服务。
 *
 *  浏览器 ⇄ 本服务(/api) ⇄ 桃园谷 SDK(TygClient) ⇄ 官方服务
 *
 *  - 上游地址、token、authcode、密码不返回浏览器，必要登录 token 仅加密持久化；
 *  - 每个用户独立的登录凭据（AES-256-GCM 加密落盘）与独立的 SDK 会话（含门禁 WebSocket）；
 *  - 同一进程同时托管前端静态文件，单容器单端口交付。
 */
import http from 'node:http';
import { FRONTEND_CSP } from './frontend-policy.mjs';
import { AuthLimits } from './auth-limits.mjs';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fail, toAppError } from './errors.mjs';
import { SecretStore, deriveUserId, deriveDeviceId } from './store.mjs';
import { SessionPool, Session } from './service.mjs';
import { loadAppSecret, requestPolicy, RateLimiter } from './request-security.mjs';
import { SessionRegistry, clearSessionCookie, readSessionCookie, setSessionCookie } from './session.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const WEB_ROOT = resolve(HERE, '../web');
const APP_VERSION = '1.2.4';
const MAX_BODY_BYTES = 64 * 1024;
const MAX_NAME_LENGTH = 20;
const DEFAULT_COOLDOWN_MS = 3000;
const MAX_ANONYMOUS_CLIENTS = 40;

const STATIC_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

const maskAccount = value => {
  const text = String(value ?? '');
  if (/^\d{11}$/.test(text)) return `${text.slice(0, 3)}****${text.slice(7)}`;
  if (text.length <= 2) return text ? `${text[0]}*` : '';
  return `${text[0]}***${text.slice(-1)}`;
};

/**
 * 前端可见的用户视图。
 *
 *  - `userAccount` 由服务端 uid 派生，**不使用上游账号标识**（凭据类信息不跨出本进程）；
 *  - `displayName` 是用户在本应用内自取的名称（存在偏好里）。桃园谷未返回姓名时，
 *    SDK 也不提供修改上游姓名的接口，因此这里用「本应用显示名」兜底。
 */
const deriveUserAccountId = uid => (typeof uid === 'string' && uid.length >= 8 ? `u-${uid.slice(0, 8)}` : '');

const userView = (user, uid, displayName = '') => {
  if (!user) return null;
  const upstreamName = String(user.name || '').trim();
  const custom = String(displayName || '').trim();
  return {
    name: custom || upstreamName || '未命名用户',
    upstreamName,
    hasCustomName: !!custom,
    account: maskAccount(user.account),
    userAccount: deriveUserAccountId(uid),
    loginType: user.loginType === 'password' ? 'password' : 'sms',
    maskedAccount: maskAccount(user.account),
  };
};

const householdView = room => ({
  id: room.id,
  areaName: room.areaName || '',
  householdAddress: room.householdAddress || '',
  householdSerial: room.householdSerial || '',
  organizationSeq: room.organizationSeq || '',
  validityDescription: room.validityDescription || '',
  valid: room.valid || '',
  available: room.available === true,
  validEndDate: room.validEndDate || '',
  packageValidEndDate: room.packageValidEndDate || '',
});

/* 用户偏好：数据模型在 server/prefs.mjs（纯函数，可脱离 HTTP 单测） */
import {
  MAX_FAVORITES, PREFS_SCHEMA_VERSION, emptyPrefs, isLegacyPrefs, adoptLegacy,
  householdPrefs, setHouseholdPrefs, normalizePrefs,
  addFavorite, removeFavorite, buildDoors, favoritesOf,
} from './prefs.mjs';

class Logger {
  constructor({ quiet = false } = {}) { this.quiet = quiet; }
  #write(level, message, fields = {}) {
    if (this.quiet) return;
    const payload = Object.entries(fields).filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${key}=${value}`).join(' ');
    process.stdout.write(`[${new Date().toISOString()}] ${level} ${message}${payload ? ` ${payload}` : ''}\n`);
  }
  info(message, fields) { this.#write('INFO', message, fields); }
  warn(message, fields) { this.#write('WARN', message, fields); }
  error(message, fields) { this.#write('ERROR', message, fields); }
}

export async function createApp({
  port = Number(process.env.PORT || 8787),
  host = process.env.HOST || '0.0.0.0',
  dataDir = process.env.DATA_DIR || join(HERE, '..', 'data'),
  origin = process.env.TYG_ORIGIN || '',
  appSecret = loadAppSecret(),
  publicOrigin = process.env.PUBLIC_ORIGIN || '',
  cookieSecure = process.env.COOKIE_SECURE === undefined ? undefined : process.env.COOKIE_SECURE === '1',
  localTest = process.env.LOCAL_TEST_MODE === '1',
  allowInsecureUpstream = process.env.ALLOW_INSECURE_UPSTREAM === '1',
  allowedUpstreamHosts = process.env.UPSTREAM_ALLOWED_HOSTS || '',
  authClock = Date.now,
  logger = new Logger({ quiet: process.env.LOG_QUIET === '1' }),
} = {}) {
  const policy = requestPolicy({ publicOrigin, cookieSecure, localTest, host });
  if (Buffer.byteLength(appSecret) < 32) throw new Error('生产模式需配置至少 32 字节随机 APP_SECRET_FILE 或 APP_SECRET');
  if (!origin && !allowInsecureUpstream) throw new Error('请配置 HTTPS TYG_ORIGIN，或显式设置 ALLOW_INSECURE_UPSTREAM=1 以兼容 HTTP 上游');
  if (origin && new URL(origin).protocol !== 'https:' && !allowInsecureUpstream) throw new Error('上游传输未加密，已拒绝启动');
  let upstreamOrigin = origin;
  if (!upstreamOrigin) {
    const { DEFAULT_ORIGIN } = await import('./vendor/tyg-core-sdk/src/tyg-client.mjs');
    upstreamOrigin = DEFAULT_ORIGIN;
  }

  const store = new SecretStore({ directory: dataDir, wrappingSecret: appSecret });
  await store.init();
  const secret = appSecret;
  const transport = { allowInsecureTransport: allowInsecureUpstream,
    onPreparation: fields => logger.info('连接准备耗时', fields),
    allowedHosts: allowedUpstreamHosts.split(',').map(x => x.trim().toLowerCase()).filter(Boolean), retainIntercomPassword: false };
  if (!transport.allowedHosts.length) transport.allowedHosts = [new URL(upstreamOrigin).hostname.toLowerCase()];
  const pool = new SessionPool({ origin: upstreamOrigin, secret, transport,
    canRetain: uid => [...registry.entries.values()].some(entry => entry.uid === uid && !registry.expired(entry)),
    onEvict: uid => logger.info('会话回收', { user: uid.slice(0, 8) }) });
  // 会话表必须持久化：否则服务重启后 cookie 合法但取不到 uid，用户会被要求重新登录。
  const registry = new SessionRegistry({ secret, key: store.key, path: join(store.directory, 'sessions.json') });
  registry.load();
  if (registry.loaded) logger.info('已恢复本机会话表', { sessions: registry.loaded });
  if (registry.loadError) logger.warn('会话表载入失败，已重置', { reason: registry.loadError });
  const captchaIndex = new Map();
  const anonymous = new Map(); // 未登录阶段的图形码/短信客户端，按匿名会话隔离
  const limiter = new RateLimiter(secret, { now: authClock });
  const authLimits = new AuthLimits({ secret, key: store.key, path: join(store.directory, 'auth-limits.json'), now: authClock });
  try { authLimits.load(); } catch (error) { pool.closeAll(); throw error; }
  const userLocks = new Set();
  const loginLocks = new Set();
  const hasRememberedLogin = uid => loginLocks.has(uid) || userLocks.has(uid) || [...registry.entries.values()].some(entry => entry.uid === uid && entry.remember && !registry.expired(entry));
  const retainDuringPrune = uid => { if (hasRememberedLogin(uid)) return true; userLocks.add(uid); return false; };
  const pruneUsers = () => store.pruneUsers(retainDuringPrune, uid => userLocks.delete(uid));
  try { await pruneUsers(); } catch (error) { pool.closeAll(); throw error; }
  let pruneTask = null;

  const sweepTimer = setInterval(() => {
    const removed = pool.sweep();
    if (removed) logger.info('闲置会话回收', { count: removed });
    try { registry.sweep(); } catch { logger.error('会话存储失败', { code: 'CREDENTIAL_STORE_UNAVAILABLE' }); }
    if (!pruneTask) {
      pruneTask = pruneUsers().catch(() => logger.error('过期凭据清理失败', {code:'CREDENTIAL_STORE_UNAVAILABLE'})).finally(() => {pruneTask=null;});
    }
    for (const [id, info] of captchaIndex) if (Date.now() - info.createdAt >= 600_000 || !anonymous.has(info.sessionKey)) captchaIndex.delete(id);
    for (const [key, value] of anonymous) {
      if (Date.now() - value.lastUsedAt > 10 * 60 * 1000) { value.session.clearLocal(); anonymous.delete(key); }
    }
  }, 60_000);
  sweepTimer.unref();

  logger.info('OpenTYG 后端已启动', {
    version: APP_VERSION, port, mode: 'official', data: store.directory,
  });

  // ---------------------------------------------------------------- 请求工具

  const makeHelpers = (req, res) => {
    const helperStartedAt = performance.now();
    const readJson = async () => {
      if (!/^application\/json\b/i.test(String(req.headers['content-type'] || ''))) throw fail('CONTENT_TYPE');
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          // 请求体还没读完就拒绝：必须关闭连接，否则残余字节会破坏 keep-alive 的帧边界
          // （下一个请求会被解析成上一个请求的剩余 body）。
          res._unreadBody = true;
          throw fail('BODY_TOO_LARGE');
        }
        chunks.push(chunk);
      }
      if (!size) return {};
      let parsed;
      try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw fail('INVALID_JSON'); }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw fail('INVALID_JSON');
      return parsed;
    };
    const string = (body, key, { fallback = '', max = 1024, required = false, pattern, trim = true } = {}) => {
      const value = body[key] ?? fallback;
      if (typeof value !== 'string') throw fail('INVALID_INPUT', `${key} 必须为字符串`);
      const result = trim ? value.trim() : value;
      if (required && !result) throw fail('INVALID_INPUT', `${key} 不能为空`);
      if (result.length > max) throw fail('INVALID_INPUT', `${key} 过长`);
      if (pattern && result && !pattern.test(result)) throw fail('INVALID_INPUT', `${key} 格式不正确`);
      return result;
    };
    const send = (data) => {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ ok: true, data }));
      const path = String(req.url || '').split('?')[0];
      if (['/api/bootstrap','/api/auth/session','/api/doors','/api/doors/open'].includes(path)) {
        try { logger.info('请求耗时', { path, ms: Math.round(performance.now() - helperStartedAt) }); } catch { /* telemetry only */ }
      }
    };
    const secure = () => policy.secure;
    return { readJson, string, send, secure };
  };

  /**
   * 图形码阶段的匿名客户端（不落盘、不参与用户会话池）。
   *
   * 重要：同一个浏览器可能再次走登录链路（退出后重新登录、换账号、登录失败后重试）。
   * 若复用一个已登录的 SDK 客户端，登录接口会返回 ALREADY_LOGGED_IN，用户将被永久卡住。
   * 因此这里在发现客户端已登录时创建一个全新的客户端承接新的图形码链路。
   */
  function anonymousClient(key, mobile) {
    const now = Date.now();
    let holder = anonymous.get(key);
    if (holder && (holder.session.authenticated() || holder.mobile !== mobile)) {
      holder.session.clearLocal();
      holder = null;
    }
    if (!holder) {
      holder = { session: new Session(`anon:${key}:${now}`, { origin: upstreamOrigin, deviceId: deriveDeviceId(secret, mobile), transport }), mobile, lastUsedAt: now };
      anonymous.set(key, holder);
      if (anonymous.size > MAX_ANONYMOUS_CLIENTS) {
        const oldest = [...anonymous.entries()].sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt)[0];
        if (oldest) { oldest[1].session.clearLocal(); anonymous.delete(oldest[0]); }
      }
    }
    holder.lastUsedAt = now;
    return holder.session;
  }

  /** 登录成功收尾：改挂正式 uid、按需落盘凭据、下发 cookie、自动准备门禁。 */
  async function finishLogin({ session, uid, account, remember, entry, res, secure, send, sessionPayload }) {
    session.uid = uid;
    session.remembered = remember;
    session.loginAt = Date.now();
    const previous = pool.get(uid);
    if (previous?.pending > 0) throw fail('BUSY');

    const credentials = session.client.getCredentials();
    // 偏好里可能已有用户自取的显示名，落库时一并带上，避免重启后名字丢失
    const existingPrefs = (await store.readPrefs(uid)) || emptyPrefs();
    const persistLogin = remember || [...registry.entries.values()].some(e => e.uid === uid && e.remember && !registry.expired(e));
    const record = () => ({
      version: 1,
      account,
      loginType: credentials.user?.loginType === 'password' ? 'password' : 'sms',
      user: userView(credentials.user, uid, existingPrefs.displayName),
      deviceId: session.deviceId,
      session: Buffer.from(session.serialize()).toString('base64'),
      loginAt: session.loginAt,
      remembered: true,
      savedAt: Date.now(),
    });
    if (persistLogin) await store.writeUser(uid, record());
    else await store.removeUser(uid);

    const sessionId = registry.create({ uid, remember });
    previous?.clearLocal();
    pool.adopt(uid, session);
    // 轮换会话标识：图形码阶段下发的匿名条目语义（remember=false）与登录结果不同，
    // 复用它会带来两个真实缺陷：勾选「记住登录」却不落盘凭据；旧条目参与 sweep 干扰。
    if (entry) registry.drop(entry.id);
    setSessionCookie(res, secret, sessionId, { remember, secure });

    // 自动加载房产与门禁：登录完成后首页应立即可用。
    const rawPrefs = await store.readPrefs(uid);
    // 记住「登录前是否已有偏好文件」：只有真·首次使用才种默认收藏。
    // 若仅凭「该房产桶为空」判断，会在迁移/切房产等场景下把用户的收藏当成空的新房产，
    // 凭空写进 3 个默认收藏 —— 用户看到的正是「设置被覆盖」。
    const hadPrefs = rawPrefs !== null;
    const prefsValue = normalizePrefs(rawPrefs);
    let selectedHouseholdId = null;
    try {
      const available = session.client.households.filter(room => room.available);
      const preferred = available.find(room => room.id === prefsValue.selectedHouseholdId)
        || (available.length === 1 ? available[0] : null);
      if (preferred) {
        await session.loadDirectory(preferred.id);
        prefsValue.selectedHouseholdId = preferred.id;
        // 旧版遗留数据（此前没有归属信息）在这里认领进用户刚选定的房产
        adoptLegacy(prefsValue, preferred.id);
        const doors = buildDoors(session.doors, prefsValue, preferred.id);
        const bucket = householdPrefs(prefsValue, preferred.id);
        bucket.order = doors.map(door => door.id);
        if (!hadPrefs && !bucket.favorites.length && doors.length) {
          // 真·首次使用：默认收藏前 3 个门禁，首页立刻可用（用户可随时增删）。
          bucket.favorites = doors.slice(0, 3).map((door, index) => ({ doorId: door.id, priority: index + 1 }));
        }
        setHouseholdPrefs(prefsValue, preferred.id, bucket);
        selectedHouseholdId = preferred.id;
      }
      await store.writePrefs(uid, prefsValue);
      // 凭据落盘放在目录加载之后，确保保存的是最终状态。
      if (persistLogin) await store.writeUser(uid, record());
    } catch (error) {
      logger.warn('登录后自动加载门禁失败', { user: uid.slice(0, 8), code: toAppError(error).code });
      if (prefsValue.selectedHouseholdId) await store.writePrefs(uid, prefsValue).catch(() => {});
    }

    const payload = await sessionPayload(session);
    send({ ...payload, selectedHouseholdId: selectedHouseholdId || payload.selectedHouseholdId });
  }

  async function route(req, res, url) {
    const requestStartedAt = Date.now();
    const method = req.method || 'GET';
    const path = url.pathname;
    const { readJson, string, send, secure } = makeHelpers(req, res);
    const body = ['POST', 'PUT', 'PATCH'].includes(method) ? await readJson() : {};

    const sessionId = readSessionCookie(req, secret);
    const entry = sessionId ? registry.get(sessionId) : null;

    /**
     * 读取并归一化用户偏好。
     *
     * 迁移旧格式前会先让 store 写一份 `.prefs.bak`（见 store.writePrefs），
     * 因此即使迁移逻辑出错，用户数据也还有一份可回滚的副本。
     * 迁移没有归属信息时不会猜、不会丢：数据留在 `legacy` 里等用户选定房产。
     */
    const prefs = async (uid, { preferMemory = false } = {}) => {
      const raw = await store.readPrefs(uid, { preferMemory });
      const value = normalizePrefs(raw);
      const needsWrite = value.migrated === true || (raw && raw.schemaVersion !== PREFS_SCHEMA_VERSION);
      delete value.migrated;
      if (needsWrite && uid) {
        await store.writePrefs(uid, value);
      }
      return value;
    };

    /** 当前生效的房产 id：由 loadDirectory 写入会话，所有房产级偏好都以它为键。 */
    const currentHouseholdId = (session) => session.selectedHouseholdId || null;

    /**
     * 调 prefs.mjs 的收藏逻辑，把它的错误码翻译成本项目的 AppError。
     * （prefs.mjs 是纯函数模块，不认识 HTTP 错误，只抛出带 code 的 Error）
     */
    const applyFavorite = (entries, doorId, priority) => {
      try {
        return addFavorite(entries, doorId, priority);
      } catch (error) {
        throw fail(error.code || 'INTERNAL_ERROR', error.code === 'INVALID_INPUT' ? error.message : undefined);
      }
    };

    /** 串行化同一用户的付费操作；SDK 对重叠调用返回 BUSY。 */
    async function oneAtATime(session, action) {
      if (session.pending > 0) throw fail('BUSY');
      session.pending += 1;
      try { return await action(); } finally { session.pending -= 1; }
    }

    /** 取当前用户会话；必要时从加密存储静默恢复（服务重启后无需重新登录）。 */
    async function requireUser() {
      if (!entry?.uid) throw fail('SESSION_EXPIRED');
      let session = pool.get(entry.uid);
      if (session?.authenticated()) return session;
      const record = await store.readUser(entry.uid);
      if (!record?.session) {
        registry.drop(entry.id);
        throw fail('SESSION_EXPIRED');
      }
      if (deriveUserId(secret, record.account || '') !== entry.uid) {
        registry.drop(entry.id);
        throw fail('SAVED_LOGIN_INVALID');
      }
      if (!session) session = pool.create(entry.uid, record.account || entry.account || '');
      try {
        await session.restore(record);
        // Remove the unused legacy intercom password from old encrypted records after a successful restore.
        const sanitized = session.serialize();
        if (Buffer.from(record.session,'base64').toString() !== sanitized.toString()) { record.session = sanitized.toString('base64'); await store.writeUser(entry.uid,record); }
      } catch (error) {
        // 只结束当前内存会话，**保留凭据文件与会话条目**：
        //  - 恢复失败的常见原因（上游未确认、入口环境临时变化、网络异常）都可能自行恢复；
        //  - 删凭据会让用户在环境恢复后仍被迫重新登录；
        //  - 删会话条目则会让「环境恢复后自动续上」彻底不可能（每次都要用户手动登录）。
        // 真正的损坏（本地 AES 解密失败）在 store.readUser 里已经返回 null，会走上面的分支清理。
        logger.info('保存的凭据本次未能恢复，需要重新登录', { user: entry.uid.slice(0, 8), code: error?.code });
        pool.drop(entry.uid);
        const wrapped = toAppError(error);
        if (['SAVED_LOGIN_INVALID','NOT_LOGGED_IN','LOGIN_REJECTED'].includes(wrapped.code)) { registry.drop(entry.id); throw fail('SAVED_LOGIN_INVALID'); }
        throw wrapped;
      }
      logger.info('会话已恢复', { user: entry.uid.slice(0, 8) });
      return session;
    }

    const sessionPayload = async session => {
      const households = session.households().map(householdView);
      const prefsValue = session.uid && !session.uid.startsWith('anon:') ? await prefs(session.uid, { preferMemory: true }) : emptyPrefs();
      const selected = prefsValue.selectedHouseholdId && households.some(item => item.id === prefsValue.selectedHouseholdId)
        ? prefsValue.selectedHouseholdId
        : (session.selectedHouseholdId || null);
      const previewDoors = selected && households.some(room => room.id === selected && room.available) && selected === session.selectedHouseholdId && session.directoryId
        ? buildDoors(session.doors, prefsValue, selected) : [];
      return {
        authenticated: session.authenticated(),
        user: userView(session.client?.getCredentials().user, session.uid, prefsValue.displayName),
        households,
        selectedHouseholdId: selected,
        restored: false,
        doorsPreview: previewDoors.length ? { householdId: selected, directoryId: session.directoryId,
          doors: previewDoors, favorites: favoritesOf(previewDoors), preview: session.needsPreparation(selected), loadedAt: session.directoryReadyAt } : null,
      };
    };

    /**
     * 登录前准备该账号的会话。
     *
     * 若进程内已有该账号的已登录会话（例如同账号在另一浏览器登录过），而当前请求方
     * 并没有一条有效 cookie，则不能直接抛 ALREADY_LOGGED_IN —— 那会让「换了浏览器/清过
     * 浏览器数据」的用户永远无法登录。此时按新登录处理：让旧会话让位并关闭其上游连接。
     */
    async function loginAndFinish(uid, account, credentials, remember) {
      authLimits.checkLogin(account);
      limiter.check(`account-login:${uid}`, 10, 10 * 60_000);
      if (loginLocks.has(uid) || loginLocks.size >= MAX_ANONYMOUS_CLIENTS) throw fail('BUSY');
      loginLocks.add(uid);
      const session = new Session(uid, { origin: upstreamOrigin, deviceId: deriveDeviceId(secret, account), transport });
      try {
        try { await session.login(credentials); }
        catch (error) {
          if (credentials.mode === 'password' && error.code === 'LOGIN_REJECTED') authLimits.passwordFailure(account);
          throw error;
        }
        const ownsLock = entry?.uid === uid;
        if (!ownsLock && userLocks.has(uid)) throw fail('BUSY');
        if (!ownsLock) userLocks.add(uid);
        try { await finishLogin({ session, uid, account, remember, entry, res, secure: secure(), send, sessionPayload }); }
        finally { if (!ownsLock) userLocks.delete(uid); }
      } catch (error) {
        if (pool.get(uid) !== session) session.clearLocal();
        throw error;
      } finally { loginLocks.delete(uid); }
    }

    // ------------------------------------------------------------- 基础路由

    if (path === '/api/health' && method === 'GET') {
      if (registry.flushError || authLimits.flushError) throw fail('CREDENTIAL_STORE_UNAVAILABLE');
      send({ status: 'ok', version: APP_VERSION, mode: 'official' });
      return;
    }

    if (path === '/api/meta' && method === 'GET') {
      send({
        app: 'OpenTYG',
        version: APP_VERSION,
        maxFavorites: MAX_FAVORITES,
        openCooldownMs: DEFAULT_COOLDOWN_MS,
      });
      return;
    }

    // ------------------------------------------------------------- 认证路由

    if (path === '/api/connection/status' && method === 'GET') {
      if (!entry?.uid) throw fail('SESSION_EXPIRED');
      const progress = pool.get(entry.uid)?.progress;
      send({ phase: progress?.phase || 'idle', step: progress?.step || 1, elapsedMs: progress?.startedAt ? Math.max(0, Date.now() - progress.startedAt) : 0 });
      return;
    }

    if (['/api/auth/session','/api/bootstrap'].includes(path) && method === 'GET') {
      const sendSession = data => send(path === '/api/bootstrap'
        ? { meta: { app: 'OpenTYG', version: APP_VERSION, maxFavorites: MAX_FAVORITES, openCooldownMs: DEFAULT_COOLDOWN_MS }, session: data }
        : data);
      if (!entry?.uid) {
        sendSession({ authenticated: false, user: null, households: [], selectedHouseholdId: null, restored: false });
        return;
      }
      const live = pool.get(entry.uid);
      if (live?.authenticated()) { sendSession(await sessionPayload(live)); return; }
      try {
        const session = await requireUser();
        sendSession({ ...(await sessionPayload(session)), restored: true });
      } catch (error) {
        if (!['SESSION_EXPIRED','SAVED_LOGIN_INVALID','NOT_LOGGED_IN'].includes(error.code)) throw error;
        clearSessionCookie(res,{secure:secure()});
        sendSession({ authenticated: false, user: null, households: [], selectedHouseholdId: null, restored: false });
      }
      return;
    }

    if (path === '/api/auth/captcha' && method === 'POST') {
      const mobile = string(body, 'mobile', { required: true, max: 32, pattern: /^\d{6,15}$/ });
      authLimits.checkSms(mobile);
      limiter.check(`captcha-mobile:${mobile}`, 8, 10 * 60_000);
      const refresh = body.refresh === true;
      let activeId = entry?.id;
      if (!activeId) {
        // 冷启动：浏览器还没有 cookie，这里补发，后续图形码图片与短信请求才能关联。
        activeId = registry.create({ uid: null, account: mobile, remember: false });
        setSessionCookie(res, secret, activeId, { remember: false, secure: secure() });
      }
      const session = anonymousClient(activeId, mobile);
      const result = await oneAtATime(session, async () => {
        const client = await session.ensureInitialized();
        return client.createCaptcha(mobile, { refresh });
      });
      // 若该匿名客户端已被上一次登录消耗，下次请求会自动换成新客户端（见 anonymousClient）。
      for (const [id, info] of captchaIndex) if (info.sessionKey === activeId) captchaIndex.delete(id);
      if (captchaIndex.size >= MAX_ANONYMOUS_CLIENTS) captchaIndex.delete(captchaIndex.keys().next().value);
      captchaIndex.set(result.challengeId, { sessionKey: activeId, createdAt: Date.now(), mobile });
      send({
        challengeId: result.challengeId,
        imageUrl: `/api/auth/captcha-image?challengeId=${result.challengeId}`,
        expiresIn: result.expiresIn ?? 600,
      });
      return;
    }

    if (path === '/api/auth/captcha-image' && method === 'GET') {
      const challengeId = url.searchParams.get('challengeId') || '';
      const info = captchaIndex.get(challengeId);
      if (!info || info.sessionKey !== entry?.id || Date.now() - info.createdAt >= 600_000) throw fail('CAPTCHA_EXPIRED');
      const holder = anonymous.get(info.sessionKey);
      if (!holder?.session.client) throw fail('CAPTCHA_EXPIRED');
      const image = await holder.session.client.captchaImage(challengeId);
      const bytes = Buffer.from(image.bytes);
      res.writeHead(200, { 'Content-Type': image.contentType, 'Content-Length': bytes.length, 'Cache-Control': 'no-store' });
      res.end(bytes);
      return;
    }

    if (path === '/api/auth/sms' && method === 'POST') {
      const challengeId = string(body, 'challengeId', { required: true, max: 64 });
      const picRandom = string(body, 'picRandom', { required: true, max: 16 });
      const info = captchaIndex.get(challengeId);
      if (!info || info.sessionKey !== entry?.id || Date.now() - info.createdAt >= 600_000) throw fail('CAPTCHA_EXPIRED');
      authLimits.checkSms(info.mobile);
      limiter.check(`sms-mobile:${info.mobile}`, 1, 60_000);
      const holder = anonymous.get(info.sessionKey);
      if (!holder?.session.client) throw fail('CAPTCHA_EXPIRED');
      const result = await oneAtATime(holder.session, async () => {
        const reservation = authLimits.reserveSms(info.mobile);
        try { return await holder.session.client.sendSms(challengeId, picRandom); }
        catch (error) {
          // These responses prove no SMS was sent. Timeouts remain counted:
          // upstream may already have sent the message before the response was lost.
          if (['SMS_REJECTED', 'CAPTCHA_EXPIRED'].includes(error.code)) authLimits.releaseSms(reservation);
          throw error;
        }
      });
      captchaIndex.delete(challengeId);
      send({ sent: true, retryAfterSeconds: result.retryAfterSeconds ?? 60 });
      return;
    }

    if (path === '/api/auth/login-sms' && method === 'POST') {
      const mobile = string(body, 'mobile', { required: true, max: 32, pattern: /^\d{6,15}$/ });
      const smsCode = string(body, 'smsCode', { required: true, max: 16 });
      const remember = body.remember === true;
      const uid = deriveUserId(secret, mobile);
      await loginAndFinish(uid, mobile, { mode: 'sms', account: mobile, secret: smsCode }, remember);
      return;
    }

    if (path === '/api/auth/login-password' && method === 'POST') {
      const account = string(body, 'account', { required: true, max: 64 });
      const password = string(body, 'password', { required: true, max: 128, trim: false });
      const changeDeviceSmsCode = string(body, 'changeDeviceSmsCode', { max: 16 });
      const remember = body.remember === true;
      const uid = deriveUserId(secret, account);
      await loginAndFinish(uid, account, { mode: 'password', account, secret: password, changeDeviceSmsCode }, remember);
      return;
    }

    if (path === '/api/auth/logout' && method === 'POST') {
      // Only the authenticated cookie may revoke an account; body.account has no authority.
      const uid = entry?.uid ?? null;
      if (uid) {
        const session = pool.get(uid);
        if (session?.client) { try { await session.client.logout(); } catch { /* 上游失败也要清本地 */ } }
        pool.drop(uid);
        registry.dropByUid(uid);
        await store.removeUser(uid);
        // 只清登录态，**不删偏好**。
        // 偏好（收藏/自定义名称/位次/显示名/上次选的房产）是用户资产：
        // 删掉用户就得每次重新登录后重设一遍。真正要清偏好只能由用户显式要求。
      }
      if (entry) registry.drop(entry.id);
      clearSessionCookie(res, { secure: secure() });
      send({ loggedOut: true });
      return;
    }

    // ------------------------------------------------------------- 我的

    if (path === '/api/me' && method === 'GET') {
      const session = await requireUser();
      const prefsValue = await prefs(session.uid);
      const doors = buildDoors(session.doors, prefsValue, prefsValue.selectedHouseholdId || session.selectedHouseholdId);
      send({
        user: userView(session.client.getCredentials().user, session.uid, prefsValue.displayName),
        loginAt: session.loginAt || null,
        remembered: entry.remember === true,
        households: session.households().map(householdView),
        selectedHouseholdId: prefsValue.selectedHouseholdId || session.selectedHouseholdId || null,
        doorCount: doors.length,
        favoriteCount: doors.filter(door => door.favorite).length,
      });
      return;
    }

    /**
     * 修改本应用内的显示名称。
     * 只写入本服务端偏好（data/prefs/<uid>.prefs），**不会**、也无法修改桃园谷账号姓名
     * ——SDK 未提供该接口。`name` 传空字符串表示恢复为上游姓名（没有则显示「未命名用户」）。
     */
    if (path === '/api/me/name' && method === 'POST') {
      const session = await requireUser();
      const name = string(body, 'name', { max: 60 });
      if (name && [...name].length > 20) throw fail('INVALID_NAME', '名称需为 1-20 个字符');
      const prefsValue = await prefs(session.uid);
      prefsValue.displayName = name;
      await store.writePrefs(session.uid, prefsValue);
      // 显示名称以偏好文件为唯一来源，不重复写登录凭据快照。
      send({
        name: userView(session.client.getCredentials().user, session.uid, name).name,
        hasCustomName: !!name,
      });
      return;
    }

    // ------------------------------------------------------------- 房产

    if (path === '/api/households' && method === 'GET') {
      const session = await requireUser();
      const prefsValue = await prefs(session.uid);
      send({
        households: session.households().map(householdView),
        selectedHouseholdId: prefsValue.selectedHouseholdId && session.households().some(item => item.id === prefsValue.selectedHouseholdId)
          ? prefsValue.selectedHouseholdId
          : (session.selectedHouseholdId || null),
      });
      return;
    }

    if (path === '/api/households/select' && method === 'POST') {
      const session = await requireUser();
      const householdId = string(body, 'householdId', { required: true, max: 64 });
      session.household(householdId);
      await oneAtATime(session, () => session.loadDirectory(householdId));
      const prefsValue = await prefs(session.uid);
      prefsValue.selectedHouseholdId = householdId;
      // 用户在旧数据迁移后首次选定房产：把保留的遗留数据认领进来，不丢
      adoptLegacy(prefsValue, householdId);
      const doors = buildDoors(session.doors, prefsValue, householdId);
      const bucket = householdPrefs(prefsValue, householdId);
      bucket.order = doors.map(door => door.id);
      setHouseholdPrefs(prefsValue, householdId, bucket);
      await store.writePrefs(session.uid, prefsValue);
      send({ householdId, doorsLoaded: true, doorCount: doors.length });
      return;
    }

    // ------------------------------------------------------------- 门禁

    if (path === '/api/doors' && method === 'GET') {
      const session = await requireUser();
      const prefsValue = await prefs(session.uid, { preferMemory: true });
      const householdId = prefsValue.selectedHouseholdId || session.selectedHouseholdId;
      if (!householdId) throw fail('HOUSEHOLD_NOT_SELECTED');
      const refresh = url.searchParams.get('refresh') === '1';
      const stale = refresh || session.needsPreparation(householdId);
      if (stale) {
        const remainingMs = 3000 - (Date.now() - requestStartedAt);
        if (remainingMs <= 0) throw fail('HTTP_TIMEOUT');
        await oneAtATime(session, () => session.loadDirectory(householdId, { timeoutMs: remainingMs, forceNewContext: refresh }));
      }
      const doors = buildDoors(session.doors, prefsValue, householdId);
      const bucket = householdPrefs(prefsValue, householdId);
      if (JSON.stringify(bucket.order) !== JSON.stringify(doors.map(door => door.id))) {
        bucket.order = doors.map(door => door.id);
        setHouseholdPrefs(prefsValue, householdId, bucket);
        await store.writePrefs(session.uid, prefsValue);
      }
      send({ householdId, directoryId: session.directoryId, doors, favorites: favoritesOf(doors), loadedAt: Date.now() });
      return;
    }

    if (path === '/api/doors/rename' && method === 'POST') {
      const session = await requireUser();
      if (body.householdId !== session.selectedHouseholdId || body.directoryId !== session.directoryId || !session.directoryId) throw fail('STALE_DIRECTORY');
      const doorId = string(body, 'doorId', { required: true, max: 64 });
      const name = string(body, 'name', { max: MAX_NAME_LENGTH * 3 });
      session.door(doorId);
      if (name && [...name].length > MAX_NAME_LENGTH) throw fail('INVALID_NAME');
      const householdId = currentHouseholdId(session);
      const prefsValue = await prefs(session.uid);
      const bucket = householdPrefs(prefsValue, householdId);
      if (name) bucket.customNames[doorId] = name;
      else delete bucket.customNames[doorId];
      setHouseholdPrefs(prefsValue, householdId, bucket);
      await store.writePrefs(session.uid, prefsValue);
      send(buildDoors(session.doors, prefsValue, householdId).find(item => item.id === doorId));
      return;
    }

    if (path === '/api/doors/reset-name' && method === 'POST') {
      const session = await requireUser();
      if (body.householdId !== session.selectedHouseholdId || body.directoryId !== session.directoryId || !session.directoryId) throw fail('STALE_DIRECTORY');
      const doorId = string(body, 'doorId', { required: true, max: 64 });
      session.door(doorId);
      const householdId = currentHouseholdId(session);
      const prefsValue = await prefs(session.uid);
      const bucket = householdPrefs(prefsValue, householdId);
      delete bucket.customNames[doorId];
      setHouseholdPrefs(prefsValue, householdId, bucket);
      await store.writePrefs(session.uid, prefsValue);
      send(buildDoors(session.doors, prefsValue, householdId).find(item => item.id === doorId));
      return;
    }

    if (path === '/api/doors/favorite' && method === 'POST') {
      const session = await requireUser();
      if (body.householdId !== session.selectedHouseholdId || body.directoryId !== session.directoryId || !session.directoryId) throw fail('STALE_DIRECTORY');
      const doorId = string(body, 'doorId', { required: true, max: 64 });
      session.door(doorId);
      const householdId = currentHouseholdId(session);
      const prefsValue = await prefs(session.uid);
      const bucket = householdPrefs(prefsValue, householdId);
      bucket.favorites = body.favorite === false
        ? removeFavorite(bucket.favorites, doorId)
        : applyFavorite(bucket.favorites, doorId, body.priority === undefined || body.priority === null ? undefined : body.priority);
      setHouseholdPrefs(prefsValue, householdId, bucket);
      await store.writePrefs(session.uid, prefsValue);
      const doors = buildDoors(session.doors, prefsValue, householdId);
      send({ door: doors.find(item => item.id === doorId), favorites: favoritesOf(doors) });
      return;
    }

    if (path === '/api/doors/reorder' && method === 'POST') {
      const session = await requireUser();
      if (body.householdId !== session.selectedHouseholdId || body.directoryId !== session.directoryId || !session.directoryId) throw fail('STALE_DIRECTORY');
      const doorIds = body.doorIds;
      if (!Array.isArray(doorIds) || doorIds.some(id => typeof id !== 'string')) throw fail('INVALID_ORDER');
      if (doorIds.length !== session.doorIndex.size || new Set(doorIds).size !== doorIds.length || doorIds.some(id => !session.doorIndex.has(id))) {
        throw fail('INVALID_ORDER');
      }
      const householdId = currentHouseholdId(session);
      const prefsValue = await prefs(session.uid);
      const bucket = householdPrefs(prefsValue, householdId);
      bucket.order = [...doorIds];
      setHouseholdPrefs(prefsValue, householdId, bucket);
      await store.writePrefs(session.uid, prefsValue);
      send({ doors: buildDoors(session.doors, prefsValue, householdId) });
      return;
    }

    if (path === '/api/doors/open' && method === 'POST') {
      const session = await requireUser();
      const doorId = string(body, 'doorId', { required: true, max: 64 });
      const householdId = string(body, 'householdId', { required: true, max: 64 });
      const directoryId = string(body, 'directoryId', { required: true, max: 64 });
      if (session.selectedHouseholdId !== householdId || session.directoryId !== directoryId) throw fail('STALE_DIRECTORY');
      send(await oneAtATime(session, () => session.openDoor(doorId)));
      return;
    }

    throw fail('NOT_FOUND');
  }

  // ---------------------------------------------------------------- 静态文件

  const routeUnlocked = route;
  async function routeGuarded(req, res, url) {
    // Cookie-checked, read-only progress must remain available while the user
    // lock protects the actual restore/configuration operation.
    if (req.method === 'GET' && url.pathname === '/api/connection/status') return routeUnlocked(req, res, url);
    const id = readSessionCookie(req, secret);
    const uid = id && registry.entries.get(id)?.uid;
    if (uid && userLocks.has(uid)) throw fail('BUSY');
    if (uid) userLocks.add(uid);
    try { await routeUnlocked(req, res, url); }
    finally { if (uid) userLocks.delete(uid); }
  }

  async function sendFile(res, path) {
    const type = STATIC_TYPES[extname(path).toLowerCase()] || 'application/octet-stream';
    const cache = 'no-store';
    const bytes = await readFile(path);
    if (path === join(WEB_ROOT, 'sw.js')) res.setHeader('Service-Worker-Allowed', '/');
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': bytes.length, 'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff' });
    res.end(bytes);
  }

  async function serveStatic(req, res, url) {
    let pathname;
    try { pathname = decodeURIComponent(url.pathname); } catch { throw fail('NOT_FOUND'); }
    if (pathname.includes('\0')) throw fail('NOT_FOUND');
    if (pathname === '/' || pathname === '') pathname = '/index.html';
    const relative = normalize(pathname).replace(/^([/\\])+/, '');
    let target = resolve(join(WEB_ROOT, relative));
    if (target !== WEB_ROOT && !target.startsWith(WEB_ROOT + sep)) throw fail('NOT_FOUND');
    let info = await stat(target).catch(() => null);
    if (info?.isDirectory()) {
      target = join(target, 'index.html');
      info = await stat(target).catch(() => null);
      if (!info?.isFile()) throw fail('NOT_FOUND');
      return sendFile(res, target);
    }
    if (info?.isFile()) return sendFile(res, target);
    const index = join(WEB_ROOT, 'index.html');
    const indexInfo = await stat(index).catch(() => null);
    if (extname(target) === '' && indexInfo?.isFile()) return sendFile(res, index);
    throw fail('NOT_FOUND');
  }

  // ---------------------------------------------------------------- HTTP 服务

  const server = http.createServer(async (req, res) => {
    const startedAt = Date.now();
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', FRONTEND_CSP);
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      const redirect = policy.navigationRedirect(req, url);
      if (redirect) {
        res.writeHead(303, { Location: redirect, 'Cache-Control': 'no-store', 'Content-Length': '0' });
        res.end();
        return;
      }
      policy.check(req, url);
      if (url.pathname.startsWith('/api/')) {
        if (url.pathname.startsWith('/api/auth/') && req.method === 'POST') {
          limiter.check('auth-global', 120, 60_000);
          limiter.check(`auth-peer:${req.socket.remoteAddress || ''}`, 30, 60_000);
        }
        await routeGuarded(req, res, url);
      } else {
        if (req.method !== 'GET' && req.method !== 'HEAD') throw fail('METHOD_NOT_ALLOWED');
        await serveStatic(req, res, url);
      }
    } catch (error) {
      const appError = toAppError(error);
      if (appError.code === 'INTERNAL_ERROR' && error instanceof Error && error.code !== 'INTERNAL_ERROR') {
        logger.error('未预期异常', {
          code: /^[A-Z_]+$/.test(error.code || '') ? error.code : 'UNEXPECTED',
        });
      }
      if (!res.headersSent) {
        if (['SESSION_EXPIRED', 'NOT_LOGGED_IN', 'SAVED_LOGIN_INVALID'].includes(appError.code)) {
          clearSessionCookie(res, { secure: policy.secure });
        }
        if (appError.status === 429) res.setHeader('Retry-After', String(appError.details?.retryAfterSeconds || 60));
        if (res._unreadBody) res.setHeader('Connection', 'close');
        res.writeHead(appError.status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ ok: false, error: appError.toJSON() }));
        // 请求体未读完时不能复用这条连接。
        if (res._unreadBody) req.destroy();
      } else {
        res.end();
      }
      if (appError.status >= 500 || appError.code === 'INTERNAL_ERROR') {
        logger.error('请求失败', { path: String(req.url || '').split('?')[0], code: appError.code, ms: Date.now() - startedAt });
      }
    }
  });

  server.requestTimeout = 60_000;
  server.headersTimeout = 20_000;

  try {
    await new Promise((resolveListen, rejectListen) => {
      server.once('error', rejectListen);
      server.listen(port, host, () => { server.off('error', rejectListen); resolveListen(); });
    });
  } catch (error) { clearInterval(sweepTimer); pool.closeAll(); throw error; }

  const address = server.address();
  const url = `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${address.port}`;

  return {
    server,
    url,
    port: address.port,
    mode: 'official',
    upstreamOrigin,
    store,
    pool,
    registry,
    logger,
    close: async () => {
      clearInterval(sweepTimer);
      for (const holder of anonymous.values()) holder.session.clearLocal();
      anonymous.clear();
      captchaIndex.clear();
      pool.closeAll();
      await pruneTask;
      try { registry.flush(); }
      finally {
        registry.entries.clear();
        await new Promise(resolveClose => server.close(resolveClose));
      }
    },
  };
}

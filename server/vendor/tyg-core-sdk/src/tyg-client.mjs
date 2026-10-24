import { createHash, randomUUID } from 'node:crypto';
import { provision } from './intercom/provision.mjs';
import { SipAgent } from './intercom/sip.mjs';

export const DEFAULT_ORIGIN = 'http://lxj.taoyuangu.com:80';
export const ROUTES = Object.freeze({
  initialize: '/uums/servlet/getAllConfigsServlet',
  captchaSeed: '/uums/servlet/getAuthcodeServlet',
  captcha: '/uums/servlet/getAuthPicRandomServlet',
  captchaRefresh: '/uums/servlet/getPicRandomServlet',
  sms: '/uums/servlet/getRandomCodeForSmsLogin',
  loginSms: '/uums/servlet/smsUserLogin',
  loginPassword: '/uums/servlet/userLoginServlet',
  logout: '/uums/servlet/userLogout',
  households: '/cpsApi/servlet/queryOpenHouseholdList/v2',
  doorAuth: '/cpsApi/openDoor/getAuthcode',
});

export class TygError extends Error {
  constructor(code, message, details = {}, status = 400) {
    super(message);
    this.name = 'TygError';
    this.code = code;
    this.details = details;
    this.status = status;
  }
  toJSON() { return { code: this.code, message: this.message, details: this.details }; }
}
export const md5 = value => createHash('md5').update(String(value), 'utf8').digest('hex').toUpperCase();
const timestampFormatters = new Map();
export function timestamp(ms = Date.now(), timeZone = 'Asia/Shanghai') {
  if (!timestampFormatters.has(timeZone)) timestampFormatters.set(timeZone, new Intl.DateTimeFormat('en-GB', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }));
  const parts = Object.fromEntries(timestampFormatters.get(timeZone).formatToParts(new Date(ms)).map(p => [p.type, p.value]));
  return ['year', 'month', 'day', 'hour', 'minute', 'second'].map(k => parts[k]).join('');
}
export function envelope(body, token, ms = Date.now(), timeZone = 'Asia/Shanghai') {
  return { header: { time_stamp: timestamp(ms, timeZone),
    token: token ?? md5('EA3vWPmfxhWUit2s' + ms) }, body };
}
const text = value => value == null ? '' : String(value);
function required(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new TygError('INVALID_INPUT', `缺少 ${name}`);
  return value;
}
function decode(value) {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { throw new TygError('PROTOCOL_ERROR', '门列表的嵌套 JSON 无法解析'); }
}
function items(value) {
  value = decode(value);
  if (value == null || value === '') return [];
  if (Array.isArray(value)) return value.map(decode);
  if (typeof value === 'object') return [value];
  throw new TygError('PROTOCOL_ERROR', '门列表节点应为对象或数组');
}
const originalError = r => ({ result: r.result, code: r.code,
  reason: text(r.reason || r.message || (typeof r.data === 'string' ? r.data : '')) });
function resultOK(r) {
  if (text(r.result) !== '0') throw new TygError('UPSTREAM_REJECTED', text(r.reason) || '原服务拒绝请求', originalError(r), 502);
}
function codeOK(r) {
  if (text(r.code) !== '0') throw new TygError('UPSTREAM_REJECTED', text(r.message || r.reason) || '原服务业务校验失败', originalError(r), 502);
}
const validityNames = { '0': '已停用', '1': '有效', '2': '已过期，联系物业续期', '3': '需付费开通', '4': '付费权限已到期' };
const mask = value => value ? `${String(value).slice(0, 3)}…（${String(value).length} 位）` : null;

/** 原图片服务可能省略 MIME 响应头；以文件特征确定实际的栅格图片格式。 */
export function detectImageContentType(bytes) {
  bytes = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 6 && ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii'))) return 'image/gif';
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (bytes.length >= 14 && bytes.subarray(0, 2).toString('ascii') === 'BM') return 'image/bmp';
  return null;
}

/** 将按钮配置展开为可调用的锁通道。Id 仅供展示；物理地址为 code + number。 */
export function normalizeDoors(response) {
  const control = decode(decode(response.data)?.DOOR_CONTROL);
  if (!control || typeof control !== 'object') throw new TygError('PROTOCOL_ERROR', '缺少 data.DOOR_CONTROL');
  const doors = [];
  const append = (lock, parent, group, subgroup, index) => {
    const code = text(group ? lock.DeviceCode : parent.Code);
    const number = text(lock.Number);
    // 缺失真实设备地址的配置不允许生成可调用按钮。
    if (!code || !number) throw new TygError('PROTOCOL_ERROR', '锁配置缺少 DeviceCode/Code 或 Number');
    const id = `door-${createHash('sha256').update(JSON.stringify([code, number])).digest('hex').slice(0, 24)}`;
    if (doors.some(door => door.id === id)) return;
    doors.push({ id, code, number,
      displayId: text(lock.Id || parent.Id),
      name: text(lock.Name || subgroup?.Name || parent.Name) || `${code} / ${number}`,
      groupName: text(group ? parent.Name : ''), lockGroupName: text(subgroup?.Name),
      source: group ? 'group' : 'independent', areaSerial: text(parent.AreaSerial),
      isExit: text(lock.IsExit), show: text(lock.Show ?? subgroup?.Show),
      tempType: text(subgroup?.TempType), directionIndex: index,
    });
  };
  for (const group of items(control.DOOR_GROUP_LIST)) {
    for (const subgroup of items(group.LockGroup)) {
      items(subgroup.Lock).forEach((lock, index) => append(lock, group, true, subgroup, index));
    }
  }
  for (const node of items(control.NO_GROUP_LIST)) {
    items(node.Lock).forEach((lock, index) => append(lock, node, false, null, index));
  }
  const nameCounts = new Map();
  for (const door of doors) nameCounts.set(door.name, (nameCounts.get(door.name) || 0) + 1);
  for (const door of doors) if (nameCounts.get(door.name) > 1) door.name += ` · 通道 ${door.number}`;
  return doors;
}

/** 原协议没有 requestId。同一通道只允许一个未完成请求，超时即废弃连接。 */
class DoorChannel {
  constructor(url, connectTimeoutMs) { this.url = url; this.connectTimeoutMs = connectTimeoutMs; this.pending = null; }
  async connect(signal) {
    await new Promise((resolve, reject) => {
      signal?.throwIfAborted();
      const ws = this.ws = new WebSocket(this.url);
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
        if (error) reject(error); else resolve();
      };
      const abort = () => { finish(new TygError('WS_CONNECT_TIMEOUT', '门禁连接超时', {}, 504)); ws.close(); };
      const timer = setTimeout(() => {
        abort();
      }, this.connectTimeoutMs);
      signal?.addEventListener('abort', abort, { once: true });
      ws.addEventListener('open', () => { finish(); }, { once: true });
      ws.addEventListener('message', event => this.onMessage(event.data));
      ws.addEventListener('error', () => {
        const e = new TygError('WS_ERROR', '门禁连接异常', {}, 502);
        this.failPending(e); finish(e);
      });
      ws.addEventListener('close', () => {
        const e = new TygError('WS_CLOSED', '门禁连接已断开', {}, 502);
        this.failPending(e); finish(e);
      });
    });
  }
  onMessage(payload) {
    const p = this.pending;
    if (!p) return;
    if (Buffer.byteLength(String(payload)) > 2 * 1024 * 1024) {
      this.failPending(new TygError('PROTOCOL_ERROR', '门禁响应过大')); this.close(); return;
    }
    let response;
    try { response = JSON.parse(String(payload)); } catch { return; }
    const type = response.header?.msgType || response.msgType;
    if (type && type !== p.type) return;
    // 无类型的心跳/通知不应误认成业务回包。
    if (response.result == null) return;
    try {
      if (!type && text(response.result) === '0') {
        if (p.type === 'MobileDownloadConfig' && !decode(response.data)?.DOOR_CONTROL && response.code == null) return;
        if (p.type === 'OpenDoor' && (typeof response.data !== 'string' || response.code == null)) return;
      }
    } catch (error) { this.failPending(error); this.close(); return; }
    this.pending = null; p.cleanup(); p.resolve(response);
  }
  failPending(error) {
    const p = this.pending;
    if (!p) return;
    this.pending = null; p.cleanup();
    if (p.type === 'OpenDoor') {
      p.reject(new TygError('OPEN_RESULT_UNKNOWN', '开门指令已发送，未收到确定结果；请核实现场状态', { cause: error.code, sent: true }, 504));
    } else p.reject(error);
  }
  request(type, message, timeoutMs, { signal, onSent } = {}) {
    if (this.pending) throw new TygError('BUSY', '门禁请求正在进行', {}, 409);
    if (this.ws?.readyState !== WebSocket.OPEN) throw new TygError('WS_NOT_CONNECTED', '请重新获取门列表以连接门禁', {}, 409);
    signal?.throwIfAborted();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.failPending(new TygError('WS_TIMEOUT', '门禁响应超时', {}, 504));
        this.close(); // 防止迟到响应被下一次请求误接收。
      }, timeoutMs);
      const abort = () => { this.failPending(new TygError('WS_TIMEOUT', '门禁响应超时', {}, 504)); this.close(); };
      this.pending = { type, resolve, reject, timer, cleanup: () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); } };
      signal?.addEventListener('abort', abort, { once: true });
      try { this.ws.send(JSON.stringify(message)); onSent?.(); }
      catch {
        this.pending?.cleanup(); this.pending = null; clearTimeout(timer);
        reject(new TygError(type === 'OpenDoor' ? 'OPEN_RESULT_UNKNOWN' : 'WS_SEND_FAILED', '门禁消息发送未能确认', {}, 502));
      }
    });
  }
  close() {
    this.failPending(new TygError('WS_CLOSED', '门禁连接已关闭', {}, 409));
    if (this.ws && this.ws.readyState < WebSocket.CLOSING) this.ws.close();
  }
}

/** 无 Android 原生库依赖的 Node.js SDK。每个对象对应一个账号会话。 */
export class TygClient {
  #intercomPassword = '';
  #intercomConfig = null;
  #sip = null;
  #intercomListeners = new Set();
  #intercomAbort = null;
  #intercomInstanceId = randomUUID();
  constructor({ origin = DEFAULT_ORIGIN, timeZone = 'Asia/Shanghai', lastLoginOs = '4',
    deviceUniqueId = '', lastLoginDeviceToken = '', httpTimeoutMs = 30000,
    connectTimeoutMs = 10000, configTimeoutMs = 15000, openTimeoutMs = 5000,
    openCooldownMs = 3000, fetchImpl = globalThis.fetch,
    allowInsecureTransport = false, allowedHosts = [], retainIntercomPassword = false,
    readTimeoutMs = httpTimeoutMs, readAttempts = 1, onProgress = null } = {}) {
    this.readTimeoutMs = readTimeoutMs; this.readAttempts = readAttempts;
    this.onProgress = onProgress; this.preparationSignal = null;
    const url = new URL(origin);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new TygError('INVALID_ORIGIN', '服务入口必须是 HTTP/HTTPS URL');
    this.origin = url.origin;
    this.allowInsecureTransport = allowInsecureTransport;
    this.allowedHosts = new Set(allowedHosts.length ? allowedHosts : [url.hostname.toLowerCase()]);
    this.retainIntercomPassword = retainIntercomPassword;
    this.validateUrl(url);
    this.timeZone = timeZone;
    this.device = { clientCode: 'tyg_u', lastLoginOs, changeDeviceValidate: '1', lastLoginDeviceToken, deviceUniqueId };
    this.httpTimeoutMs = httpTimeoutMs; this.connectTimeoutMs = connectTimeoutMs;
    this.configTimeoutMs = configTimeoutMs; this.openTimeoutMs = openTimeoutMs; this.openCooldownMs = openCooldownMs;
    this.fetch = fetchImpl; this.servers = {}; this.initialized = false; this.busy = false;
    this.challenges = new Map(); this.session = null; this.households = [];
    this.channel = null; this.selected = null; this.authcode = ''; this.doors = [];
    this.directoryId = null; this.lastOpenAt = 0; this.closed = false;
    this.timings = []; this.intercomPlatformUrl = ''; this.talkForbidden = false;
  }
  async exclusive(action) {
    if (this.closed) throw new TygError('CLIENT_CLOSED', '会话已关闭', {}, 410);
    if (this.busy) throw new TygError('BUSY', '当前会话有请求正在进行，请稍后重试', {}, 409);
    this.busy = true;
    try { return await action(); } finally { this.busy = false; }
  }
  serviceBase(service) { return this.servers[`${service}_server`] || `${this.origin}/${service}/`; }
  validateUrl(value, websocket = false) {
    const url = value instanceof URL ? value : new URL(value);
    const schemes = websocket ? ['wss:', ...(this.allowInsecureTransport ? ['ws:'] : [])] : ['https:', ...(this.allowInsecureTransport ? ['http:'] : [])];
    if (!schemes.includes(url.protocol) || url.username || url.password || !this.allowedHosts.has(url.hostname.toLowerCase())) {
      throw new TygError('UPSTREAM_TRANSPORT_BLOCKED', '上游地址未通过传输安全校验', {}, 502);
    }
    return url;
  }
  async readBounded(response, maxBytes = 2 * 1024 * 1024) {
    if (Number(response.headers.get('content-length')) > maxBytes) { await response.body?.cancel(); throw new TygError('PROTOCOL_ERROR', '上游响应过大'); }
    const reader = response.body?.getReader();
    if (!reader) return Buffer.alloc(0);
    let size = 0; const chunks = [];
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length;
      if (size > maxBytes) { await reader.cancel(); throw new TygError('PROTOCOL_ERROR', '上游响应过大'); }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
  }
  async measure(operation, action) {
    const started = performance.now(); let errorCode = null;
    this.onProgress?.(operation);
    try { return await action(); }
    catch (error) { errorCode = error.code || 'ERROR'; throw error; }
    finally {
      this.timings.push({ operation, durationMs: Math.round(performance.now() - started), errorCode });
      this.timings = this.timings.slice(-40);
    }
  }
  async post(route, body, token, { signal = this.preparationSignal } = {}) {
    return this.measure(Object.keys(ROUTES).find(key => ROUTES[key] === route) || 'http', async () => {
    const service = route.split('/')[1];
    const url = new URL(route, this.serviceBase(service)); // 原 Retrofit 的路径以 / 开头。
    this.validateUrl(url);
    // These POST endpoints only read configuration/permissions. Login, SMS and
    // logout are deliberately excluded. The timeout also covers the response body.
    const readOnly = [ROUTES.initialize, ROUTES.households, ROUTES.doorAuth].includes(route);
    const attempts = readOnly ? this.readAttempts : 1;
    const preparationSignal = readOnly ? signal : null;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        preparationSignal?.throwIfAborted();
        const timeout = AbortSignal.timeout(readOnly ? this.readTimeoutMs : this.httpTimeoutMs);
        const response = await this.fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json; charset=UTF-8', Accept: 'application/json', ...(readOnly ? { Connection: 'close' } : {}) },
          body: JSON.stringify(envelope(body, token, Date.now(), this.timeZone)), redirect: 'error',
          signal: preparationSignal ? AbortSignal.any([timeout, preparationSignal]) : timeout });
        if (!response.ok) { await response.body?.cancel(); throw new TygError('HTTP_STATUS', `原服务返回 HTTP ${response.status}`, { httpStatus: response.status }, 502); }
        const bytes = await this.readBounded(response);
        if (this.closed) throw new TygError('CLIENT_CLOSED', '会话已关闭', {}, 410);
        let data;
        try { data = JSON.parse(bytes.toString('utf8')); if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(); }
        catch { throw new TygError('PROTOCOL_ERROR', '原服务未返回 JSON 对象', {}, 502); }
        return data;
      } catch (error) {
        const wrapped = error instanceof TygError ? error : new TygError(['TimeoutError','AbortError'].includes(error.name) ? 'HTTP_TIMEOUT' : 'HTTP_ERROR', '原服务请求失败，请检查网络和服务入口', {}, 502);
        if (attempt + 1 === attempts || preparationSignal?.aborted || this.closed || !['HTTP_TIMEOUT','HTTP_ERROR'].includes(wrapped.code)) throw wrapped;
        this.onProgress?.('retrying');
      }
    }
    });
  }
  assertInitialized() { if (!this.initialized) throw new TygError('NOT_INITIALIZED', '请先加载原 APP 的服务配置', {}, 409); }
  assertLogin() { this.assertInitialized(); if (!this.session) throw new TygError('NOT_LOGGED_IN', '请先登录', {}, 401); }
  configuration() {
    return { origin: this.origin, servers: { uums: this.serviceBase('uums'), cpsApi: this.serviceBase('cpsApi'), htmlvdcs: this.serviceBase('htmlvdcs') } };
  }
  initialize({ force = false } = {}) { return this.exclusive(async () => {
    if (this.session) throw new TygError('ALREADY_LOGGED_IN', '切换服务配置前请退出登录', {}, 409);
    if (this.initialized && !force) return this.configuration();
    const r = await this.post(ROUTES.initialize, {}); resultOK(r);
    if (!Array.isArray(r.serverConfigs)) throw new TygError('PROTOCOL_ERROR', '服务配置缺少 serverConfigs');
    const servers = {};
    // 对讲仅接受官方平台入口，个人 SIP 凭据由鉴权后配置下发。
    this.intercomPlatformUrl = '';
    const platform = r.serverConfigs.find(item => item.key === 'outerTalkbackSystemUrl')?.value;
    if (platform && this.retainIntercomPassword) {
      const url = new URL(platform);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new TygError('PROTOCOL_ERROR', '对讲平台地址异常');
      this.validateUrl(url);
      this.intercomPlatformUrl = url.href;
    }
    for (const item of r.serverConfigs) if (['uums_server', 'cpsApi_server', 'htmlvdcs_server'].includes(item.key)) {
      const url = new URL(item.value);
      if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) || url.username || url.password) throw new TygError('PROTOCOL_ERROR', '服务配置包含不支持的地址');
      this.validateUrl(url, ['ws:', 'wss:'].includes(url.protocol));
      servers[item.key] = item.value;
    }
    this.servers = servers; this.initialized = true;
    return this.configuration();
  }); }
  createCaptcha(mobile, { refresh = false, includeImage = false } = {}) { return this.exclusive(async () => {
    this.assertInitialized(); required(mobile, 'mobile');
    let r;
    if (refresh) r = await this.post(ROUTES.captchaRefresh, { phone: mobile });
    else {
      const seed = await this.post(ROUTES.captchaSeed, { phone: mobile }); resultOK(seed); required(seed.authCode, '服务端 authCode');
      r = await this.post(ROUTES.captcha, { phone: mobile, authCode: md5(md5('LXJ_SJM') + '_' + seed.authCode) });
    }
    resultOK(r); required(r.picRandomUrl, 'picRandomUrl');
    const imageUrl = new URL(r.picRandomUrl, this.serviceBase('uums'));
    this.validateUrl(imageUrl);
    if (!['http:', 'https:'].includes(imageUrl.protocol)) throw new TygError('PROTOCOL_ERROR', '图形验证码地址异常');
    // 每个号码保留一个有效图形校验上下文。
    for (const [key, challenge] of this.challenges) if (challenge.mobile === mobile || Date.now() - challenge.createdAt > 600000) this.challenges.delete(key);
    const challengeId = randomUUID();
    this.challenges.set(challengeId, { mobile, imageUrl: imageUrl.href, createdAt: Date.now() });
    return { challengeId, imageUrl: imageUrl.href, expiresIn: 600,
      ...(includeImage ? { image: await this.captchaImage(challengeId) } : {}) }; // 本地上下文寿命，非原服务 TTL。
  }); }
  async captchaImage(challengeId) {
    return this.measure('captchaImage', async () => {
    const challenge = this.challenge(challengeId);
    let r;
    try { this.validateUrl(challenge.imageUrl); r = await this.fetch(challenge.imageUrl, { redirect: 'error', signal: AbortSignal.timeout(this.httpTimeoutMs) }); }
    catch { throw new TygError('CAPTCHA_IMAGE_ERROR', '图形验证码图片下载失败', {}, 502); }
    const contentType = r.headers.get('content-type') || '';
    const metadata = { httpStatus: r.status, contentType: contentType || null };
    if (!r.ok) throw new TygError('CAPTCHA_IMAGE_ERROR', `验证码图片服务返回 HTTP ${r.status}`, metadata, 502);
    let bytes;
    try { bytes = await this.readBounded(r); }
    catch { throw new TygError('CAPTCHA_IMAGE_ERROR', '图形验证码图片下载中断', metadata, 502); }
    if (bytes.length > 2 * 1024 * 1024) throw new TygError('CAPTCHA_IMAGE_ERROR', '验证码图片过大');
    const actualType = detectImageContentType(bytes);
    if (!actualType) throw new TygError('CAPTCHA_IMAGE_ERROR', '验证码图片服务返回的内容不是支持的图片，请重新获取', { ...metadata, bytes: bytes.length }, 502);
    return { bytes, contentType: actualType };
    });
  }
  challenge(id) {
    const c = this.challenges.get(id);
    if (!c || Date.now() - c.createdAt > 600000) throw new TygError('CAPTCHA_EXPIRED', '请重新获取图形验证码', {}, 409);
    return c;
  }
  sendSms(challengeId, picRandom) { return this.exclusive(async () => {
    this.assertInitialized(); const c = this.challenge(challengeId); required(picRandom, 'picRandom');
    const r = await this.post(ROUTES.sms, { phone: c.mobile, picRandom, sourceClientCode: 'tyg_u' }); resultOK(r);
    if (text(r.code) !== '1') {
      const messages = { '2': '图形验证码不正确，请刷新图片', '-1': '短信获取次数过多', '3': '当日短信发送次数超过限制' };
      throw new TygError('SMS_REJECTED', text(r.reason) || messages[text(r.code)] || '短信发送失败', originalError(r));
    }
    this.challenges.delete(challengeId); return { sent: true, code: text(r.code), retryAfterSeconds: 60 };
  }); }
  loginSms(mobile, smsVerifyCode) { return this.login('sms', mobile, smsVerifyCode); }
  loginPassword(account, password, changeDeviceSmsCode = '') { return this.login('password', account, password, changeDeviceSmsCode); }
  login(mode, account, secret, changeDeviceSmsCode = '') { return this.exclusive(async () => {
    this.assertInitialized(); required(account, '账号/手机号'); required(secret, mode === 'sms' ? '短信验证码' : '密码');
    if (this.session) throw new TygError('ALREADY_LOGGED_IN', '重新登录前请退出当前会话', {}, 409);
    const body = mode === 'sms' ? { ...this.device, mobile: account, smsVerifyCode: secret } : { ...this.device, account, password: secret, changeDeviceSmsCode };
    const r = await this.post(mode === 'sms' ? ROUTES.loginSms : ROUTES.loginPassword, body); resultOK(r);
    if (text(r.code) !== '0') {
      const code = text(r.code);
      const name = mode === 'password' && code === '3' ? 'DEVICE_VERIFICATION_REQUIRED' : mode === 'password' && code === '4' ? 'DEVICE_VERIFICATION_INVALID' : mode === 'sms' && code === '2' ? 'SMS_CODE_INVALID' : 'LOGIN_REJECTED';
      throw new TygError(name, text(r.reason) || (name === 'DEVICE_VERIFICATION_REQUIRED' ? '需短信验证设备变更，再携带 changeDeviceSmsCode 登录' : '登录校验失败'), originalError(r), 401);
    }
    required(r.token, '登录 token');
    this.session = { token: r.token, account, userAccount: text(r.userAccount), name: text(r.name), loginType: mode };
    this.talkForbidden = Number(r.talkForbidStatus) === 1;
    // SMSFragment.java / util.d：服务成功登录后返回 Base64 账户密码。
    // 用于原对讲 AuthenticationRequest；只在显式保存时交给本机加密存储。
    this.#intercomPassword = this.retainIntercomPassword ? (mode === 'password' ? secret : typeof r.password === 'string' && /^[A-Za-z0-9+/=_-\s]+$/.test(r.password) ? Buffer.from(r.password, 'base64').toString('utf8') : '') : '';
    return { user: this.user(), sessionToken: r.token };
  }); }
  user() { if (!this.session) return null; const { token, ...user } = this.session; return user; }
  /** Secret-bearing bytes for trusted server-side encrypted storage; never a browser response. */
  serializeLoginSession() {
    this.assertLogin();return Buffer.from(JSON.stringify({version:1,origin:this.origin,savedAt:Date.now(),session:{...this.session},device:{...this.device},intercomPassword:this.#intercomPassword,intercomInstanceId:this.#intercomInstanceId,talkForbidden:this.talkForbidden}));
  }
  async restoreLoginSession(bytes) {
    if(this.session)throw new TygError('ALREADY_LOGGED_IN','恢复前请退出当前登录',{},409);
    let saved;try{if(!(bytes instanceof Uint8Array)||bytes.length>32768)throw new Error();saved=JSON.parse(Buffer.from(bytes).toString('utf8'));}catch{throw new TygError('SAVED_LOGIN_INVALID','保存的登录凭据无法读取',{},401);}
    const s=saved?.session,valid=v=>typeof v==='string'&&v.length>0&&v.length<=4096;
    if(saved.version!==1||saved.origin!==this.origin||!valid(s?.token)||!valid(s?.account)||!['sms','password'].includes(s?.loginType)||typeof saved.intercomPassword!=='string'||saved.intercomPassword.length>4096||! /^[\w-]{36}$/.test(saved.intercomInstanceId||''))throw new TygError('SAVED_LOGIN_INVALID','保存的凭据与当前环境不匹配',{},401);
    await this.initialize();
    this.session={token:s.token,account:s.account,userAccount:typeof s.userAccount==='string'?s.userAccount:'',name:typeof s.name==='string'?s.name:'',loginType:s.loginType};
    this.#intercomPassword=this.retainIntercomPassword ? saved.intercomPassword : '';this.#intercomInstanceId=saved.intercomInstanceId;this.talkForbidden=saved.talkForbidden===true;
    for(const key of ['lastLoginOs','lastLoginDeviceToken','deviceUniqueId'])if(typeof saved.device?.[key]==='string'&&saved.device[key].length<=1024)this.device[key]=saved.device[key];
    try{await this.getHouseholds();return this.getState();}catch(e){this.session=null;this.#intercomPassword='';this.households=[];this.clearDoor();throw e;}
  }
  clearDoor() {
    this.channel?.close(); this.channel = null; this.selected = null;
    this.authcode = ''; this.doors = []; this.directoryId = null;
  }
  getHouseholds() { return this.exclusive(async () => {
    this.assertLogin(); this.clearDoor(); this.households = [];
    const r = await this.post(ROUTES.households, { type: '1', openCode: '' }, this.session.token); codeOK(r);
    const list = [];
    if (!Array.isArray(r.data?.areaList)) throw new TygError('PROTOCOL_ERROR', '房产列表缺少 data.areaList');
    for (const area of r.data.areaList) for (const room of items(area.list)) {
      const identity = [text(area.organizationSeq), text(room.householdSerial)];
      if (identity.some(x => !x)) throw new TygError('PROTOCOL_ERROR', '房产缺少稳定标识');
      const id = `household-${createHash('sha256').update(JSON.stringify(identity)).digest('hex').slice(0, 24)}`;
      if (list.some(item => item.id === id)) throw new TygError('PROTOCOL_ERROR', '房产标识重复');
      list.push({ id, areaName: text(area.areaName), organizationSeq: text(area.organizationSeq),
        householdSerial: text(room.householdSerial), householdAddress: text(room.householdAddress),
        mobile: text(room.mobile), token: text(room.token), valid: text(room.valid),
        validityDescription: validityNames[text(room.valid)] || '未知权限状态',
        available: text(room.valid) === '1', validEndDate: text(room.validEndDate), packageValidEndDate: text(room.packageValidEndDate) });
    }
    this.households = list;
    return list.map(({ token, ...room }) => room);
  }); }
  household(id) {
    const h = this.households.find(item => item.id === id);
    if (!h) throw new TygError('HOUSEHOLD_NOT_FOUND', '请从当前房产列表选择房产', {}, 404);
    if (!h.available) throw new TygError('HOUSEHOLD_UNAVAILABLE', h.validityDescription, { valid: h.valid }, 403);
    required(h.token, 'household token'); required(h.mobile, '房产 mobile'); required(h.householdSerial, 'householdSerial'); required(h.organizationSeq, 'organizationSeq');
    return h;
  }
  async requestDoorAuth(h, options) {
    const r = await this.post(ROUTES.doorAuth, { mobile: h.mobile }, h.token, options); codeOK(r);
    return required(r.data?.data, '开门 authcode');
  }
  async authorize(h) {
    const authcode = await this.requestDoorAuth(h);
    if (this.closed) throw new TygError('CLIENT_CLOSED', '会话已关闭', {}, 410);
    this.authcode = authcode; this.selected = h;
  }
  getDoorCredentials(householdId) { return this.exclusive(async () => {
    this.assertLogin(); const h = this.household(householdId); this.clearDoor();
    await this.authorize(h); return this.getCredentials();
  }); }
  wsUrl(h) {
    const base = this.serviceBase('htmlvdcs');
    const url = new URL(base.replace(/\/+$/, '') + '/wsserver/websocket');
    if (url.protocol === 'https:') url.protocol = 'wss:';
    if (url.protocol === 'http:') url.protocol = 'ws:';
    if (!['ws:', 'wss:'].includes(url.protocol)) throw new TygError('PROTOCOL_ERROR', 'WebSocket 服务地址异常');
    this.validateUrl(url, true);
    url.searchParams.set('token', h.token); return url.href;
  }
  wsMessage(type, body) {
    return { header: { token: this.authcode, msgType: type, time_stamp: timestamp(Date.now(), this.timeZone) }, body };
  }
  getDoors(householdId) { return this.exclusive(async () => {
    this.assertLogin(); const h = this.household(householdId); this.clearDoor();
    const attempt = new AbortController();
    const signal = this.preparationSignal ? AbortSignal.any([attempt.signal, this.preparationSignal]) : attempt.signal;
    let branches = [];
    try {
      const channel = this.channel = new DoorChannel(this.wsUrl(h), this.connectTimeoutMs);
      // WS 握手仅依赖房产 token；配置消息须等待 authcode 和连接两者就绪。
      branches = [this.measure('wsConnect', () => channel.connect(signal)), this.requestDoorAuth(h, { signal })];
      const [, authcode] = await Promise.all(branches);
      if (this.closed || this.channel !== channel) throw new TygError('CLIENT_CLOSED', '会话已关闭', {}, 410);
      this.authcode = authcode; this.selected = h;
      const r = await this.measure('doorConfig', () => channel.request('MobileDownloadConfig', this.wsMessage('MobileDownloadConfig', { mobile: h.mobile, organizationSeq: h.organizationSeq }), this.configTimeoutMs, { signal }));
      resultOK(r);
      // 原 APP 的配置响应不要求 code；如存在业务 code 则检查。
      if (r.code != null) codeOK(r);
      this.doors = normalizeDoors(r); this.directoryId = randomUUID();
      return { householdId, directoryId: this.directoryId, doors: this.doors, credentials: this.getCredentials() };
    } catch (e) {
      // A failed WS handshake must cancel the parallel HTTP authorization too.
      // Await cleanup before another attempt can enter the SDK's exclusive lane.
      attempt.abort(); this.clearDoor(); await Promise.allSettled(branches); throw e;
    } finally { attempt.abort(); }
  }); }
  getCredentials({ includeSecrets = false } = {}) {
    const credentials = { sessionToken: this.session?.token || '', householdToken: this.selected?.token || '', authcode: this.authcode };
    return { authenticated: !!this.session, user: this.user(), householdId: this.selected?.id || null,
      householdSerial: this.selected?.householdSerial || null, organizationSeq: this.selected?.organizationSeq || null,
      mobile: this.selected?.mobile || null, connected: this.channel?.ws?.readyState === WebSocket.OPEN,
      directoryId: this.directoryId, tokens: Object.fromEntries(Object.entries(credentials).map(([key, value]) => [key, includeSecrets ? value || null : mask(value)])),
      redacted: !includeSecrets };
  }
  getState() {
    const credentials = this.getCredentials();
    return { initialized: this.initialized, configuration: this.initialized ? this.configuration() : null,
      credentials, households: this.households.map(({ token, ...room }) => ({ ...room })),
      directory: this.directoryId ? { householdId: this.selected.id, directoryId: this.directoryId,
        doors: this.doors.map(door => ({ ...door })), credentials } : null,
      openRetryAfterMs: Math.max(0, this.openCooldownMs - (Date.now() - this.lastOpenAt)),
      timings: this.timings.map(timing => ({ ...timing })), intercom: this.getIntercomState() };
  }
  #intercomError(error) {
    if (error instanceof TygError) return error;
    const candidate=typeof error.code==='string'?error.code:error.message;
    const code=/^(?:SIP_|CALL_|INTERCOM_|XML_|MEDIA_|HANGUP_)[A-Z_]+$/.test(candidate)?candidate:error.name==='TimeoutError'?'INTERCOM_TIMEOUT':error.name==='AbortError'?'INTERCOM_CANCELLED':'INTERCOM_NETWORK_ERROR';
    const messages = { INTERCOM_PASSWORD_REQUIRED:'原服务未返回对讲所需密码，请在本地填写账号密码', INTERCOM_AUTH_REJECTED:'对讲平台鉴权被拒绝',
      SIP_CONFIG_MISSING:'对讲平台未下发完整个人 SIP 配置', SIP_CONFIG_INVALID:'个人 SIP 配置格式不支持', XML_INVALID:'对讲平台 XML 响应无法解析',
      SIP_TIMEOUT:'SIP 服务响应超时，请检查网络与防火墙', SIP_AUTH_REJECTED:'SIP 账号鉴权失败', SIP_AUTH_UNSUPPORTED:'SIP 鉴权算法不支持', SIP_REGISTRATION_REJECTED:'SIP 注册被拒绝',
      SIP_NOT_REGISTERED:'请先注册对讲服务', INTERCOM_BUSY:'当前对讲操作或通话尚未结束', CALL_BUSY:'门口机正忙', CALL_UNAVAILABLE:'门口机暂不可用', CALL_REJECTED:'门口机拒绝呼叫',
      MEDIA_UNSUPPORTED:'门口机未协商支持的 G.711 / RTP 音频', HANGUP_UNCONFIRMED:'挂断已发送，但未收到服务确认' };
    return new TygError(code, messages[code] || '对讲操作失败，请检查网络及平台配置', {}, code==='INTERCOM_BUSY'?409:502);
  }
  getIntercomState() {
    const config=this.#intercomConfig;
    return { available:!!this.intercomPlatformUrl && !this.talkForbidden, passwordRequired:!this.#intercomPassword,
      configurationId:config?.id || null, configVersion:config?.version || null,
      devices:config?.devices.map(d=>({...d})) || [], ...(this.#sip?.snapshot() || {registered:false,registration:'idle',call:null,media:null,errorCode:null,signaling:null}) };
  }
  prepareIntercom({password=''}={}) { return this.exclusive(async () => {
    this.assertLogin();
    if(this.talkForbidden)throw new TygError('INTERCOM_FORBIDDEN','当前账号被官方服务禁止对讲',{},403);
    if(!this.intercomPlatformUrl)throw new TygError('INTERCOM_NOT_CONFIGURED','原服务配置未提供对讲平台入口',{},409);
    if(this.#sip?.dialog)throw new TygError('INTERCOM_BUSY','请先挂断当前通话',{},409);
    const secret=password || this.#intercomPassword;
    if(!secret)throw new TygError('INTERCOM_PASSWORD_REQUIRED','请在本地填写账号密码以鉴权对讲平台',{},409);
    this.closeIntercom();this.#intercomAbort=new AbortController();
    try{
      const config=await this.measure('intercomProvision',()=>provision({url:this.intercomPlatformUrl,account:this.session.account,password:secret,fetchImpl:this.fetch,timeoutMs:this.httpTimeoutMs,signal:this.#intercomAbort.signal}));
      if(this.closed||!this.session)throw new TygError('CLIENT_CLOSED','会话已关闭',{},410);
      this.#intercomPassword=secret;this.#intercomConfig=config; this.#sip=new SipAgent(config.sip,{instanceId:this.#intercomInstanceId});
      for(const type of ['state','audio','video'])this.#sip.on(type,data=>{for(const listener of this.#intercomListeners)listener(type,type==='state'?this.getIntercomState():data);});
      return this.getIntercomState();
    }catch(error){throw this.#intercomError(error);}finally{this.#intercomAbort=null;}
  }); }
  registerIntercom() { return this.exclusive(async () => {
    this.assertLogin();if(!this.#sip)throw new TygError('INTERCOM_NOT_READY','请先获取对讲配置',{},409);
    try{await this.measure('sipRegister',()=>this.#sip.register());return this.getIntercomState();}catch(e){throw this.#intercomError(e);}
  }); }
  callIntercom({configurationId,deviceId,video=true}) {
    this.assertLogin();
    if(!this.#sip||configurationId!==this.#intercomConfig?.id)throw new TygError('STALE_INTERCOM_CONFIG','对讲配置已失效，请重新选择设备',{},409);
    const device=this.#intercomConfig.devices.find(d=>d.id===deviceId);
    if(!device)throw new TygError('INTERCOM_DEVICE_NOT_FOUND','只能呼叫当前配置下发的门口机',{},404);
    if(!this.#sip.state.registered)throw new TygError('SIP_NOT_REGISTERED','请先注册对讲服务',{},409);
    if(this.#sip.dialog)throw new TygError('INTERCOM_BUSY','请先挂断当前通话',{},409);
    // 呼叫通过事件/状态异步更新，挂断不受 HTTP 独占操作阻塞。
    const sip=this.#sip;sip.call(device,{video:video===true}).catch(error=>{if(this.#sip===sip)sip.update({errorCode:this.#intercomError(error).code});});
    return this.getIntercomState();
  }
  async hangupIntercom() { this.assertLogin();try{await this.#sip?.hangup();return this.getIntercomState();}catch(e){throw this.#intercomError(e);} }
  onIntercomEvent(listener) { this.#intercomListeners.add(listener); return ()=>this.#intercomListeners.delete(listener); }
  writeIntercomAudio(pcm) { this.#sip?.media?.enqueue(Buffer.from(pcm)); }
  closeIntercom() { this.#intercomAbort?.abort();this.#sip?.close();this.#sip=null;this.#intercomConfig=null; }
  openDoor({ householdId, directoryId, doorId }) { return this.exclusive(async () => {
    this.assertLogin(); this.household(householdId);
    if (!this.directoryId || directoryId !== this.directoryId || householdId !== this.selected?.id) throw new TygError('STALE_DIRECTORY', '门列表与当前房产不匹配，请重新获取门列表', {}, 409);
    const door = this.doors.find(item => item.id === doorId);
    if (!door) throw new TygError('DOOR_NOT_FOUND', '只能操作当前配置下发的门', {}, 404);
    if (this.channel?.ws?.readyState !== WebSocket.OPEN) throw new TygError('WS_NOT_CONNECTED', '请重新获取门列表以连接门禁', {}, 409);
    if (Date.now() - this.lastOpenAt < this.openCooldownMs) throw new TygError('OPEN_COOLDOWN', '开门操作间隔至少 3 秒', {}, 429);
    const h = this.selected;
    const body = { code: door.code, mobile: h.mobile, clientType: '2', householdSerial: h.householdSerial, number: door.number };
    const r = await this.measure('openDoor', () => this.channel.request('OpenDoor', this.wsMessage('OpenDoor', body), this.openTimeoutMs, { onSent: () => { this.lastOpenAt = Date.now(); } }));
    resultOK(r);
    const success = text(r.code) === '0' && r.data === '开门成功';
    return { status: success ? 'acknowledged' : 'rejected', success, message: text(r.data || r.reason),
      result: text(r.result), code: text(r.code), door: { id: door.id, code: door.code, number: door.number, name: door.name },
      physicalStateVerified: false };
  }); }
  logout() { return this.exclusive(async () => {
    const token = this.session?.token; this.closeIntercom();this.#intercomPassword='';this.talkForbidden=false;this.clearDoor(); this.session = null; this.households = []; this.challenges.clear();
    if (token) { const r = await this.post(ROUTES.logout, {}, token); resultOK(r); }
    return { loggedOut: true };
  }); }
  close() { this.closeIntercom();this.#intercomPassword='';this.#intercomListeners.clear();this.clearDoor(); this.session = null; this.households = []; this.challenges.clear(); this.closed = true; }
}

/**
 * 服务层：把桃园谷 SDK 封装成「每个用户一个会话」的服务。
 *
 * 关键点：
 *  - 每个用户一个 TygClient 实例（内含门禁 WebSocket），有界 LRU + 闲置回收；
 *  - 进程重启后凭据仍在磁盘，用户再次请求时自动恢复，无需重新登录；
 *  - SDK 的 login/store 三步（getDoorCredentials / getDoors）都会作废旧目录，因此
 *    「目录何时有效」由本层记录，门禁对象在服务端解析，前端只持有 door.id。
 */
import { TygClient, DEFAULT_ORIGIN } from './vendor/tyg-core-sdk/src/tyg-client.mjs';
import { AppError, fail, toAppError } from './errors.mjs';
import { deriveDeviceId } from './store.mjs';
import { setTimeout as delay } from 'node:timers/promises';

const IDLE_LIMIT_MS = 30 * 60 * 1000;
const MAX_SESSIONS = 200;
const LOGIN_OS = '4'; // 官方 Android 设备类型，与 SDK 默认一致
// Only connection/configuration reads are retried. Never retry an OpenDoor message.
const PREPARE_RETRY_CODES = new Set(['WS_CONNECT_TIMEOUT', 'WS_ERROR', 'WS_CLOSED', 'WS_NOT_CONNECTED', 'WS_TIMEOUT', 'HTTP_ERROR', 'HTTP_TIMEOUT']);

export class Session {
  constructor(uid, { origin, deviceId, transport = {} }) {
    this.uid = uid;
    this.origin = origin;
    this.deviceId = deviceId;
    this.transport = transport;
    this.client = null;
    this.loginAt = 0;
    this.remembered = false;
    this.selectedHouseholdId = null;
    this.directoryId = null;
    this.doors = [];          // 服务端权威门禁目录（排序后的原始顺序）
    this.doorIndex = new Map();
    this.lastUsedAt = Date.now();
    this.pending = 0;
    this.restoring = null;
  }

  touch() { this.lastUsedAt = Date.now(); }

  authenticated() { return !!this.client?.session; }

  households() { return this.client ? this.client.households.map(({ token, ...room }) => ({ ...room })) : []; }

  /** 序列化后的登录凭据（含 token），只能写入加密存储，绝不能返回给浏览器。 */
  serialize() { return this.client.serializeLoginSession(); }

  ensureClient() {
    if (!this.client) {
      this.client = new TygClient({
        origin: this.origin,
        lastLoginOs: LOGIN_OS,
        deviceUniqueId: this.deviceId,
        ...this.transport,
      });
    }
    return this.client;
  }

  /** 首次使用前下载官方服务配置（已初始化则直接复用，不产生上游请求）。 */
  async ensureInitialized() {
    const client = this.ensureClient();
    if (!client.initialized) await client.initialize();
    return client;
  }

  /** 首次或重启后建立登录态：deviceId 稳定，因此上游不会把用户当成新设备。 */
  async login({ mode, account, secret, changeDeviceSmsCode = '' }) {
    const client = await this.ensureInitialized();
    if (mode === 'sms') await client.loginSms(account, secret);
    else await client.loginPassword(account, secret, changeDeviceSmsCode);
    this.loginAt = Date.now();
    this.selectedHouseholdId = null;
    this.directoryId = null;
    this.doors = [];
    this.doorIndex.clear();
    // SDK 只在 restoreLoginSession 内自动拉取房产；直接登录后必须显式获取，
    // 否则房产列表为空、无法自动进入门禁目录，用户会停在"无可用房产"。
    try {
      await client.getHouseholds();
    } catch (error) {
      this.householdsError = toAppError(error).code;
      throw error;
    }
    return client.getCredentials().user;
  }

  async restore(previous) {
    if (this.restoring) return this.restoring;
    this.restoring = (async () => {
      if (!previous?.session) throw fail('SAVED_LOGIN_INVALID', '本地没有可恢复的登录状态');
      // 不复用旧 client 实例，避免半恢复状态；deviceUniqueId 保持一致，上游视为同一设备。
      try { this.client?.close(); } catch { /* 已关闭 */ }
      this.client = new TygClient({ origin: this.origin, lastLoginOs: LOGIN_OS, deviceUniqueId: this.deviceId, ...this.transport });
      await this.client.restoreLoginSession(Buffer.from(previous.session, 'base64'));
      this.loginAt = previous.loginAt || Date.now();
      this.remembered = previous.remembered !== false;
      return this.client.getState();
    })();
    try { return await this.restoring; } finally { this.restoring = null; }
  }

  clearLocal() {
    try { this.client?.close(); } catch { /* 已关闭 */ }
    this.client = null;
    this.selectedHouseholdId = null;
    this.directoryId = null;
    this.doors = [];
    this.doorIndex.clear();
  }

  household(id) {
    if (!this.client) throw fail('NOT_LOGGED_IN');
    const target = id ?? this.selectedHouseholdId;
    if (!target) throw fail('HOUSEHOLD_NOT_SELECTED');
    const found = this.client.households.find(item => item.id === target);
    if (!found) throw fail('HOUSEHOLD_NOT_FOUND');
    if (!found.available) throw fail('HOUSEHOLD_UNAVAILABLE', undefined, { valid: found.valid });
    return found;
  }

  /** 选中房产并加载门禁目录（SDK 内部会取 authcode + 建 WS + 下载配置）。 */
  async loadDirectory(householdId) {
    if (!this.client) throw fail('NOT_LOGGED_IN');
    this.directoryId = null; this.selectedHouseholdId = null;
    this.doors = []; this.doorIndex.clear();
    try {
      const client = this.client;
      let directory;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try { directory = await client.getDoors(householdId); break; }
        catch (error) {
          if (attempt !== 0 || !PREPARE_RETRY_CODES.has(error?.code)) throw error;
          await delay(200);
          if (this.client !== client || client.closed) throw fail('CLIENT_CLOSED');
        }
      }
      this.selectedHouseholdId = householdId;
      this.directoryId = directory.directoryId;
      this.doors = directory.doors.map(door => ({ ...door }));
      this.doorIndex = new Map(this.doors.map(door => [door.id, door]));
      return directory;
    } catch (error) {
      if (error?.code === 'HOUSEHOLD_UNAVAILABLE' || error?.code === 'HOUSEHOLD_NOT_FOUND') throw error;
      const wrapped = toAppError(error);
      if (wrapped.code === 'HOUSEHOLD_UNAVAILABLE') throw wrapped;
      throw new AppError('DOORS_LOAD_FAILED', undefined, { cause: wrapped.code });
    }
  }

  door(doorId) {
    const found = this.doorIndex.get(doorId);
    if (!found) throw fail('DOOR_NOT_FOUND');
    return found;
  }

  connected() { return this.client?.getCredentials().connected === true; }

  /** 调用 SDK 开门；返回归一化业务结果。 */
  async openDoor(doorId) {
    if (!this.client) throw fail('NOT_LOGGED_IN');
    if (!this.selectedHouseholdId || !this.directoryId) throw fail('STALE_DIRECTORY');
    // The HTTP route has already validated the caller's directory and household.
    // Recover a disconnected channel before sending, then resolve the same stable
    // door id again so a removed/changed door cannot be opened accidentally.
    const householdId = this.selectedHouseholdId;
    this.door(doorId);
    if (!this.connected()) await this.loadDirectory(householdId);
    const door = this.door(doorId);
    const startedAt = Date.now();
    const result = await this.client.openDoor({ householdId: this.selectedHouseholdId, directoryId: this.directoryId, doorId: door.id });
    return {
      success: result.success === true,
      status: result.status,
      message: result.message || (result.success ? '开门成功' : '开门失败'),
      doorId: door.id,
      doorName: door.name,
      householdId: this.selectedHouseholdId,
      directoryId: this.directoryId,
      upstreamCode: result.code || '',
      at: startedAt,
      cooldownMs: this.client.openCooldownMs,
    };
  }
}

/** 会话池：uid → Session，带闲置回收。 */
export class SessionPool {
  constructor({ origin, secret, transport = {}, maxSessions = MAX_SESSIONS, idleLimitMs = IDLE_LIMIT_MS, onEvict } = {}) {
    this.origin = origin || DEFAULT_ORIGIN;
    this.secret = secret;
    this.transport = transport;
    this.maxSessions = maxSessions;
    this.idleLimitMs = idleLimitMs;
    this.sessions = new Map();
    this.onEvict = onEvict;
  }

  #deviceId(account) {
    return this.secret ? deriveDeviceId(this.secret, account) : '';
  }

  get(uid) {
    const session = this.sessions.get(uid);
    if (session) { session.touch(); return session; }
    return null;
  }

  create(uid, account) {
    const session = new Session(uid, { origin: this.origin, deviceId: this.#deviceId(account), transport: this.transport });
    this.sessions.set(uid, session);
    this.#evictIfNeeded();
    return session;
  }

  drop(uid) {
    const session = this.sessions.get(uid);
    if (!session) return;
    session.clearLocal();
    this.sessions.delete(uid);
    this.onEvict?.(uid);
  }

  adopt(uid, session) {
    this.sessions.set(uid, session);
    this.#evictIfNeeded();
  }

  #evictIfNeeded() {
    if (this.sessions.size <= this.maxSessions) return;
    const candidates = [...this.sessions.values()]
      .filter(session => session.pending === 0)
      .sort((a, b) => a.lastUsedAt - b.lastUsedAt);
    for (const session of candidates) {
      if (this.sessions.size <= this.maxSessions) break;
      session.clearLocal();
      this.sessions.delete(session.uid);
      this.onEvict?.(session.uid);
    }
  }

  /** 后台回收：闲置且无在途请求。 */
  sweep(now = Date.now()) {
    let removed = 0;
    for (const [uid, session] of this.sessions) {
      if (session.pending > 0) continue;
      if (now - session.lastUsedAt < this.idleLimitMs) continue;
      session.clearLocal();
      this.sessions.delete(uid);
      this.onEvict?.(uid);
      removed += 1;
    }
    return removed;
  }

  closeAll() {
    for (const session of this.sessions.values()) session.clearLocal();
    this.sessions.clear();
  }

  size() { return this.sessions.size; }
}

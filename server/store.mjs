/**
 * 零依赖加密存储层。
 *
 * 设计目标（可在 Docker/Linux 与本机 Node.js 运行）：
 *  1. 每个用户的桃园谷登录凭据独立加密落盘，AES-256-GCM + 每文件随机 IV + 认证标签；
 *  2. 数据密钥随机生成，由外部 APP_SECRET 封装；应用启动时强制配置外部密钥。
 *  3. 用户目录名与文件内容都不含明文账号（HMAC 派生 uid）；
 *  4. 原子写（临时文件 + rename）+ 0o600 权限；
 *  5. 提供有界 LRU 内存缓存，避免每次请求读盘。
 */
import { createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, readdir, unlink, stat, open } from 'node:fs/promises';
import { join, resolve, dirname, basename } from 'node:path';
import { durableWrite, seal, unseal } from './persistence.mjs';

const BLOB_FORMAT = 1;
const IV_LENGTH = 12;
const MAX_FILE_BYTES = 256 * 1024;

/** 派生 uid：同一账号在任意浏览器/重启后一致，且不可从 uid 反推账号。 */
export function deriveUserId(secret, account) {
  return createHmac('sha256', secret).update(`user:${String(account).trim()}`).digest('hex').slice(0, 32);
}

/** 稳定设备标识：同一用户的多次登录复用，行为对齐官方 App 的"同一台设备"。 */
export function deriveDeviceId(secret, account) {
  return createHmac('sha256', secret).update(`device:${String(account).trim()}`).digest('hex').slice(0, 32);
}

class Lru {
  constructor(limit) { this.limit = limit; this.map = new Map(); }
  get(key) {
    if (!this.map.has(key)) return undefined;
    const value = this.map.get(key);
    this.map.delete(key); this.map.set(key, value);
    return value;
  }
  set(key, value) {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.limit) this.map.delete(this.map.keys().next().value);
  }
  delete(key) { this.map.delete(key); }
  clear() { this.map.clear(); }
}

export class SecretStore {
  /**
   * @param {object} options
   * @param {string} options.directory 数据目录（容器内挂载卷）
   * @param {Buffer} [options.key] 32 字节主密钥；缺省时在 directory 内生成/读取
   */
  constructor({ directory, key, wrappingSecret = '' } = {}) {
    this.directory = resolve(directory || './data');
    this.userDirectory = join(this.directory, 'users');
    this.prefsDirectory = join(this.directory, 'prefs');
    this.keyPath = join(this.directory, '.app-secret');
    this.key = key && key.length === 32 ? key : null;
    this.wrappingSecret = wrappingSecret;
    this.cache = new Lru(200);
    this.ready = null;
  }

  async init() {
    if (this.ready) return this.ready;
    this.ready = (async () => {
      await mkdir(this.userDirectory, { recursive: true, mode: 0o700 });
      await mkdir(this.prefsDirectory, { recursive: true, mode: 0o700 });
      if (this.key) return this;
      let raw = null;
      try {
        raw = (await readFile(this.keyPath)).toString('utf8').trim();
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
      if (raw === null) {
        if ((await readdir(this.userDirectory)).some(n => n.endsWith('.blob')) ||
            (await readdir(this.prefsDirectory)).some(n => n.endsWith('.prefs') || n.endsWith('.prefs.bak')) ||
            await stat(join(this.directory,'sessions.json')).then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e;}) ||
            await stat(join(this.directory,'auth-limits.json')).then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e;})) {
          throw new Error('DATA_KEY_MISSING: 请恢复原密钥；禁止覆盖已有数据');
        }
        raw = randomBytes(32).toString('hex');
      }
      const wrapKey = this.wrappingSecret ? createHash('sha256').update(`opentyg:key-wrap:v1:${this.wrappingSecret}`).digest() : null;
      let keyHex;
      if (/^[a-f0-9]{64}$/.test(raw)) keyHex = raw;
      else {
        if (!wrapKey) throw new Error('APP_SECRET_REQUIRED: 加密密钥文件需要原 APP_SECRET');
        try { keyHex = unseal(wrapKey, JSON.parse(raw), 'opentyg:data-key:v1').key; }
        catch { throw new Error('APP_SECRET_MISMATCH: 密钥不匹配或文件损坏，已保留原数据'); }
        if (!/^[a-f0-9]{64}$/.test(keyHex || '')) throw new Error('DATA_KEY_INVALID');
      }
      // Preserve the old random AES key during migration; protect it with an external secret.
      await durableWrite(this.keyPath, wrapKey ? JSON.stringify(seal(wrapKey, { key: keyHex }, 'opentyg:data-key:v1')) : keyHex);
      this.key = Buffer.from(keyHex, 'hex');
      return this;
    })();
    return this.ready;
  }

  #open(envelope) {
    if (!envelope || envelope.format !== BLOB_FORMAT) throw Object.assign(new Error('凭据文件格式不支持'), { code: 'SAVED_LOGIN_INVALID' });
    const iv = Buffer.from(String(envelope.iv || ''), 'base64');
    const tag = Buffer.from(String(envelope.tag || ''), 'base64');
    if (iv.length !== IV_LENGTH || tag.length !== 16) throw Object.assign(new Error('凭据文件损坏'), { code: 'SAVED_LOGIN_INVALID' });
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    try {
      return Buffer.concat([decipher.update(Buffer.from(String(envelope.ciphertext || ''), 'base64')), decipher.final()]).toString('utf8');
    } catch {
      // 认证失败：密钥变更（例如 APP_SECRET 换了）或文件被篡改。
      throw Object.assign(new Error('凭据无法解密'), { code: 'SAVED_LOGIN_INVALID' });
    }
  }

  async #readJson(path) {
    const info = await stat(path).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
    if (!info) return null;
    if (info.size > MAX_FILE_BYTES) throw Object.assign(new Error('凭据文件过大'), { code: 'SAVED_LOGIN_INVALID' });
    let raw;
    try { raw = await readFile(path, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
    if (raw.length > MAX_FILE_BYTES) throw Object.assign(new Error('凭据文件过大'), { code: 'SAVED_LOGIN_INVALID' });
    try {
      const envelope = JSON.parse(raw);
      return envelope.format === 2 ? unseal(this.key,envelope,this.#context(path)) : JSON.parse(this.#open(envelope));
    }
    catch { throw Object.assign(new Error('加密文件损坏，请恢复备份'), { code: 'SAVED_LOGIN_INVALID' }); }
  }

  async #writeJson(path, value) {
    await this.init();
    const envelope = seal(this.key, value, this.#context(path));
    const payload = JSON.stringify(envelope);
    if (Buffer.byteLength(payload) > MAX_FILE_BYTES) throw Object.assign(new Error('存储大小超限'), { code: 'CREDENTIAL_STORE_UNAVAILABLE' });
    await durableWrite(path, payload);
  }

  #context(path) { return `opentyg:${dirname(path) === this.userDirectory ? 'user' : 'prefs'}:${basename(path).split('.')[0]}:v2`; }

  async #remove(path) {
    try { await unlink(path); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (process.platform !== 'win32') {
      const directory = await open(dirname(path), 'r');
      try { await directory.sync(); } finally { await directory.close(); }
    }
  }

  #validateUid(uid) { if (!/^[a-f0-9]{32}$/.test(uid || '')) throw new Error('INVALID_USER_ID'); return uid; }
  #userPath(uid) { return join(this.userDirectory, `${this.#validateUid(uid)}.blob`); }
  #prefsPath(uid) { return join(this.prefsDirectory, `${this.#validateUid(uid)}.prefs`); }

  /**
   * 读取用户记录：{ version, account, loginType, user, device:{...}, session:<serializeLoginSession 字节的 base64>, savedAt }
   */
  async readUser(uid) {
    await this.init();
    const path = this.#userPath(uid);
    const info = await stat(path).catch(() => null);
    const cached = this.cache.get(`u:${uid}`);
    if (cached && info && cached.mtimeMs === info.mtimeMs) return structuredClone(cached.value);
    const value = await this.#readJson(path).catch(error => {
      if (error.code === 'SAVED_LOGIN_INVALID') return null; // 视为无凭据，要求重新登录
      throw error;
    });
    if (info) this.cache.set(`u:${uid}`, { mtimeMs: info.mtimeMs, value });
    return structuredClone(value);
  }

  async writeUser(uid, record) {
    const path = this.#userPath(uid);
    await this.#writeJson(path, record);
    const info = await stat(path).catch(() => null);
    if (info) this.cache.set(`u:${uid}`, { mtimeMs: info.mtimeMs, value: structuredClone(record) });
  }

  async removeUser(uid) {
    this.cache.delete(`u:${uid}`);
    await this.#remove(this.#userPath(uid));
  }

  async readPrefs(uid, { preferMemory = false } = {}) {
    await this.init();
    const path = this.#prefsPath(uid);
    const cached = this.cache.get(`p:${uid}`);
    // Presentation reads can use the last authenticated in-process value. All
    // mutations still validate the file, and every write refreshes this cache.
    if (preferMemory && cached) return structuredClone(cached.value);
    const info = await stat(path).catch(() => null);
    if (cached && info && cached.mtimeMs === info.mtimeMs) return structuredClone(cached.value);
    const value = await this.#readJson(path).catch(() => {
      throw Object.assign(new Error('偏好文件损坏，请联系管理员恢复备份'), { code: 'CREDENTIAL_STORE_UNAVAILABLE' });
    });
    if (info) this.cache.set(`p:${uid}`, { mtimeMs: info.mtimeMs, value });
    return structuredClone(value);
  }

  /**
   * 写偏好。**覆盖已有文件前先留一份 `.prefs.bak`**。
   *
   * 为什么必须备份：偏好是用户手工积累的资产（收藏、自定义名称、位次、显示名）。
   * 格式迁移、逻辑调整、误操作都可能把它写坏，而一旦覆盖就再也拿不回来——
   * 只保留"上一版"，开销是一个文件，换来的是任何一次误写都可回滚。
   */
  async writePrefs(uid, prefs) {
    const path = this.#prefsPath(uid);
    const existed = (await stat(path).catch(e => { if (e.code === 'ENOENT') return null; throw e; }))?.isFile() === true;
    if (existed) await durableWrite(`${path}.bak`, await readFile(path));
    await this.#writeJson(path, prefs);
    const info = await stat(path).catch(() => null);
    if (info) this.cache.set(`p:${uid}`, { mtimeMs: info.mtimeMs, value: structuredClone(prefs) });
  }

  async removePrefs(uid) {
    this.cache.delete(`p:${uid}`);
    await this.#remove(this.#prefsPath(uid));
    await this.#remove(`${this.#prefsPath(uid)}.bak`);
  }

  async pruneUsers(keep, release = () => {}) {
    for (const name of await readdir(this.userDirectory)) {
      if (!/^[a-f0-9]{32}\.blob$/.test(name)) continue;
      const uid = name.slice(0,32);
      if (!keep(uid)) { try { await this.removeUser(uid); } finally { release(uid); } }
    }
  }

  /** 供运维审计使用：只返回数量，不返回任何标识。 */
  async stats() {
    await this.init();
    const count = async dir => (await readdir(dir).catch(() => [])).filter(name => !name.endsWith('.tmp')).length;
    return { users: await count(this.userDirectory), prefs: await count(this.prefsDirectory), directory: this.directory };
  }
}

/** 常量时间比较，用于校验 cookie 签名。 */
export function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** 生成不可猜测的会话标识。 */
export const newSessionId = () => randomBytes(32).toString('hex');

/** 会话 cookie 的签名：防止伪造任意 sessionId 触发无谓的上游调用。 */
export function signSessionId(secret, id) {
  return createHmac('sha256', secret).update(`session:${id}`).digest('hex').slice(0, 32);
}

export function sessionIdFingerprint(id) {
  return createHash('sha256').update(String(id)).digest('hex').slice(0, 8);
}

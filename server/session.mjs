import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { newSessionId, signSessionId, safeEqual } from './store.mjs';
import { seal, unseal, durableWriteSync } from './persistence.mjs';
import { fail } from './errors.mjs';

export const COOKIE_NAME = 'opentyg_session';
const REMEMBER_SECONDS = 30 * 24 * 60 * 60;
export function parseCookies(header) {
  const result = Object.create(null);
  for (const part of String(header || '').split(';')) {
    const index = part.indexOf('=');
    if (index < 1) continue;
    try { result[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim()); }
    catch { /* Ignore malformed cookies. */ }
  }
  return result;
}
export function readSessionCookie(req, secret) {
  const raw = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (!raw || !/^[a-f0-9]{64}\.[a-f0-9]{32}$/.test(raw)) return null;
  const [id, signature] = raw.split('.');
  return safeEqual(signSessionId(secret, id), signature) ? id : null;
}
function cookie(value, { maxAge, secure }) {
  return [`${COOKIE_NAME}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Strict',
    ...(maxAge === undefined ? [] : [`Max-Age=${maxAge}`]), ...(secure ? ['Secure'] : [])].join('; ');
}
export function setSessionCookie(res, secret, id, { remember, secure }) {
  res.setHeader('Set-Cookie', cookie(`${id}.${signSessionId(secret, id)}`, { maxAge: remember ? REMEMBER_SECONDS : undefined, secure }));
}
export function clearSessionCookie(res, { secure }) {
  res.setHeader('Set-Cookie', cookie('', { maxAge: 0, secure }));
}
export class SessionRegistry {
  constructor({ secret, key, path, ttlMs = REMEMBER_SECONDS * 1000, maxEntries = 1000 } = {}) {
    Object.assign(this, { secret, key, path: path || '', ttlMs, maxEntries });
    this.entries = new Map(); this.loaded = 0; this.loadError = null; this.flushError = null;
  }
  expired(entry, now = Date.now()) {
    const limit = entry.uid ? (entry.remember ? this.ttlMs : 12 * 60 * 60 * 1000) : 10 * 60 * 1000;
    return !Number.isFinite(entry.createdAt) || now - entry.createdAt >= limit || entry.createdAt > now + 60_000;
  }
  create({ uid, remember }) {
    this.sweep();
    if (this.entries.size >= this.maxEntries) throw fail('RATE_LIMITED');
    const id = newSessionId(); const now = Date.now();
    this.entries.set(id, { id, uid: uid || null, remember: remember === true, createdAt: now, lastSeenAt: now });
    try { if (uid && remember) this.flush(); } catch (error) { this.entries.delete(id); throw error; }
    return id;
  }
  get(id) {
    const entry = this.entries.get(id);
    if (!entry) return null;
    if (this.expired(entry)) { this.entries.delete(id); if (entry.uid && entry.remember) this.flush(); return null; }
    entry.lastSeenAt = Date.now(); return entry;
  }
  drop(id) { const entry = this.entries.get(id); this.entries.delete(id); if (entry?.uid && entry.remember) this.flush(); }
  dropByUid(uid) {
    for (const [id, entry] of this.entries) if (entry.uid === uid) this.entries.delete(id);
    this.flush();
  }
  sweep(now = Date.now()) {
    let removed = 0, persisted = false;
    for (const [id, entry] of this.entries) if (this.expired(entry, now)) { this.entries.delete(id); removed++; persisted ||= !!entry.uid && entry.remember; }
    if (persisted) this.flush(); return removed;
  }
  size() { return this.entries.size; }
  load() {
    if (!this.path) return this;
    try {
      const raw = readFileSync(this.path);
      if (raw.length > 2 * 1024 * 1024) throw new Error('SESSION_FILE_TOO_LARGE');
      const envelope = JSON.parse(raw.toString('utf8'));
      // Migrate original remembered logins; discard anonymous and browser-only entries.
      const parsed = envelope.version === 1 ? envelope : unseal(this.key, envelope, 'opentyg:sessions:v2');
      if (parsed?.version !== 1 || !Array.isArray(parsed.sessions)) throw new Error('SESSION_FORMAT_INVALID');
      for (const item of parsed.sessions.slice(0, this.maxEntries)) {
        if (!/^[a-f0-9]{64}$/.test(item?.id || '') || !/^[a-f0-9]{32}$/.test(item?.uid || '') || item.remember !== true) continue;
        const entry = { id: item.id, uid: item.uid, remember: true, createdAt: Number(item.createdAt), lastSeenAt: Number(item.lastSeenAt) };
        if (!this.expired(entry)) this.entries.set(entry.id, entry);
      }
      this.loaded = this.entries.size; this.flush();
    } catch (error) {
      if (error.code === 'ENOENT') return this;
      this.loadError = error.code || 'SESSION_FILE_INVALID';
      throw fail('CREDENTIAL_STORE_UNAVAILABLE', '会话文件无法安全载入，请检查密钥、权限或备份');
    }
    return this;
  }
  flush() {
    if (!this.path) return;
    try {
      const sessions = [...this.entries.values()].filter(e => e.uid && e.remember && !this.expired(e));
      durableWriteSync(this.path, JSON.stringify(seal(this.key, { version: 1, sessions }, 'opentyg:sessions:v2')));
      this.flushError = null;
    } catch {
      this.flushError = 'SESSION_WRITE_FAILED'; throw fail('CREDENTIAL_STORE_UNAVAILABLE');
    }
  }
}
export const newChallengeId = () => randomBytes(16).toString('hex');

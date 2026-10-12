import { createHmac, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { seal, unseal, durableWriteSync } from './persistence.mjs';
import { fail } from './errors.mjs';

const MINUTE = 60_000, HOUR = 60 * MINUTE;
const CONTEXT = 'opentyg:auth-limits:v1';
export function retryDuration(seconds) {
  if (seconds < 60) return `${Math.max(1, Math.ceil(seconds))}秒`;
  if (seconds < 3600) return `${Math.ceil(seconds / 60)}分钟`;
  return `${Math.ceil(seconds / 3600)}小时`;
}

// One instance per application. Keys are purpose-bound HMACs; no account/password
// is stored. Reservations are flushed before contacting upstream, so uncertain
// network failures and concurrent browsers cannot exceed the SMS quota.
export class AuthLimits {
  constructor({ secret, key, path, now = Date.now, maxEntries = 2000 }) {
    Object.assign(this, { secret, key, path, now, maxEntries });
    this.entries = new Map(); this.flushError = null;
  }
  identity(purpose, account) {
    return createHmac('sha256', this.secret).update(`${purpose}:${String(account).trim()}`).digest('hex');
  }
  prune(entry, now) {
    entry.sms = entry.sms.filter(x => x.at > now - 12 * HOUR);
    entry.failures = entry.failures.filter(x => x > now - 10 * MINUTE);
    if (entry.lockedUntil <= now) entry.lockedUntil = 0;
    return entry.sms.length || entry.failures.length || entry.lockedUntil;
  }
  entry(id, create = false) {
    const now = this.now(); let entry = this.entries.get(id);
    if (entry) this.prune(entry, now);
    if (!entry && create) {
      for (const [key, value] of this.entries) if (!this.prune(value, now)) this.entries.delete(key);
      if (this.entries.size >= this.maxEntries) throw fail('RATE_LIMITED');
      entry = { sms: [], failures: [], lockedUntil: 0 }; this.entries.set(id, entry);
    }
    return entry;
  }
  checkSms(mobile) {
    const entry = this.entry(this.identity('sms', mobile));
    if (!entry) return;
    const now = this.now(); let wait = 0;
    for (const [window, limit] of [[HOUR, 3], [12 * HOUR, 12]]) {
      const times = entry.sms.filter(x => x.at > now - window).map(x => x.at).sort((a, b) => a - b);
      if (times.length >= limit) wait = Math.max(wait, times[times.length - limit] + window - now);
    }
    if (wait > 0) {
      const seconds = Math.ceil(wait / 1000);
      throw fail('SMS_RATE_LIMITED', `短时间内获取验证码次数过多，请过${retryDuration(seconds)}重试`, { retryAfterSeconds: seconds });
    }
  }
  reserveSms(mobile) {
    this.checkSms(mobile);
    const key = this.identity('sms', mobile), entry = this.entry(key, true);
    const id = randomBytes(8).toString('hex'); entry.sms.push({ at: this.now(), id });
    this.flush(); return { key, id };
  }
  releaseSms(reservation) {
    const entry = this.entries.get(reservation.key);
    if (!entry) return;
    entry.sms = entry.sms.filter(x => x.id !== reservation.id); this.flush();
  }
  checkLogin(account) {
    const entry = this.entry(this.identity('password', account));
    if (entry?.lockedUntil > this.now()) throw fail('PASSWORD_RATE_LIMITED', undefined, {
      retryAfterSeconds: Math.ceil((entry.lockedUntil - this.now()) / 1000),
    });
  }
  passwordFailure(account) {
    this.checkLogin(account);
    const entry = this.entry(this.identity('password', account), true);
    entry.failures.push(this.now());
    if (entry.failures.length > 3) entry.lockedUntil = this.now() + HOUR;
    this.flush(); this.checkLogin(account);
  }
  load() {
    if (!this.path) return this;
    try {
      const raw = readFileSync(this.path);
      if (raw.length > 4 * 1024 * 1024) throw new Error('AUTH_LIMITS_SIZE');
      const value = unseal(this.key, JSON.parse(raw.toString('utf8')), CONTEXT);
      if (value?.version !== 1 || !Array.isArray(value.entries) || value.entries.length > this.maxEntries) throw new Error('AUTH_LIMITS_FORMAT');
      for (const [id, entry] of value.entries) {
        if (!/^[a-f0-9]{64}$/.test(id) || this.entries.has(id) || !Array.isArray(entry?.sms) || entry.sms.length > 12 || !Array.isArray(entry.failures) || entry.failures.length > 4 || !Number.isFinite(entry.lockedUntil) || entry.lockedUntil < 0) throw new Error('AUTH_LIMITS_FORMAT');
        if (entry.sms.some(x => !Number.isFinite(x?.at) || !/^[a-f0-9]{16}$/.test(x?.id)) || entry.failures.some(x => !Number.isFinite(x))) throw new Error('AUTH_LIMITS_FORMAT');
        if (this.prune(entry, this.now())) this.entries.set(id, entry);
      }
      return this;
    } catch (error) {
      if (error.code === 'ENOENT') return this;
      throw fail('CREDENTIAL_STORE_UNAVAILABLE', '登录限流记录无法安全载入，请检查密钥、权限或备份');
    }
  }
  flush() {
    if (!this.path) return;
    try {
      const now = this.now();
      for (const [id, entry] of this.entries) if (!this.prune(entry, now)) this.entries.delete(id);
      durableWriteSync(this.path, JSON.stringify(seal(this.key, { version: 1, entries: [...this.entries] }, CONTEXT)));
      this.flushError = null;
    } catch {
      this.flushError = 'AUTH_LIMITS_WRITE_FAILED';
      throw fail('CREDENTIAL_STORE_UNAVAILABLE');
    }
  }
}

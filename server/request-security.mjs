import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { fail } from './errors.mjs';

export function loadAppSecret() {
  const file = process.env.APP_SECRET_FILE;
  if (file && process.env.APP_SECRET) throw new Error('仅设置 APP_SECRET_FILE 或 APP_SECRET 之一');
  return file ? readFileSync(file, 'utf8').trim() : (process.env.APP_SECRET || '');
}

export function requestPolicy({ publicOrigin = '', cookieSecure, localTest = false, host = '0.0.0.0' }) {
  const external = publicOrigin ? new URL(publicOrigin) : null;
  if (external && (external.username || external.password || external.pathname !== '/' || external.search || external.hash)) throw new Error('PUBLIC_ORIGIN 必须只包含协议、域名、端口');
  if (localTest && (!['127.0.0.1','::1'].includes(host) || !external || external.protocol !== 'http:' || !['127.0.0.1','localhost','[::1]'].includes(external.hostname))) throw new Error('LOCAL_TEST_MODE 仅允许绑定回环地址和本机 HTTP origin');
  if (!localTest && external?.protocol !== 'https:') throw new Error('生产模式需设置 HTTPS PUBLIC_ORIGIN');
  const secure = cookieSecure ?? (external?.protocol === 'https:');
  if (!localTest && !secure) throw new Error('生产模式必须启用 Secure Cookie');
  return {
    secure,
    navigationRedirect(req, url) {
      // Only a browser's landing-page navigation gets a fixed canonical URL.
      // Never serve the application, forward query strings, or relax API checks
      // for an unrecognized Host. Behind the proxy the public Host must match.
      if (!localTest && external && ['GET', 'HEAD'].includes(req.method)
        && url.pathname === '/' && /\btext\/html\b/i.test(String(req.headers.accept || ''))
        && String(req.headers.host || '').toLowerCase() !== external.host.toLowerCase()) return external.href;
      return null;
    },
    check(req, url) {
      if (external && String(req.headers.host || '').toLowerCase() !== external.host.toLowerCase() && url.pathname !== '/api/health') throw fail('FORBIDDEN');
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
        const expected = external?.origin || `http://${req.headers.host}`;
        if (req.headers.origin && req.headers.origin !== expected) throw fail('FORBIDDEN');
        if (req.headers['sec-fetch-site'] === 'cross-site') throw fail('FORBIDDEN');
        if (external && !req.headers.origin) throw fail('FORBIDDEN');
        if (req.headers['x-opentyg-request'] !== '1') throw fail('FORBIDDEN');
      }
    },
  };
}

// Keys are HMACs, never plaintext phone numbers/IPs. State is bounded and expires.
export class RateLimiter {
  constructor(secret, { now = Date.now } = {}) { this.secret = secret; this.now = now; this.entries = new Map(); }
  check(value, limit, windowMs) {
    const now = this.now(); const key = createHmac('sha256', this.secret).update(value).digest('hex');
    let entry = this.entries.get(key);
    if (!entry || now >= entry.until) {
      if (this.entries.size >= 2000) {
        for (const [k, e] of this.entries) if (now >= e.until) this.entries.delete(k);
        if (this.entries.size >= 2000) throw fail('RATE_LIMITED');
      }
      entry = { count: 0, until: now + windowMs }; this.entries.set(key, entry);
    }
    if (++entry.count > limit) throw fail('RATE_LIMITED', undefined, { retryAfterSeconds: Math.max(1, Math.ceil((entry.until - now) / 1000)) });
  }
}

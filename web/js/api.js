/**
 * api.js — 后端接口层（唯一出口）
 * 契约依据：docs/api.md
 *  - 所有请求同源、credentials:'include'
 *  - 统一解析 { ok:true, data } / { ok:false, error:{code,message,details} }
 *  - 失败抛出 ApiError（带 .code / .status / .details）
 *  - HTTP 401 或 SESSION_EXPIRED / NOT_LOGGED_IN 触发全局会话失效回调
 */

export class ApiError extends Error {
  constructor(code, message, details, status) {
    super(message || code || '请求失败');
    this.name = 'ApiError';
    this.code = code || 'UNKNOWN';
    this.details = details || {};
    this.status = status || 0;
  }
}

/** 会话失效（401）时的全局回调，由 app.js 注册 */
let unauthorizedHandler = null;
let directoryContext = () => ({});
export function setDirectoryContext(fn) { directoryContext = fn; }
export function setUnauthorizedHandler(fn) {
  unauthorizedHandler = typeof fn === 'function' ? fn : null;
}

const SESSION_CODES = new Set(['SESSION_EXPIRED', 'NOT_LOGGED_IN', 'NOT_AUTHENTICATED']);

function fireUnauthorized() {
  if (unauthorizedHandler) {
    try { unauthorizedHandler(); } catch (err) { console.error('[opentyg] unauthorized handler failed', err); }
  }
}

function buildUrl(path, query) {
  if (!query) return path;
  const usp = new URLSearchParams();
  for (const key of Object.keys(query)) {
    const value = query[key];
    if (value === undefined || value === null) continue;
    usp.set(key, typeof value === 'boolean' ? (value ? '1' : '0') : String(value));
  }
  const qs = usp.toString();
  return qs ? `${path}?${qs}` : path;
}

async function request(path, options = {}) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new ApiError('NETWORK_ERROR', '当前处于离线状态，请联网后重试', {}, 0);
  }
  const { method = 'GET', body, query } = options;
  const headers = { Accept: 'application/json' };
  if (method !== 'GET') headers['X-OpenTYG-Request'] = '1';
  if (body !== undefined) headers['Content-Type'] = 'application/json; charset=utf-8';

  let res;
  try {
    res = await fetch(buildUrl(path, query), {
      method,
      headers,
      credentials: 'include',
      cache: 'no-store',
      signal: AbortSignal.timeout(45_000),
      body: body === undefined ? undefined : JSON.stringify(path.startsWith('/api/doors/') ? { ...directoryContext(), ...body } : body),
    });
  } catch (cause) {
    throw new ApiError(cause.name === 'TimeoutError' ? 'REQUEST_TIMEOUT' : 'NETWORK_ERROR', '未收到服务器响应，请检查网络', {}, 0);
  }

  let payload = null;
  let text = '';
  try { text = await res.text(); } catch { text = ''; }
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = null; }
  }

  if (!payload || typeof payload !== 'object') {
    if (res.status === 401) {
      fireUnauthorized();
      throw new ApiError('NOT_LOGGED_IN', '登录状态已失效，请重新登录', {}, 401);
    }
    throw new ApiError('BAD_RESPONSE', `服务器返回异常（HTTP ${res.status}）`, {}, res.status);
  }

  if (payload.ok === true) return payload.data;

  const error = payload.error || {};
  const code = error.code || (res.status === 401 ? 'NOT_LOGGED_IN' : 'UNKNOWN');
  const message = error.message || `请求失败（HTTP ${res.status}）`;

  if (SESSION_CODES.has(code) || code === 'SAVED_LOGIN_INVALID') fireUnauthorized();

  throw new ApiError(code, message, error.details, res.status);
}

export const api = {
  /* ---- 基础 ---- */
  getMeta: () => request('/api/meta'),

  /* ---- 认证 ---- */
  getSession: () => request('/api/auth/session'),

  /** 图形验证码；refresh=true 表示「换一张」 */
  requestCaptcha: (mobile, refresh = false) =>
    request('/api/auth/captcha', { method: 'POST', body: { mobile, refresh: !!refresh } }),

  /** 图形码图片地址（本后端同源，交给 <img src> 使用） */
  captchaImageUrl: (challengeId) =>
    `/api/auth/captcha-image?challengeId=${encodeURIComponent(String(challengeId || ''))}`,

  sendSms: (challengeId, picRandom) =>
    request('/api/auth/sms', { method: 'POST', body: { challengeId, picRandom } }),

  loginSms: ({ mobile, smsCode, remember }) =>
    request('/api/auth/login-sms', { method: 'POST', body: { mobile, smsCode, remember: !!remember } }),

  loginPassword: ({ account, password, changeDeviceSmsCode, remember }) =>
    request('/api/auth/login-password', {
      method: 'POST',
      body: {
        account,
        password,
        changeDeviceSmsCode: changeDeviceSmsCode || '',
        remember: !!remember,
      },
    }),

  logout: () => request('/api/auth/logout', { method: 'POST', body: {} }),

  /* ---- 房产 ---- */
  getHouseholds: () => request('/api/households'),
  selectHousehold: (householdId) =>
    request('/api/households/select', { method: 'POST', body: { householdId } }),

  /* ---- 门禁 ---- */
  getDoors: (refresh = false) => request('/api/doors', { query: { refresh: refresh ? 1 : 0 } }),

  renameDoor: (doorId, name) =>
    request('/api/doors/rename', { method: 'POST', body: { doorId, name } }),

  resetDoorName: (doorId) =>
    request('/api/doors/reset-name', { method: 'POST', body: { doorId } }),

  /** priority 省略 = 自动取最小空位；1..5 = 指定位次（占用则交换） */
  favoriteDoor: ({ doorId, favorite, priority }) => {
    const body = { doorId, favorite: !!favorite };
    if (priority !== undefined && priority !== null) body.priority = Number(priority);
    return request('/api/doors/favorite', { method: 'POST', body });
  },

  reorderDoors: (doorIds) =>
    request('/api/doors/reorder', { method: 'POST', body: { doorIds: doorIds.slice() } }),

  openDoor: (doorId, context) => request('/api/doors/open', { method: 'POST', body: { doorId, ...context } }),

  /* ---- 我的 ---- */
  getMe: () => request('/api/me'),
  /* 修改本应用内的显示名称（不会改动桃园谷账号姓名）；传空字符串恢复为上游姓名 */
  setDisplayName: (name) => request('/api/me/name', { method: 'POST', body: { name } }),
};

export default api;

/**
 * 统一错误模型。
 * 前端只看到 { ok:false, error:{ code, message, details } }，message 为可直接展示的中文文案。
 * 上游（桃园谷）错误码在此收敛，不允许把上游原文或凭据细节透出给浏览器。
 */

/** 应用自有错误码 → 展示文案 + HTTP 状态码 */
const APP_ERRORS = {
  BAD_REQUEST: ['请求参数不正确', 400],
  INVALID_INPUT: ['请求参数不正确', 400],
  UNAUTHORIZED: ['请先登录', 401],
  NOT_LOGGED_IN: ['登录状态已失效，请重新登录', 401],
  SESSION_EXPIRED: ['登录状态已失效，请重新登录', 401],
  SAVED_LOGIN_INVALID: ['登录状态已失效，请重新登录', 401],
  ALREADY_LOGGED_IN: ['当前已登录，请先退出登录', 409],
  FORBIDDEN: ['没有权限执行该操作', 403],
  NOT_FOUND: ['接口不存在', 404],
  METHOD_NOT_ALLOWED: ['接口不支持此 HTTP 方法', 405],
  BODY_TOO_LARGE: ['请求内容过大', 413],
  CONTENT_TYPE: ['请求需使用 application/json', 415],
  INVALID_JSON: ['请求体不是合法的 JSON 对象', 400],
  RATE_LIMITED: ['操作过于频繁，请稍后再试', 429],
  SMS_RATE_LIMITED: ['短时间内获取验证码次数过多，请稍后重试', 429],
  PASSWORD_RATE_LIMITED: ['密码错误次数过多，请1h后再试。', 429],

  HOUSEHOLD_NOT_SELECTED: ['请先选择房产', 400],
  HOUSEHOLD_NOT_FOUND: ['请从当前房产列表中选择', 404],
  HOUSEHOLD_UNAVAILABLE: ['该房产权限不可用，请联系物业核实', 403],
  DOOR_NOT_FOUND: ['门禁不存在或已更新，请刷新门禁列表', 404],
  FAVORITES_FULL: ['首页最多只能收藏 5 个门禁，请先取消一个', 400],
  INVALID_ORDER: ['排序数据不完整或包含重复门禁，请重试', 400],
  INVALID_NAME: ['名称需为 1-20 个字符', 400],

  DOORS_LOAD_FAILED: ['门禁列表加载失败，请检查网络后重试', 502],
  CONFIG_LOAD_FAILED: ['服务配置加载失败，请检查网络后重试', 502],
  CAPTCHA_FAILED: ['图形验证码获取失败，请稍后重试', 502],
  SMS_FAILED: ['短信验证码发送失败，请稍后重试', 502],
  LOGIN_FAILED: ['登录失败，请检查账号与验证码', 401],
  LOGIN_REJECTED: ['账号或密码不正确', 401],
  DEVICE_VERIFICATION_REQUIRED: ['该账号在新设备登录，需要短信验证码', 409],
  DEVICE_VERIFICATION_INVALID: ['换设备短信验证码不正确', 401],
  SMS_CODE_INVALID: ['短信验证码不正确', 401],
  SMS_REJECTED: ['短信验证码发送被拒绝', 502],
  CAPTCHA_EXPIRED: ['图形验证码已过期，请重新获取', 409],
  CAPTCHA_IMAGE_ERROR: ['图形验证码图片加载失败，请点击换一张', 502],

  LOCKED: ['操作进行中，请稍后重试', 409],
  BUSY: ['有请求正在处理，请稍后重试', 409],
  STALE_DIRECTORY: ['门禁列表已更新，请刷新后重试', 409],
  OPEN_COOLDOWN: ['操作过于频繁，请稍后再试', 429],
  OPEN_RESULT_UNKNOWN: ['开门结果未知，请核实门锁状态后再决定是否重试', 504],
  WS_NOT_CONNECTED: ['门禁连接已断开，请刷新门禁列表后重试', 409],
  WS_CLOSED: ['门禁连接已断开，请刷新门禁列表后重试', 409],
  WS_ERROR: ['门禁连接异常，请刷新门禁列表后重试', 502],
  WS_TIMEOUT: ['门禁服务响应超时，开门结果未知，请核实门锁状态', 504],
  WS_CONNECT_TIMEOUT: ['门禁连接超时，请检查网络后重试', 504],
  WS_SEND_FAILED: ['开门指令发送失败，请重试', 502],
  CLIENT_CLOSED: ['会话已关闭，请重新登录', 410],
  NOT_INITIALIZED: ['服务尚未就绪，请稍后重试', 503],
  UPSTREAM_REJECTED: ['桃园谷服务拒绝了本次操作', 502],
  HTTP_ERROR: ['无法连接桃园谷服务，请检查服务器网络', 502],
  HTTP_TIMEOUT: ['桃园谷服务响应超时，请稍后重试', 502],
  HTTP_STATUS: ['桃园谷服务返回异常状态', 502],
  PROTOCOL_ERROR: ['桃园谷服务返回数据异常，请联系技术支持', 502],
  INTERNAL_ERROR: ['服务器内部错误，请稍后重试', 500],
  CREDENTIAL_STORE_UNAVAILABLE: ['服务器凭据存储不可用，请联系管理员', 503],
  UPSTREAM_TRANSPORT_BLOCKED: ['上游安全连接未配置完成，请联系管理员', 502],
};

export class AppError extends Error {
  constructor(code, message, details = {}, status) {
    super(message || (APP_ERRORS[code]?.[0] ?? '操作失败'));
    this.name = 'AppError';
    this.code = code;
    this.details = details;
    this.status = status ?? (APP_ERRORS[code]?.[1] ?? 500);
    this.expose = true;
  }
  toJSON() {
    return { code: this.code, message: this.message, details: this.details };
  }
}

export const fail = (code, message, details, status) => new AppError(code, message, details, status);

/**
 * 把任意异常收敛成 AppError。
 * 上游 TygError 的错误码在 APP_ERRORS 中有映射时用中文文案覆盖，避免把 SDK 原文透出。
 */
export function toAppError(error) {
  if (error instanceof AppError) return error;
  const code = typeof error?.code === 'string' ? error.code : '';
  if (code && APP_ERRORS[code]) {
    // 上游明确给出 reason 时保留，便于用户排查（例如"短信获取次数过多"）。
    const mapped = APP_ERRORS[code][0];
    return new AppError(code, mapped, {}, APP_ERRORS[code][1]);
  }
  return new AppError('INTERNAL_ERROR', APP_ERRORS.INTERNAL_ERROR[0], {}, 500);
}

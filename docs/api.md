# API 参考 / API reference

[中文 README](../README.md) · [English README](../README.en.md)

## 共同约定 / Conventions

API 是同源网页应用的接口，不是任意跨域集成的公共网关。成功响应为 `{ "ok": true, "data": ... }`；失败为 `{ "ok": false, "error": { "code": "...", "message": "...", "details": ... } }`，使用对应 HTTP 状态。所有 POST 接受 JSON 对象，请求体上限 64 KiB。

This is a same-origin web application API, not a general cross-origin gateway. Success responses contain `ok: true` and `data`; errors contain `ok: false` and an `error` object with a code, message, optional details, and an appropriate HTTP status. POST bodies must be JSON objects no larger than 64 KiB.

写请求必须使用 `Content-Type: application/json`、`X-OpenTYG-Request: 1` 和与 `PUBLIC_ORIGIN` 完全一致的 `Origin`。除 `/api/health` 外，Host 必须匹配配置的公网域名及端口。请求标记本身不是登录凭据，受保护端点还需要有效 Cookie。不提供跨域 CORS。

Mutations require `Content-Type: application/json`, `X-OpenTYG-Request: 1`, and an `Origin` exactly matching `PUBLIC_ORIGIN`. Host must match the configured public domain and port, except for `/api/health`. The request marker is not authentication; protected endpoints also require a valid cookie. Cross-origin CORS is not provided.

`opentyg_session` Cookie 由服务器签名并设置，不向脚本开放。生产为 HttpOnly、Secure、SameSite=Strict、Path=/。客户端不要自行构造会话 ID 或把 Cookie 写入日志。

The server signs and sets the `opentyg_session` cookie. Production attributes are HttpOnly, Secure, SameSite=Strict, and Path=/. Do not fabricate session IDs or log cookies.

## 登录与会话 / Authentication and sessions

| 请求 / Request | 输入 / Input | 行为 / Behavior |
| --- | --- | --- |
| `GET /api/health` | 无 / None | 本地健康与版本；不验证物理门锁 / Local health and version, without testing locks |
| `GET /api/meta` | 无 / None | 应用名、版本、收藏容量及冷却 / App name, version, favorite capacity, cooldown |
| `POST /api/auth/captcha` | `mobile` | 创建匿名 Cookie 和 challengeId / Create an anonymous cookie and challengeId |
| `GET /api/auth/captcha-image` | 查询参数 / Query: `challengeId` | 当前匿名浏览器绑定的图形码 / Captcha bound to the anonymous browser |
| `POST /api/auth/sms` | `challengeId`, `picRandom` | 校验图形码并请求发送短信 / Validate captcha and request an SMS |
| `POST /api/auth/login-sms` | `mobile`, `smsCode`, `remember` | 短信登录 / SMS login |
| `POST /api/auth/login-password` | `account`, `password`, `remember`, 可选 / optional `changeDeviceSmsCode` | 密码登录及平台设备验证 / Password login and platform device verification |
| `GET /api/auth/session` | Cookie | 登录状态、用户及房产上下文 / Authentication, user, and property context |
| `POST /api/auth/logout` | 空对象 / Empty object + Cookie | 撤销账号的本服务会话，删除登录凭据，保留偏好 / Revoke this account's local sessions and saved credentials, retaining preferences |

`remember` 仅布尔 `true` 启用记住。无效账号登录不会撤销另一个已登录会话。暂时的上游或存储错误应保留错误，不假定用户一定退出登录。

Only boolean `true` enables remembered login. A failed login must not revoke another valid session. Preserve temporary upstream and storage errors rather than assuming they mean the user is signed out.

## 用户与目录 / User and directory

| 请求 / Request | 输入 / Input | 行为 / Behavior |
| --- | --- | --- |
| `GET /api/me` | Cookie | 脱敏用户、房产与统计 / Masked user, properties, and counts |
| `POST /api/me/name` | `name` | 本应用显示名称，最多 20 个 Unicode 字符，空值恢复 / Local display name, up to 20 Unicode characters; empty resets |
| `GET /api/households` | Cookie | 有权限的房产和选中 ID / Authorized properties and selected ID |
| `POST /api/households/select` | `householdId` | 校验并加载目录，旧上下文作废 / Validate and load a directory, invalidating old context |
| `GET /api/doors` | 可选查询 / Optional query: `refresh=1` | 当前目录、门禁、收藏及上下文 / Current doors, favorites, and context |

目录响应包含 `householdId`、`directoryId`、`doors`、`favorites`。ID 应原样使用，不应猜测或替换为数组序号。普通目录读取也会检查上游连接，必要时重新准备，且不发送开门指令。

Directory responses include `householdId`, `directoryId`, `doors`, and `favorites`. Use returned IDs unchanged, not guessed IDs or array positions. A normal directory read checks connectivity and prepares it if necessary without issuing a door command.

## 门禁操作 / Door operations

下面每个 POST 都必须携带当前 **`householdId` 和 `directoryId`**，以及有效 Cookie 和共同请求头。`doorId` 必须来自当前目录。

Every POST below requires current **`householdId` and `directoryId`**, a valid cookie, and the common headers. `doorId` must come from the current directory.

| 请求 / Request | 额外输入 / Additional input | 行为 / Behavior |
| --- | --- | --- |
| `POST /api/doors/rename` | `doorId`, `name` | 自定义名称，1–20 Unicode 字符；空值重置 / Rename, 1–20 Unicode characters; empty resets |
| `POST /api/doors/reset-name` | `doorId` | 恢复默认名称 / Reset the default name |
| `POST /api/doors/favorite` | `doorId`, `favorite`, 可选 / optional `priority` | 最多 5 个收藏；位次 1–5 / Up to five favorites; priority 1–5 |
| `POST /api/doors/reorder` | `doorIds` | 当前完整目录的排列，无遗漏、重复或外来门 / Permutation of the full current directory, without missing, duplicate, or foreign doors |
| `POST /api/doors/open` | `doorId` | 校验目录、权限、串行与冷却后发送 / Send after context, authorization, serialization, and cooldown checks |

开门响应中的 `data.success` 才代表平台确认结果，不能只看 HTTP 200。响应返回实际使用的 `householdId` 与 `directoryId`，客户端应同步它们。发送前的连接恢复重新定位同一个稳定门 ID，门已移除就拒绝；不会打开其他门作为替代。

Check `data.success` rather than HTTP 200 alone. Door responses include the property and directory IDs actually used; synchronize them on the client. Pre-send reconnection resolves the same stable door ID and rejects a removed door, never substituting another one.

## 错误处理 / Error handling

| Code | 客户端处理 / Client behavior |
| --- | --- |
| `SESSION_EXPIRED` / `SAVED_LOGIN_INVALID` | 提示重新登录 / Ask the user to sign in again |
| `STALE_DIRECTORY` | 刷新目录，用户重新确认操作 / Reload and obtain a new user-confirmed action |
| `HOUSEHOLD_NOT_SELECTED` | 选择有权限的房产 / Select an authorized property |
| `BUSY` / `RATE_LIMITED` | 等待；不排队积累开门 / Wait without accumulating queued door requests |
| `SMS_RATE_LIMITED` / `PASSWORD_RATE_LIMITED` | HTTP 429；显示信息并遵守 Retry-After / HTTP 429; display the message and honor Retry-After |
| `CREDENTIAL_STORE_UNAVAILABLE` | 排查权限、密钥与存储，保留原数据 / Investigate storage, keys, and permissions without discarding data |
| `OPEN_RESULT_UNKNOWN` | 核实现场，禁止自动重发 / Verify physical state; never resend automatically |

限流错误的 `error.details.retryAfterSeconds` 与 `Retry-After` 给出剩余秒数。短信滚动窗口为 3 次/1 小时和 12 次/12 小时；10 分钟内第 4 次密码错误开始锁定新登录 1 小时。业务规则详见 [隐私与运维](security.md)，错误定义以 [`server/errors.mjs`](../server/errors.mjs) 为准。

Rate-limit errors expose remaining seconds in `error.details.retryAfterSeconds` and `Retry-After`. Rolling SMS limits are three per hour and twelve per twelve hours. The fourth password failure within ten minutes locks new logins for one hour. See [privacy and operations](security.md) and the authoritative [error definitions](../server/errors.mjs).

**开门请求发出后，网络失败、超时或无法解析回执都应视为结果未知。没有响应不证明命令没有执行。不要自动重发、离线缓存或后台队列开门请求。**

**After dispatch, a network failure, timeout, or unparseable acknowledgment means an unknown result. No response does not prove the command was not executed. Never automatically retry, cache offline, or queue door commands in the background.**

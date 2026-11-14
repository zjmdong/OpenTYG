# 后端 API

[文档](README.md) / API · [English](api.en.md)

这是 OpenTYG 网页使用的**同源接口**。平台 HTTP / WebSocket / SIP 协议请看 [独立 SDK 文档](https://github.com/zjmdong/OpenTYG/blob/opentyg-sdk/docs/platform-api.md)。

## 共同约定

- JSON 成功响应：`{ "ok": true, "data": ... }`。
- 错误响应：`{ "ok": false, "error": { "code": "...", "message": "...", "details": ... } }`，搭配对应 HTTP 状态。
- POST 请求体为 JSON 对象，上限 **64 KiB**。
- 写请求必须携带 `Content-Type: application/json`、`X-OpenTYG-Request: 1`，以及与 `PUBLIC_ORIGIN` 完全一致的 `Origin`。
- 除 `/api/health` 外，Host 必须匹配配置的公网域名及端口；不提供跨域 CORS。
- 受保护端点还需有效 `opentyg_session` Cookie。请求标记不是凭据；Cookie 由服务端签名设置，生产使用 HttpOnly、Secure、SameSite=Strict、Path=/，不向脚本开放。

不要自行构造会话 ID 或记录 Cookie。验证码图片端点直接返回图片，不使用 JSON 成功封装。

## 登录与会话

| 请求 | 输入 | 行为 |
| --- | --- | --- |
| `GET /api/health` | — | 本地健康与版本，不检查物理门锁 |
| `GET /api/meta` | — | 应用名、版本、收藏容量与冷却 |
| `POST /api/auth/captcha` | `mobile` | 创建匿名 Cookie 与 challengeId |
| `GET /api/auth/captcha-image` | 查询 `challengeId` | 返回当前匿名浏览器绑定的验证码图片 |
| `POST /api/auth/sms` | `challengeId`, `picRandom` | 校验图形码并请求发送短信 |
| `POST /api/auth/login-sms` | `mobile`, `smsCode`, `remember` | 短信登录 |
| `POST /api/auth/login-password` | `account`, `password`, `remember`；可选 `changeDeviceSmsCode` | 密码登录与平台设备验证 |
| `GET /api/auth/session` | Cookie（可选） | 登录状态、用户与房产上下文 |
| `GET /api/bootstrap` | Cookie（可选） | 一次返回 `{meta, session}` |
| `POST /api/auth/logout` | `{}` + Cookie | 撤销该账号的本服务会话与保存凭据，保留偏好 |

只有布尔值 `true` 启用 `remember`。无效登录不会撤销另一个有效会话。未登录的 session/bootstrap 读取返回 `authenticated: false`；暂时的网络或存储错误不应被客户端解释成已退出。

房产权查询明确返回主 token 过期（平台 `1002` / `Token过期`）时，受影响请求返回 **401 / SESSION_EXPIRED**，包括 session/bootstrap 的恢复过程。服务端清理该账号的登录与会话、清除当前 Cookie，保留偏好。同账号其他设备的旧会话也失效，其他账号不受影响。

房产临时 token 失效时，在原准备时限内刷新一次；普通网络错误不触发账号级注销。SDK 没有主 token 续期接口，详见 [凭据生命周期](security.md#凭据生命周期)。

## 用户与目录

以下端点需要登录；POST 同时需要共同请求头。

| 请求 | 输入 | 行为 |
| --- | --- | --- |
| `GET /api/me` | Cookie | 脱敏用户、房产与统计 |
| `POST /api/me/name` | `name` | 本地显示名称，最多 20 个 Unicode 字符，空值重置 |
| `GET /api/households` | Cookie | 有权限的房产及选中 ID |
| `POST /api/households/select` | `householdId` | 校验房产、加载目录，旧上下文作废 |
| `GET /api/doors` | 可选查询 `refresh=1` | 当前目录、门禁、收藏和上下文 |

目录返回 `householdId`、`directoryId`、`doors`、`favorites` 和 `loadedAt`。ID 必须原样使用，不猜测或替换成数组序号。读取会检查连接、必要时恢复，但不发送开门指令。

`refresh=1` 创建新 UI 目录上下文；自动恢复只在房产及完整设备/配置指纹不变时保留原上下文。session/bootstrap 可能附带 `doorsPreview`：仅含当前 Cookie 所属用户的公开展示字段和收藏，无上游凭据，不构成授权，也不由浏览器或 Service Worker 持久保存。

## 门禁操作

以下 POST 都需额外携带当前 **`householdId`、`directoryId`** 和有效 Cookie。`doorId` 必须来自当前目录。

| 请求 | 输入 | 行为 |
| --- | --- | --- |
| `POST /api/doors/rename` | `doorId`, `name` | 名称 1–20 Unicode 字符，空值重置 |
| `POST /api/doors/reset-name` | `doorId` | 恢复默认名称 |
| `POST /api/doors/favorite` | `doorId`, `favorite`；可选 `priority` | 最多 5 个收藏，位次 1–5；false 取消收藏 |
| `POST /api/doors/reorder` | `doorIds` | 当前完整目录的排列，不得遗漏、重复或包含外来门 |
| `POST /api/doors/open` | `doorId` | 校验目录、权限、串行约束与冷却后发送 |

开门结果以 `data.success` 为准，不能只看 HTTP 200。响应附带实际使用的 `householdId`、`directoryId`，客户端应同步更新。恢复连接后仍定位同一个稳定门 ID；门已移除则拒绝操作。

## 错误处理

| Code | 客户端处理 |
| --- | --- |
| `SESSION_EXPIRED / SAVED_LOGIN_INVALID / NOT_LOGGED_IN` | 重新登录，不循环恢复旧登录 |
| `STALE_DIRECTORY` | 刷新目录并确认用户意图；只在明确未发送且账号、房产、门 ID 不变时继续原点击 |
| `HOUSEHOLD_NOT_SELECTED / HOUSEHOLD_UNAVAILABLE` | 选择有效房产或联系物业核实权限 |
| `DOOR_NOT_FOUND` | 刷新目录，不以其他门替代 |
| `BUSY / OPEN_COOLDOWN / RATE_LIMITED` | 等待，不累积开门队列 |
| `SMS_RATE_LIMITED / PASSWORD_RATE_LIMITED` | HTTP 429，遵守 Retry-After 和 details.retryAfterSeconds |
| `DOORS_LOAD_FAILED / UPSTREAM_REJECTED` | 显示错误；本身不代表登录已失效 |
| `CREDENTIAL_STORE_UNAVAILABLE` | 检查权限、密钥与存储，保留原数据 |
| `OPEN_RESULT_UNKNOWN / WS_TIMEOUT` | 核实物理状态，不自动重发 |

开门请求发出后的网络失败、超时或无效响应也应视为结果未知。**没有响应不证明命令没有执行；不要自动重发、离线缓存或后台排队开门。** 平台成功回执不保证物理门锁开启。

完整错误以 [server/errors.mjs](../server/errors.mjs) 为准；短信与密码限流规则见 [隐私与运维](security.md#认证限流)。

## 连接进度与时限

`GET /api/connection/status` 需要有效会话，返回 `data: { phase, step, elapsedMs }`。同账号正在恢复连接时仍可读取；它不发起平台操作、不返回凭据或账号信息，也不延长会话有效期。

- `phase`：`idle`、`restoring`、`connecting`、`directory`、`retrying`、`ready`、`failed`。
- `step`：恢复登录、连接门禁、获取列表对应的阶段编号。
- `elapsedMs`：本次准备已用时间，不是预计完成时间。

准备默认约 2.9 秒、最多 3 次尝试，单阶段无响应时限约 950ms；`GET /api/doors` 使用从请求开始计算的约 3 秒剩余预算。热点击直接提交开门，重试仅覆盖准备和确认未入队的失败；可能已发送的命令只保留单次 5 秒回执窗口，不重发。超时配置不是成功时延保证。

健康目录最长复用约 60 秒；缓存及闲置回收见 [架构说明](architecture.md#会话与存储)。日志中的「连接准备耗时」记录阶段、尝试次数和耗时，「请求耗时」记录本地 API 路径及耗时；不包含账号、token、authcode、门地址或请求体。

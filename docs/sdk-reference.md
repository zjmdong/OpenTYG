# SDK 使用参考 / SDK reference

[平台 HTTP / WS](platform-api.md) · [对讲协议](intercom-protocol.md) · [类型声明](../src/tyg-client.d.ts)

本页是 Node.js 库调用参考，平台原始字段与协议请查看另外两份文档。ES modules，Node.js 22.4+；Node.js 24 为建议运行版本。SDK 不启动 HTTP 服务器，也不提供浏览器用户认证。

**English:** This is a library reference; platform wire protocols are documented separately. Use one `TygClient` per account, keep it in a trusted Node.js process, serialize business operations, and supply your own application authentication, authorization, rate limits, and persistence.

## 构造参数 / ClientOptions

```js
import { TygClient, TygError, DEFAULT_ORIGIN, ROUTES, envelope } from 'tyg-core-sdk';
const sdk = new TygClient({ lastLoginOs: '4' });
```

| 参数 | 默认 / 类型 | 用途 |
| --- | --- | --- |
| `origin` | `http://lxj.taoyuangu.com:80` | 配置 bootstrap；只接受 HTTP/HTTPS、无 URL userinfo |
| `timeZone` | `Asia/Shanghai` | 请求时间戳 |
| `lastLoginOs` | `'4'`，允许 `'2'/'3'/'4'/'5'` | 客户端设备类型；不用于规避设备验证 |
| `deviceUniqueId` | `''` | 可选设备标识 |
| `lastLoginDeviceToken` | `''` | 可选设备推送标识 |
| `httpTimeoutMs` | `30000` | HTTP 与配置请求超时 |
| `connectTimeoutMs` | `10000` | 门禁 WebSocket 握手超时 |
| `configTimeoutMs` | `15000` | 门目录响应超时 |
| `openTimeoutMs` | `5000` | 已发送开门回执等待 |
| `openCooldownMs` | `3000` | 本实例开门操作间隔 |
| `fetchImpl` | `globalThis.fetch` | 注入可信的 HTTP 传输，供受控主机限制等集成 |
| `intercomMediaOptions.apkBridge` | `true` | 原客户端媒体兼容参数 |
| `intercomMediaOptions.offerIce` | `false` | 显式 ICE offer |
| `intercomMediaOptions.ice` | 可选 | `stunServer` / `turnServer` 为 `[host, port]`；TURN username/password 与 forceTurn |

上述默认超时与冷却是 SDK 策略，不是平台公开承诺。`fetchImpl` 只覆盖 HTTP；原生门禁 WebSocket 和 SIP/媒体 UDP 需另外约束网络出站访问。构造参数应由可信配置提供，不接受浏览器任意地址。

## 核心方法 / Core methods

| 调用 | 返回 | 行为 |
| --- | --- | --- |
| `new TygClient(options?)` | `TygClient` | 创建实例，不发网络请求。 |
| `initialize({ force=false }?)` | `Promise<Configuration>` | 未登录时使用；已初始化默认复用，force=true 重载。 |
| `createCaptcha(mobile, options?)` | `Promise<{ challengeId, imageUrl, expiresIn, image? }>` | 包含用户绑定挑战，可同时返回校验后的图片字节；不进行图形识别。 |
| `captchaImage(challengeId)` | `Promise<{ bytes: Uint8Array, contentType: string }>` | 基于挑战上下文下载图片；不执行图形识别。 |
| `sendSms(challengeId, picRandom)` | `Promise<{ sent: true, code: string, retryAfterSeconds: number }>` | 仅在原 result=0 且 code=1 时成功，成功消耗 challengeId。 |
| `loginSms(mobile, smsVerifyCode)` | `Promise<{ user: User, sessionToken: string }>` | 返回 user 与完整 sessionToken；可信后端使用，不返回浏览器。 |
| `loginPassword(account, password, changeDeviceSmsCode="")` | `Promise<{ user: User, sessionToken: string }>` | 保留平台设备变更验证，必要时由用户提供短信码。 |
| `getHouseholds()` | `Promise<Household[]>` | 查询授权列表并清除当前门连接/目录；返回房产列表不包含完整 token。 |
| `getDoorCredentials(householdId)` | `Promise<Credentials>` | 不建 WS、不取门目录；一般可直接 getDoors，无需先调用本方法。 |
| `getDoors(householdId)` | `Promise<Directory>` | 并行获取 authcode 与 WS 握手，两者就绪后下载配置；返回新 directoryId。 |
| `getCredentials({ includeSecrets=false }?)` | `Credentials（同步）` | 同步读当前三层凭据，默认只返回掩码；includeSecrets=true 只供可信后端。 |
| `getState()` | `ClientState（同步）` | 只读当前内存快照和脱敏状态，不重新登录或续期。 |
| `openDoor(input)` | `Promise<OpenResult>` | 只操作当前门目录；超时为结果未知，不自动重发。 |
| `logout()` | `Promise<{ loggedOut: true }>` | 先清理本地状态；有 sessionToken 时远程退出。对象仍可重新登录。 |
| `close()` | `void（同步）` | 同步清理本地资源，不调用远程退出；已关闭实例不可复用。 |

### 短信登录 / SMS flow

```js
await sdk.initialize();
const challenge = await sdk.createCaptcha(mobileFromUser, { includeImage: true });
// 向用户显示 challenge.image.bytes，人工输入图形码。
await sdk.sendSms(challenge.challengeId, pictureCodeFromUser);
await sdk.loginSms(mobileFromUser, smsCodeFromUser);
```

challengeId 是 SDK 当前实例的本地引用，有效上下文默认 600 秒；短信成功后消费。它不是平台 authcode。`retryAfterSeconds=60` 是本地提示，SDK 本身不提供账号级短信限流或公网密码防爆破；集成方必须另行实现。

### 目录与开门 / Directory and an explicit command

```js
const household = (await sdk.getHouseholds()).find(item => item.available);
if (!household) throw new Error('No authorized property');
const directory = await sdk.getDoors(household.id);
// 只在用户明确选择并确认后执行。选中对象必须来自本次 directory.doors。
const selectedDoor = directory.doors.find(item => item.id === userSelectedDoorId);
if (!selectedDoor) throw new Error('Invalid door selection');
const receipt = await sdk.openDoor({
  householdId: directory.householdId,
  directoryId: directory.directoryId,
  doorId: selectedDoor.id,
});
// receipt.success 表示平台回执匹配，不证明物理门锁状态。
```

`household-1`、`door-1` 等引用只在当前 SDK 列表有效，不是持久平台 ID。`directoryId` 每次下载变化，切房产或重新加载后旧引用应作废。SDK 拒绝 stale/foreign context、任意设备和未连接通道。同一实例业务请求并发返回 `BUSY`，不要给开门意图建立隐式重发队列。

## 对讲方法 / Intercom methods

| 调用 | 返回 | 行为 |
| --- | --- | --- |
| `prepareIntercom({ password? })` | `Promise<IntercomState>` | 从 outerTalkbackSystemUrl 获取配置；HTTP 登录 token 无法替代个人 SIP 密码。 |
| `registerIntercom()` | `Promise<IntercomState>` | 仅注册，不呼叫。默认使用官方下发主代理 UDP；保持正常 HTTPS 校验。 |
| `getIntercomState()` | `IntercomState` | 同步读取本地状态；包括后台 SIP 错误和媒体计数。 |
| `callIntercom({ configurationId, deviceId, video?, mode? })` | `IntercomState` | 启动状态立即返回；成功接听通过 onIntercomEvent 或 getIntercomState 观察，不可将返回成功当成接通。 |
| `hangupIntercom()` | `Promise<IntercomState>` | 与呼叫后台任务独立；响铃 CANCEL，接通 BYE，无自动重新呼叫。 |
| `onIntercomEvent(listener)` | `() => void` | type=state 返回 IntercomState；audio 为 8 kHz mono PCM16LE Buffer；video 为 Annex B H.264 帧及 RTP 时间戳。返回取消订阅函数。 |
| `writeIntercomAudio(pcm)` | `void` | 每包 320 字节，160 个小端 16 位采样，即 8 kHz 单声道 20 ms。最多缓存约 200 ms，未协商媒体时不发送。 |
| `closeIntercom()` | `void` | 同步清理媒体、计时器与个人配置；发送尽力挂断/注销。需确定挂断结果时先 await hangupIntercom。 |

### 监看接入 / Monitoring integration

```js
const configuration = await sdk.prepareIntercom();
await sdk.registerIntercom();
const off = sdk.onIntercomEvent((type, value) => {
  if (type === 'state') { /* 呈现状态与错误码，不记录秘密 */ }
  if (type === 'video') { /* 受控解码 value.bytes；timestamp 为 RTP 时间戳 */ }
});
// 用户选择当前配置中的设备之后：
sdk.callIntercom({ configurationId: configuration.configurationId,
  deviceId: deviceChosenByUser.id, mode: 'monitor', video: true });
// 结束时先尝试完成挂断，再释放监听和个人配置。
try { await sdk.hangupIntercom(); } finally { off(); sdk.closeIntercom(); }
```

`callIntercom()` 返回启动状态，后续通过事件/state 获取最终状态。此示例的呼叫与挂断语句代表不同用户动作，不应复制成连续自动呼叫。monitor 不收发音频。扩展 talk 必须显式使用 `mode:'talk'`，由用户授权音频输入；`writeIntercomAudio` 每帧 320 字节 PCM16LE，8 kHz mono / 20 ms。实际语音兼容性需针对设备验证。

## 登录会话保存 / Session persistence

| 调用 | 返回 | 秘密边界 |
| --- | --- | --- |
| `serializeLoginSession()` | `Uint8Array` | 包含 sessionToken、账号、设备身份和可能的账户密码；**未加密** |
| `restoreLoginSession(bytes)` | `Promise<ClientState>` | 仅在未登录实例上恢复，校验 origin/格式，再向平台查询房产验证 token |

序列化不包含当前门 WS、authcode、选门或通话；恢复后重新下载目录和个人 SIP 配置。恢复失败会清理内存登录。是否删除磁盘记录应由集成方区分明确 token 拒绝和临时网络故障后决定，SDK 不自动管理你的文件生命周期。

Windows 可选存储：

```js
import { WindowsLoginStore } from 'tyg-core-sdk/login-store';
const store = new WindowsLoginStore({ origin: sdk.origin,
  directory: privateDirectoryOwnedByCurrentUser });
const secretBytes = sdk.serializeLoginSession();
try { await store.save(secretBytes); } finally { secretBytes.fill(0); }
// 新实例上恢复：
const storedBytes = await store.load();
if (storedBytes) {
  try { await newSdk.restoreLoginSession(storedBytes); }
  finally { storedBytes.fill(0); }
}
// 用户撤销记住登录：await store.clear();
```

DPAPI 使用 Windows 当前用户，不支持 Linux/macOS/NAS，不降级为明文。`status()` 返回是否保存，`load()` 无记录返回 null，`clear()` 只删除保存记录、不注销内存会话。指定目录须由当前用户独占；存储保护不能抵御已控制该 Windows 用户的攻击者。清零 Buffer 也不能保证所有 JavaScript 字符串副本被清除。

## 错误与资源释放 / Errors and cleanup

`TygError` 有 `code`、`message`、`details`、`status`；这些是 **SDK 的错误结构，不是平台统一 JSON 格式**。原始 reason/message 可能包含敏感信息，日志仅记录允许的错误码和脱敏统计。

| 本地错误码 | 处理 |
| --- | --- |
| `NOT_INITIALIZED` / `NOT_LOGGED_IN` | 完成配置/用户登录 |
| `DEVICE_VERIFICATION_REQUIRED` / `DEVICE_VERIFICATION_INVALID` | 人工设备短信校验 |
| `CAPTCHA_EXPIRED` / `SMS_REJECTED` / `LOGIN_REJECTED` | 人工核对并遵守请求限额 |
| `HOUSEHOLD_UNAVAILABLE` / `INTERCOM_FORBIDDEN` | 尊重平台权限，不绕过 |
| `STALE_DIRECTORY` / `STALE_INTERCOM_CONFIG` | 重新读取上下文并让用户重新选择 |
| `BUSY` / `OPEN_COOLDOWN` | 等待已有操作，不排队重发 |
| `WS_NOT_CONNECTED` | 在发送新的用户意图前重新加载目录 |
| `OPEN_RESULT_UNKNOWN` | 指令可能已执行；检查现场状态，不自动重发 |
| `INTERCOM_PASSWORD_REQUIRED` | 用户从安全输入提供账户密码 |
| `SIP_TIMEOUT` / `CALL_UNAVAILABLE` / `MEDIA_UNSUPPORTED` | 核对网络、设备和协商边界 |
| `HANGUP_UNCONFIRMED` | 本地媒体已释放，现场确认对端状态 |

`logout()` 先清理本地会话，然后尽力请求平台退出；即使远程失败也应清理你的前端和存储。`close()` 只释放本地资源，不代替平台注销。`closeIntercom()` 释放个人配置与媒体，但门禁登录仍可继续使用。始终在 finally 中清理资源，不能把状态监听错误吞掉后继续显示已接通。

All tokens, session bytes, credentials, and audio/video must remain within trusted components. Neither `getState()` nor a successful call status proves a physical door or media result. See [security and integration](security.md) before exposing SDK capabilities to a web application.

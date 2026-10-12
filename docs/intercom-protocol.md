# 桃园谷对讲 XML、SIP 与媒体协议 / Intercom protocols

[平台 HTTP / WS](platform-api.md) · [SDK 参考](sdk-reference.md) · [免责声明](../DISCLAIMER.md)

本页描述平台配置与信令协议，依据公开客户端资料与独立 SDK v0.3.4 整理，客户端基线为 Android 1.3.8；不是官方发布的 API 文档。字段仅覆盖当前实现消费范围，示例均为占位值。本页没有原浏览器原型的媒体票据或本地 HTTP/WS API。

**English:** Independent, unofficial reference for platform XML provisioning, SIP signaling, and RTP media. It is based on client 1.3.8 protocol analysis and SDK v0.3.4, not an official specification. Provisioning is sent to the discovered `outerTalkbackSystemUrl`; it is not an OpenTYG REST API. Examples contain placeholders only.

## 1. 依赖与顺序 / Prerequisites and sequence

先通过 JSON 配置取得 `outerTalkbackSystemUrl`，完成账号登录，遵守 `talkForbidStatus` 的账号限制。对讲需要账户密码进行 XML 鉴权；普通 HTTP 登录 token 不可替代密码或个人 SIP 凭据。短信登录响应有时携带 Base64 账户密码，Base64 不是加密。响应缺少密码时，由用户从安全输入提供，不得获取他人密码。

```text
AuthcodeRequest
→ AuthenticationRequest（沿用 Cookie）
→ ConfigInformRequest
→ MobileDownloadConfigRequest
→ 解析个人配置及 PHONE_BOOK
→ ConfigUpdateNotifyRequest
→ SIP REGISTER / Digest
→ 用户选择设备，INVITE / SDP
→ RTP / RTCP / 可选 ICE
→ CANCEL 或 BYE，释放媒体
```

## 2. XML HTTP 传输 / XML over HTTP

所有 XML 消息都向**同一个** `outerTalkbackSystemUrl` 发送 `POST`。原客户端兼容请求头为 `Content-Type: application/x-www-form-urlencoded`，但 body 是 UTF-8 **原始 XML**；不能改成 JSON、表单键值或虚构 REST 子路径。

```http
POST <outerTalkbackSystemUrl>
Content-Type: application/x-www-form-urlencoded
Cookie: <PLATFORM_COOKIE_NAME=VALUE>

<message><msgType>AuthcodeRequest</msgType></message>
```

第一次 seed 请求可以没有 Cookie，之后收集平台 `Set-Cookie` 的 name=value 并在同一配置会话中沿用。不要复制 cookie 属性到请求头，不要将 Cookie 和个人配置返回浏览器或写日志。XML 字符串需要转义 `& < > " '`。响应有 `faultCode` 时，非字符串 `0` 视为失败；还应校验消息类型与必需字段。不要启用 XML 外部实体；此 SDK 拒绝 DOCTYPE/ENTITY 并限制 XML 到 2 MiB。

不同部署的响应 msgType 可能为 `...Response` 等平台形式，不应按 Java 反编译模型的 `Rsp` 类名推断服务返回名。下列响应表只说明消费字段，不能用占位示例代替真实结构校验。HTTPS 入口保留正常证书校验。

## 3. 五类平台 XML 消息 / Five provisioning messages

### `AuthcodeRequest`

返回一次性 `safeCode`，作为当前会话 XML 密码摘要的种子。它不是 HTTP 图形挑战 authCode，也不是门禁 authcode。

**请求元素：**

| 字段 | 类型 | 必需 | 说明 |
| --- | --- | --- | --- |
| `msgType` | string | 是 | 消息类型 固定：`AuthcodeRequest`。 |

**原始 XML 示例：**

```xml
<message><msgType>AuthcodeRequest</msgType></message>
```

**响应消费字段：**

| 字段 | 类型 | 必需 | 说明 |
| --- | --- | --- | --- |
| `msgType` | string | 条件 / 可选 | 平台响应消息类型；并非 Java Rsp 类名。 |
| `safeCode` | string | 条件 / 可选 | 官方一次性种子，保持原值，严禁记录真实值 |

### `AuthenticationRequest`

鉴权使用小写双 MD5 和冒号，与图形验证码大写摘要/下划线算法不同：

```text
inner = MD5_LOWER(accountPassword)
password = MD5_LOWER(inner + ":" + safeCode)
```

`userName` 是已授权账号，`faultCode=0` 才能继续，Cookie 必须沿用。摘要也需要作为秘密处理。

**请求元素：**

| 字段 | 类型 | 必需 | 说明 |
| --- | --- | --- | --- |
| `userName` | string | 是 | 已登录用户输入的账户 |
| `password` | string | 是 | 小写 MD5(小写 MD5(账户密码)+":"+safeCode) |
| `msgType` | string | 是 | 消息类型 固定：`AuthenticationRequest`。 |

**原始 XML 示例：**

```xml
<message><userName>ACCOUNT</userName><password>REPLACE_WITH_DIGEST</password><msgType>AuthenticationRequest</msgType></message>
```

**响应消费字段：**

| 字段 | 类型 | 必需 | 说明 |
| --- | --- | --- | --- |
| `msgType` | string | 条件 / 可选 | 平台响应消息类型；并非 Java Rsp 类名。 |
| `faultCode` | string | 条件 / 可选 | 0 成功；其他值拒绝 |
| `faultText` | string | 条件 / 可选 | 原平台说明 |
| `platformCategory` | string | 条件 / 可选 | 原平台分类，当前不改变鉴权方法 |

### `ConfigInformRequest`

初次 `configVersion=0`；`dedicatedNumber` 与 `serialNumber` 使用当前账号。`upgradeStatus` 可用于判断更新，但没有已缓存配置时，不能因为值为 0 就跳过首次下载。

**请求元素：**

| 字段 | 类型 | 必需 | 说明 |
| --- | --- | --- | --- |
| `configVersion` | string | 是 | 初次为 0；上报用返回 VERSION |
| `dedicatedNumber` | string | 是 | 与账号相同 |
| `serialNumber` | string | 是 | 与账号相同 |
| `msgType` | string | 是 | 消息类型 固定：`ConfigInformRequest`。 |

**原始 XML 示例：**

```xml
<message><configVersion>0</configVersion><dedicatedNumber>ACCOUNT</dedicatedNumber><serialNumber>ACCOUNT</serialNumber><msgType>ConfigInformRequest</msgType></message>
```

**响应消费字段：**

| 字段 | 类型 | 必需 | 说明 |
| --- | --- | --- | --- |
| `msgType` | string | 条件 / 可选 | 平台响应消息类型；并非 Java Rsp 类名。 |
| `faultCode` | string | 条件 / 可选 | 0 成功；其他值拒绝 |
| `faultText` | string | 条件 / 可选 | 原平台说明 |
| `upgradeStatus` | string | 条件 / 可选 | 1 需更新；缺少本地配置时仍需下载 |

### `MobileDownloadConfigRequest`

个人配置不是共用 SIP 账号。`SIP_PASSWORD` 是个人 SIP 秘密，与 HTTP token、账户密码、XML 摘要不同。

`PHONE_BOOK` 内的 `ENTRY` 字段在 XML 中通常以**属性**承载，例如：

```xml
<PHONE_BOOK>
  <ENTRY Code="DEVICE_CODE" ImsAccount="IMS_ACCOUNT" Cornet="SHORT_NUMBER"
    Name="示例门口机" Type="2" AreaSerial="AREA_SERIAL" AreaName="示例小区"
    LocationName="示例大厅" status="1" monitorStatus="" />
</PHONE_BOOK>
```

SDK 保留 Type 为 `2/3/4/5/6/9` 且有 Code 的设备，跳过住户分机和管理机，按 Code 去重。真正的 SIP 呼叫号码为 `ENTRY.Code`；不要使用 `ImsAccount`、`Cornet`、显示名称或开门锁通道代替。字段 `status` 是配置元数据，不能证明设备实时在线。

**请求元素：**

| 字段 | 类型 | 必需 | 说明 |
| --- | --- | --- | --- |
| `dedicatedNumber` | string | 是 | 与账号相同 |
| `msgType` | string | 是 | 消息类型 固定：`MobileDownloadConfigRequest`。 |

**原始 XML 示例：**

```xml
<message><dedicatedNumber>ACCOUNT</dedicatedNumber><msgType>MobileDownloadConfigRequest</msgType></message>
```

**响应消费字段：**

| 字段 | 类型 | 必需 | 说明 |
| --- | --- | --- | --- |
| `msgType` | string | 条件 / 可选 | 平台响应消息类型；并非 Java Rsp 类名。 |
| `VERSION` | string | 条件 / 可选 | 个人配置字段 |
| `SIP_ACCOUNT` | string | 条件 / 可选 | 个人配置字段 |
| `SIP_PASSWORD` | string | 条件 / 可选 | 个人 SIP 密码，仅本地内存使用 |
| `SIP_DOMAIN` | string | 条件 / 可选 | 个人配置字段 |
| `SIP_PROXY` | string | 条件 / 可选 | 个人配置字段 |
| `SIP_PROXY_PORT` | string | 条件 / 可选 | UDP 端口，主默认 6000、备默认 6001；当前不自动切备 |
| `SIP_BACKUP_PORT` | string | 条件 / 可选 | UDP 端口，主默认 6000、备默认 6001；当前不自动切备 |
| `PHONE_BOOK` | object | 条件 / 可选 |  |
| `PHONE_BOOK.ENTRY` | array | 条件 / 可选 |  |
| `PHONE_BOOK.ENTRY[].Code` | string | 条件 / 可选 | 真正的 SIP 呼叫号码 |
| `PHONE_BOOK.ENTRY[].ImsAccount` | string | 条件 / 可选 | 原电话簿字段，本模块不作呼叫目标 |
| `PHONE_BOOK.ENTRY[].Cornet` | string | 条件 / 可选 | 原电话簿字段，本模块不作呼叫目标 |
| `PHONE_BOOK.ENTRY[].Name` | string | 条件 / 可选 | XML ENTRY 属性元数据 |
| `PHONE_BOOK.ENTRY[].Type` | string | 条件 / 可选 | 门口机类型保留 2/3/4/5/6/9；跳过住户及管理机 |
| `PHONE_BOOK.ENTRY[].AreaSerial` | string | 条件 / 可选 | XML ENTRY 属性元数据 |
| `PHONE_BOOK.ENTRY[].AreaName` | string | 条件 / 可选 | XML ENTRY 属性元数据 |
| `PHONE_BOOK.ENTRY[].LocationName` | string | 条件 / 可选 | XML ENTRY 属性元数据 |
| `PHONE_BOOK.ENTRY[].status` | string | 条件 / 可选 | XML ENTRY 属性元数据 |
| `PHONE_BOOK.ENTRY[].monitorStatus` | string | 条件 / 可选 | XML ENTRY 属性元数据 |

### `ConfigUpdateNotifyRequest`

只有完整下载并成功解析配置后，才上报 `downloadStatus=1` 和返回的 `VERSION`。这表示配置下载成功，不表示呼叫接通或物理开门成功。

**请求元素：**

| 字段 | 类型 | 必需 | 说明 |
| --- | --- | --- | --- |
| `downloadStatus` | string | 是 | 成功解析配置后为 1 |
| `configVersion` | string | 是 | 初次为 0；上报用返回 VERSION |
| `msgType` | string | 是 | 消息类型 固定：`ConfigUpdateNotifyRequest`。 |

**原始 XML 示例：**

```xml
<message><downloadStatus>1</downloadStatus><configVersion>CONFIG_VERSION</configVersion><msgType>ConfigUpdateNotifyRequest</msgType></message>
```

**响应消费字段：**

| 字段 | 类型 | 必需 | 说明 |
| --- | --- | --- | --- |
| `msgType` | string | 条件 / 可选 | 平台响应消息类型；并非 Java Rsp 类名。 |
| `faultCode` | string | 条件 / 可选 | 0 成功；其他值拒绝 |
| `faultText` | string | 条件 / 可选 | 原平台说明 |

### 个人 SIP 配置字段 / Personal SIP configuration

| XML 字段 | 用途 |
| --- | --- |
| `VERSION` | 配置版本，上报更新结果时使用 |
| `SIP_ACCOUNT` | 完整个人 SIP 账号，用于 From/To 和 Digest username |
| `SIP_PASSWORD` | 个人 SIP 密码，仅可信运行环境使用 |
| `SIP_DOMAIN` | SIP 域与逻辑请求 URI |
| `SIP_PROXY` | 实际 UDP 主代理主机 |
| `SIP_PROXY_PORT` | 主代理端口，缺少时 SDK 默认 6000 |
| `SIP_BACKUP_PORT` | 备代理端口元数据，默认 6001；本实现不自动切换 |
| `PHONE_BOOK/ENTRY.Code` | 被叫门口机号码，须来自该账号配置 |

缺少个人必需字段或地址/端口不合法时应失败，不允许降级使用硬编码公共账号。配置下载成功不证明 SIP 或媒体连通。

## 4. SIP 注册与出呼 / Registration and calls

平台兼容实现使用 **SIP/2.0、UDP、IPv4**。域名、账号、主代理和端口来自个人配置。浏览器沙盒无法直接使用 SIP UDP，需要可信的本地/服务端协议层。本库不提供公网浏览器媒体网关。

### REGISTER 和认证

REGISTER 的 To/From 使用完整 AOR：`sip:SIP_ACCOUNT@SIP_DOMAIN`，Request-URI 为 `sip:SIP_DOMAIN`；主代理路由为 `sip:SIP_PROXY:SIP_PROXY_PORT;lr`。实现保留原客户端的 `SPSToken` 头，值为实例 UUID；它是兼容设备实例标记，不授予平台权限。

首次请求没有 Digest 认证头；收到 `401 WWW-Authenticate` 或 `407 Proxy-Authenticate` 后，根据 realm、nonce、algorithm、qop 生成相应 Authorization / Proxy-Authorization。支持 MD5、MD5-sess、qop=auth，拒绝不支持的算法。

```text
HA1 = MD5_LOWER(username + ":" + realm + ":" + SIP_PASSWORD)
HA2 = MD5_LOWER(method + ":" + actualRequestURI)
qop=auth 时 response = MD5_LOWER(HA1 + ":" + nonce + ":" + nc + ":" + cnonce + ":auth:" + HA2)
无 qop 时 response = MD5_LOWER(HA1 + ":" + nonce + ":" + HA2)
MD5-sess 时先将 HA1 替换为 MD5_LOWER(HA1 + ":" + nonce + ":" + cnonce)
```

初次注册请求 Expires=50 秒；按服务返回协商有效期并续期。处理 423 Min-Expires、Via received/rport、Contact NAT 映射及 Service-Route。通过 Call-ID、CSeq、branch 和事务匹配响应，不能只看收到任意 200 就认定注册成功。

下面是**字段模板**，不是可直接发送的完整 SIP 包：实际发送须包含合法 Via/branch、CSeq、Contact、Max-Forwards、Content-Length 和 CRLF，且认证摘要由当前挑战计算。

```text
REGISTER sip:SIP_DOMAIN SIP/2.0
Via: SIP/2.0/UDP LOCAL_IP:LOCAL_PORT;branch=TRANSACTION_BRANCH;rport
From: <sip:SIP_ACCOUNT@SIP_DOMAIN>;tag=LOCAL_TAG
To: <sip:SIP_ACCOUNT@SIP_DOMAIN>
Call-ID: CALL_ID
CSeq: 1 REGISTER
Contact: <sip:SIP_ACCOUNT@LOCAL_IP:LOCAL_PORT>
Route: <sip:SIP_PROXY:SIP_PROXY_PORT;lr>
Max-Forwards: 70
Expires: 50
SPSToken: INSTANCE_UUID
Content-Length: 0
```

### 呼叫与状态

| 消息 / 状态 | 协议用途 |
| --- | --- |
| `INVITE sip:ENTRY.Code@SIP_DOMAIN` + SDP | 对当前个人配置中的设备出呼 |
| `100` / `180` | 处理 / 响铃，尚未接通 |
| `183` + SDP | 可能开始早期媒体，不等于最终接听 |
| `401` / `407` | 当前事务的 Digest 挑战，按 SIP 规则 ACK 与鉴权 |
| `200` + SDP、`ACK` | 接听并完成对话，仍需验证媒体 |
| `CANCEL`、原 INVITE `487`、`ACK` | 取消未接听呼叫 |
| `re-INVITE` / `UPDATE` + SDP | 对话内方向、媒体、ICE 重协商 |
| `BYE` / `200` | 已接通后挂断；远端 BYE 自动释放媒体 |
| `486` / `480` 等 | 忙或不可用，按响应失败，不自动再次出呼 |

UDP 丢包重传属于同一事务，沿用 Call-ID/branch；不能当作再次用户呼叫。每个 SDK 实例只有一个并发出呼。默认未接听约 60 秒请求取消；后续状态通过事件读取，方法返回启动状态不等于接通。SIP 注册成功和接听回执分别只证明信令阶段成功。

## 5. SDP、RTP 与 RTCP / Media

SDK 提供 `monitor` 和 `talk` 两种模式。监看需要视频，音频固定 inactive，不启用麦克风、不收发音频。扩展 talk 模式使用 G.711；真实双向语音是否可用仍依赖平台、设备和网络。

| 媒体 | 格式与处理 |
| --- | --- |
| 音频 RTP | PCMA payload 8 / PCMU payload 0，8 kHz 单声道；实际以 SDP 协商为准 |
| SDK 音频输入/输出 | PCM16LE，20 ms、160 个采样、320 字节；不是 WAV/MP3 |
| 视频 RTP | H.264，offer payload 99 / 90 kHz；单 NAL、STAP-A、FU-A，接收端等待 IDR 恢复丢包 |
| SDK 视频事件 | Annex B H.264 字节、RTP 时间戳与关键帧标记；由集成方解码显示 |
| RTCP | SR/RR、SDES 和 PLI；根据 rtcp-mux 或 SDP RTCP 端口处理 |

兼容 offer 中 `s=horimedia`，音频 `ptime:20`，H.264 `packetization-mode=1;profile-level-id=42E01E`。默认 APK bridge 的视频方向广告 `sendrecv` 以兼容原客户端，但 SDK 不发送摄像头画面；standard 模式可使用 `recvonly`。下例仅展示 monitor offer 的核心字段，完整 SDP 应包含有效 o/c/t、端口和可协商参数：

```text
v=0
o=- SESSION_ID SESSION_VERSION IN IP4 LOCAL_IP
s=horimedia
c=IN IP4 LOCAL_IP
t=0 0
m=audio AUDIO_PORT RTP/AVP 8 0
a=rtcp:AUDIO_RTCP_PORT IN IP4 LOCAL_IP
a=rtcp-mux
a=rtpmap:8 PCMA/8000
a=rtpmap:0 PCMU/8000
a=inactive
a=ptime:20
m=video VIDEO_PORT RTP/AVP 99
a=rtcp:VIDEO_RTCP_PORT IN IP4 LOCAL_IP
a=rtcp-mux
a=rtpmap:99 H264/90000
a=fmtp:99 packetization-mode=1;profile-level-id=42E01E
a=rtcp-fb:99 nack pli
a=sendrecv
```

媒体方向从远端 SDP 读取；不要把远端 sendonly 误当本机发送许可。端点限定在协商地址和端口，不接受浏览器指定任意 UDP 目的地。调试应观察脱敏包数、首帧时间和媒体状态，不能保存住户音视频或完整含凭据的 SDP。

## 6. ICE、STUN、TURN 与网络 / NAT traversal

ICE 只有在真实远端 SDP 包含凭据、候选且协商正确时才成立。普通 STUN Binding 探测不等于通过 ICE 认证检查、提名或媒体连通。ICE username fragment/password 不是 SIP 密码，不能相互替代。组件号、rtcp-mux 与 RTP/RTCP 候选需一致。

SDK 不预设公共 STUN/TURN；需要时由集成方显式提供自己有权使用的服务和短期凭据。跨 NAT 的 SDP 私网地址可能不可达，Docker/NAS 的 UDP 路由和防火墙也须单独配置。网页 HTTPS 反向代理只负责浏览器 HTTP/WSS，不会自动代理 SIP/RTP UDP。不要因信令成功就保证视频或声音。

当系统 DNS 返回 198.18/198.19 Fake-IP 时，v0.3.4 的 SIP 解析会尝试 `https://dns.alidns.com/resolve`，再尝试 `https://dns.google/resolve`；查询会发送 SIP 代理域名给该解析服务。普通解析不触发此回退。该行为应纳入你的网络和隐私评估；本 SDK 不修改用户 TUN 配置，必要时由集成方调整解析策略。

## 7. 当前实现边界 / Implementation limits

支持一个 UDP/IPv4 出呼、监看、G.711、H.264 接收、早期媒体、RTCP、显式 ICE 和带 SDP 的对话内重新协商。不支持 TCP/TLS SIP、SRTP、来电接听、备代理自动切换、无 SDP re-INVITE 或主动 Session-Timer 刷新。不能将开发验证的扩展 talk 模式描述为所有门口机已验收的语音服务。

Integrators must independently verify device compatibility and media reachability. A registered SIP account or accepted call does not prove successful audio/video. The SDK offers UDP/IPv4 outbound calls only, and browser HTTP reverse proxies do not transport SIP/RTP UDP. Do not expose credentials or arbitrary call targets to untrusted clients.

标准协议背景：[SIP RFC 3261](https://www.rfc-editor.org/info/rfc3261/)、[ICE RFC 8445](https://www.rfc-editor.org/info/rfc8445/)。这些标准说明通用协议，不是桃园谷专有接口的官方说明或兼容承诺。

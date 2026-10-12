# 安全与集成 / Security and integration

[免责声明](../DISCLAIMER.md) · [平台 API](platform-api.md) · [SDK 参考](sdk-reference.md)

本 SDK 是底层协议库，不是带完整账号保护的公网后端。应用集成方负责自己的认证、权限、输入校验、主机限制、限流、存储、日志脱敏和用户操作确认。

## 凭据 / Credentials

账号密码、短信码、图形挑战、sessionToken、householdToken、authcode、Cookie、个人 SIP 密码、ICE/TURN 凭据都是秘密。登录响应可能包含 Base64 账户密码；Base64 不是加密。SDK 可在内存中保留密码供对讲使用，且 `serializeLoginSession()` 包含秘密。序列化并不加密，只有交给可信加密存储后才可持久化。

不得将完整响应、带 token 的 URL、个人配置、原始 SDP 或序列化字节返回浏览器、写日志或提交仓库。默认 SDK 凭据掩码不等于删除原内存秘密；`getCredentials({includeSecrets:true})` 只用于可信后端。WindowsLoginStore 为当前用户 DPAPI；其他系统须自行实现加密与密钥生命周期。禁止退化为明文文件或 localStorage。

## 网络 / Network

默认 origin 兼容 HTTP，门禁可能使用 WS；公网 HTTPS 不能加密服务器到上游的明文通信。SIP Digest 不等于信令或 RTP 加密；当前 SIP UDP / RTP 不支持 TLS/SRTP。不要宣传为全链路端到端加密。

独立 v0.3.4 SDK 根据配置返回的 HTTP/WS 主机和 SIP/SDP 地址通信，没有 main 网页服务的完整主机白名单和稳定门 ID 改造。将 origin、服务配置、图片 URL、SIP 代理及媒体目的地视为网络信任边界：限定预期主机/地址、协议和端口，禁止 URL userinfo，控制重定向，并设置出站防火墙。`fetchImpl` 可控制 HTTP，但不覆盖原生 WebSocket、DNS 或 UDP；仍需网络层限制。不要把浏览器任意 URL 传给 SDK。

系统 DNS 返回 Fake-IP 时，SIP 解析可能将代理域名发送给 AliDNS/Google 的 HTTPS DNS 服务，见 [对讲网络说明](intercom-protocol.md)。STUN/TURN 只能使用有权使用的服务，凭据避免长期硬编码，媒体用户授权单独处理。

## 用户与物理操作 / Users and physical operations

一个实例对应一个账号，用户必须绑定自己的实例和当前房产上下文。用户可选择的设备只能来自其当前授权配置。SDK 本地序号不是持久 ID，不能用序号替代稳定业务标识来跨目录映射设备。

SDK 的 3 秒操作间隔和 60 秒短信提示不等于账号级限流。集成方需要对手机号短信、账号密码错误、IP/会话请求量建立持久策略，并遵守平台限制。不得批量猜测密码、骚扰发送验证码或规避设备验证。

开门消息发送后断连/超时为结果未知，不能自动重发；等待用户核对物理门状态。SIP 注册/接听只是信令结果，音视频和远端挂断仍需验证。收音、监看、保存或传播音视频须取得所需授权，并保护住户隐私。

## 公网应用 / Public applications

浏览器连接必须使用 HTTPS，应用自己实现安全 Cookie、CSRF/Origin/Host 校验、会话撤销、权限检查、输出转义、请求大小限制和账号隔离。不要直接把 SDK 的秘密返回结构作为公共 API。生产加密存储应可备份与恢复，并防止多个进程无锁读写；本 SDK 不提供分布式持久化。对接更完整的网页部署可参考 main，但不能用本分支直接覆盖其安全适配层。

## English

This library is not a complete public backend. Integrators are responsible for application authentication, authorization, rate limits, validation, logging, persistence, and explicit user actions. Tokens, passwords, XML cookies, SIP/ICE/TURN credentials, and session bytes must remain in trusted components. `serializeLoginSession()` contains plaintext secrets until your store encrypts them; Base64 in platform responses is not encryption. Windows DPAPI is optional and does not provide Linux/NAS storage.

Default HTTP/WS upstream compatibility and SIP/RTP UDP are not end-to-end encryption. Never disable TLS verification. Apply host, protocol, port, redirect, and outbound network restrictions to service discovery, captcha URLs, WebSocket hosts, SIP proxies, and SDP/media destinations. A custom `fetchImpl` covers HTTP only, not native WebSocket, DNS, or UDP. Fake-IP SIP resolution can query AliDNS/Google HTTPS DNS services. Use authorized STUN/TURN services and user-approved media inputs only.

Provide persistent SMS/password limits, browser sessions, secure cookies, CSRF/Origin/Host checks, account isolation, and permission validation. Device references must come from the user's current configuration. Never retry a door command automatically after a lost acknowledgment. A SIP registration/call acknowledgment does not prove usable media or a physical lock state. Follow platform terms, property rules, privacy requirements, and applicable laws; see the disclaimer.

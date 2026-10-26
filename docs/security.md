# 隐私与运维 / Privacy and operations

[中文 README](../README.md) · [English README](../README.en.md) · [安全报告 / Security reporting](../SECURITY.md)

## 凭据生命周期 / Credential lifecycle

- 密码和短信码通过同源登录请求交给后端，按官方协议送往上游。应用不把登录密码写入日志、偏好或记住登录文件；未使用的对讲密码保留功能关闭。
- 浏览器仅持有本服务的签名随机会话 Cookie，属性为 `HttpOnly`、`Secure`、`SameSite=Strict`。浏览器不接收上游登录 token、开门 authcode 或房产 token。已授权用户仍可看到自己的名称、脱敏账号及房产信息。
- 未勾选“记住登录”的浏览器会话最多 12 小时，服务重启后不恢复。勾选后最长 30 天绝对期限，并将恢复所需的上游登录状态加密保存；平台仍可能更早使其失效。若同账号已有其他被记住的会话，其恢复凭据可以继续保留。
- 退出登录撤销此账号在本服务上的所有浏览器会话，删除其保存的登录凭据；收藏、排序和名称仍保留。过期且不再被记住的登录凭据由定期清理移除。偏好没有自动到期清理，管理员应制定保留与删除策略。

Passwords and SMS codes are submitted through same-origin login requests and forwarded using the platform protocol. The app does not write login passwords to logs, preferences, or remembered login files; unused intercom password retention is disabled. The browser holds only this service's signed random session cookie, with `HttpOnly`, `Secure`, and `SameSite=Strict`. Upstream login tokens, door authcodes, and property tokens are not returned to it; authorized users still see their own names, masked accounts, and property details.

Browser-only sessions last at most 12 hours and do not survive server restart. Remembered sessions have a 30-day absolute limit and persist the encrypted upstream state needed for restoration; the platform can invalidate them sooner. Restoration credentials may remain if another browser for the same account has a remembered session. Logout revokes all browser sessions for that account and removes saved login credentials while retaining preferences. Expired credentials without a remembered session are pruned periodically. Preferences have no automatic expiry; operators should define retention and deletion policies.

## 磁盘数据 / Data on disk

| 文件 / File | 内容与保护 / Contents and protection |
| --- | --- |
| `secrets/opentyg_secret.txt` | 外部随机秘密，主机明文文件，以权限限制访问；必须独立保护 / External random secret, plaintext on the host with restricted permissions; protect separately |
| `data/.app-secret` | 随机数据密钥，由外部秘密封装 / Random data key wrapped by the external secret |
| `data/users/*.blob` | 被记住的登录恢复数据，AES-256-GCM 加密 / Remembered login restoration data, encrypted with AES-256-GCM |
| `data/prefs/*.prefs`、`*.prefs.bak` | 用户/房产偏好及上一份写入前备份，均加密 / Encrypted user/property preferences and previous-write backups |
| `data/sessions.json` | 仅被记住的会话记录，加密 / Encrypted remembered browser session records |
| `data/auth-limits.json` | 加密认证限流，账号标识为用途绑定 HMAC，不保存密码 / Encrypted authentication limits using purpose-bound account HMACs, without passwords |

加密文件使用随机 IV、认证标签和用途绑定上下文。文件名中的用户 ID 由外部秘密与账号通过 HMAC 派生。凭据、偏好、会话和业务限流共用随机数据密钥；外部秘密还用于标识派生及 Cookie 签名。

Encrypted files use random IVs, authentication tags, and purpose-bound context. User IDs in filenames are HMAC-derived from the external secret and account. Credentials, preferences, sessions, and business limits share the random data key; the external secret also derives identifiers and signs cookies.

加密主要保护泄露的数据目录副本。如果攻击者同时取得密钥、主机管理员权限或运行进程控制权，加密不能继续保护数据。普通 Compose secrets 是文件挂载，不是主机端密钥保险库；TLS 证书私钥也应由代理环境独立管理。

Encryption primarily protects a leaked copy of the data directory. It cannot protect against an attacker who also obtains the key material, host administrator access, or control of the running process. Ordinary Compose secrets are file mounts, not a host-side key vault. Manage TLS private keys separately in the proxy environment.

## 写入可靠性 / Write reliability

存储先写临时文件并同步，再原子替换目标，POSIX 环境还同步父目录；新私有文件权限为 `0600`。偏好覆盖前保留上一份加密备份。载入失败、缺失数据密钥或认证限流写入失败会报错，不静默生成新密钥或清空限流。

Writes use a synced temporary file followed by atomic replacement, plus parent-directory syncing on POSIX. New private files use `0600`. Preference writes retain the previous encrypted version. Load failures, missing data keys, and authentication-limit write failures are surfaced rather than silently regenerating keys or resetting limits.

这些措施不替代备份，也不能保证故障磁盘或所有网络文件系统的持久性。使用可靠的本地文件系统，避免共享数据目录，限制为单实例；备份恢复步骤见 [中文部署指南](deployment.md) / [English deployment guide](deployment.en.md)。

These measures do not replace backups or guarantee durability on failing disks or every network filesystem. Use reliable local storage, keep the data directory exclusive, and run one instance. Follow the linked deployment guides for backup and recovery.

## 认证限流 / Authentication limits

短信按手机号跨浏览器共享滚动窗口：1 小时最多 3 次，12 小时最多 12 次；成功和结果不确定的发送尝试计入，明确未发送的拒绝可退还计数。10 分钟内第 4 次密码错误开始锁定账号 1 小时，密码和短信新登录均受限；设备验证与网络失败不作为密码错误计数。限流持久化，重启仍生效，不注销已登录会话。

SMS attempts share rolling per-phone limits across browsers: at most three in one hour and twelve in twelve hours. Successful and uncertain sends count; definite non-send rejections can release a reservation. The fourth password failure within ten minutes locks new password and SMS logins for one hour. Device verification and network failures do not count as incorrect passwords. Limits persist across restarts and do not revoke existing signed-in sessions.

反向代理后，额外的短窗口网络限流可能按代理来源共享；业务手机号/账号限流仍独立。大量账号攻击与代理层限流需要按实际规模设计，应用不是通用身份认证平台。

Behind a reverse proxy, additional short-window network limits may be shared by requests from that proxy; business phone/account limits remain separate. Design ingress protection for your expected scale. This application is not a general-purpose identity platform.

## 网络与上线检查 / Network and launch checks

生产保持固定 HTTPS `PUBLIC_ORIGIN`、Secure Cookie、精确 Host/Origin 校验、请求标记和当前目录校验。内部 HTTP 仅限回环或受控内网。默认上游 HTTP/WS 兼容意味着后端到平台的流量未加密，可能暴露登录与门禁凭据；浏览器 HTTPS 无法改变此事实。允许名单限制目标主机，但不提供传输加密。上游可用 HTTPS/WSS 时应验证兼容性再关闭 HTTP。

Production keeps a fixed HTTPS `PUBLIC_ORIGIN`, Secure cookies, exact Host/Origin checks, request markers, and current directory validation. Restrict internal HTTP to loopback or a controlled private network. Default upstream HTTP/WS compatibility leaves backend-to-platform traffic unencrypted and can expose login and door credentials; browser HTTPS does not change this. The host allowlist restricts destinations but does not encrypt transport. Verify a working HTTPS/WSS upstream before disabling HTTP.

直接打开其他 Host 的根地址时，仅为 GET/HEAD HTML 导航返回固定 HTTPS 入口的 303 跳转，不提供应用页面、Cookie 或私有数据，不携带原查询参数。此例外不适用于 API、静态资源和写请求；代理仍须保留正确的 Host。

An HTML GET/HEAD navigation to the root on another Host receives only a 303 to the fixed HTTPS entry point, without an application page, cookie, private data, or the original query string. APIs, assets, and mutations retain their checks; proxies must still preserve the correct Host.

上线前检查：域名与证书、代理保留端口和 Origin、内部端口隔离、文件所有者与权限、完整密钥备份、单实例运行、实际账号与门锁权限。关闭代理/CDN 私有响应缓存；避免请求体和凭据日志。日志默认留在标准输出并由 Docker 轮转，分享前仍要检查内容。项目不包含外部分析服务；部署时自行加入的监控、CDN、备份和日志服务也需审查数据去向。

Before launch, check the domain and certificate, preserved ports and Origin, internal-port isolation, filesystem permissions, complete key backups, single-instance operation, and actual account/lock permissions. Disable private-response caching and avoid credential or body logging. Runtime logs go to stdout and are rotated by Docker; review them before sharing. No external analytics service is included. Assess data handling in any monitoring, CDN, backup, or logging service you add.

本项目没有经过正式认证或渗透测试的承诺，不能证明不存在所有缺陷。安全问题按 [SECURITY.md](../SECURITY.md) 报告；不要在公开 Issue 提交真实凭据或住户信息。

The project makes no claim of formal certification or a completed penetration test and cannot establish the absence of every defect. Follow [SECURITY.md](../SECURITY.md) for reports; never post real credentials or resident data in public issues.

## 内存缓存与快速恢复 / In-memory retention and fast recovery

登录状态和服务配置在单进程中有界缓存，约 24 小时闲置、最多 200 个账号；30 分钟闲置后释放 WebSocket。本地会话过期立即拒绝访问，定期回收时删除对应登录缓存；退出登录直接清理。内存驻留时间比旧版长；主机或进程被控制时不提供额外保密保证。记住登录和浏览器 Cookie 的绝对期限不变，不向客户端缓存平台凭据。

The login/configuration cache is bounded to 200 accounts and 24 idle hours, with earlier LRU removal. Sockets are released after 30 idle minutes, and expired/revoked local sessions cannot retain login authority. This increases credential residency in server RAM compared with the older eviction policy; it does not protect a compromised host/process or extend cookie lifetimes.

房产权验证最长复用约 60 秒；久置、断线恢复或验证过期时，先向平台重新查询权限，再获取新的门禁鉴权和配置。首页可显示当前 Cookie 所属用户的旧收藏视图，但显示缓存不作为开门权限。展示读取可使用已解密且有界的内存偏好缓存，写入和常规存储校验仍走原文件路径；所有写入都会更新缓存。外部手动替换数据文件后应重启服务，不支持多个写入进程。

Household permission verification is reused for at most approximately 60 seconds. Reconnects after idle suspension re-query current permissions before any command. Cached favorites are presentation only. Presentation reads may use the bounded authenticated preference cache; mutations and normal file checks retain their original persistence path, and writes refresh the cache. Restart after manually replacing data files; multiple writers remain unsupported.

自动重试仅覆盖网络准备和能够确认尚未入队的失败。协议没有供本实现使用的幂等请求编号，开门指令一旦可能发出，不能用“没有回执”推断“没有开门”。此时返回结果未知，由用户核实现场；不会为缩短界面等待而发送第二、第三条开门指令。

Retries apply only to preparation and proven pre-queue failures. The integrated protocol provides no usable idempotency key, so a lost acknowledgment cannot prove the door command was not applied. Possibly sent commands remain unknown and are never silently replayed.

# 安全问题 / Security concerns

## 报告流程 / Reporting

请勿在公开 Issue、Pull Request 或讨论中发布真实账号、密码、验证码、Cookie、token、authcode、密钥、住户地址，或可直接利用的漏洞细节。

如仓库 Security 页提供 **Report a vulnerability**，请使用 GitHub 私密漏洞报告。若该入口不可用，可创建仅请求私密联系方式的普通 Issue，不附漏洞细节或凭据；等待维护者提供私密沟通方式。本项目未指定公共安全邮箱，也不承诺固定响应时限。

Do not publish real accounts, passwords, verification codes, cookies, tokens, authcodes, keys, resident addresses, or exploitable details in public issues, Pull Requests, or discussions.

If the repository's Security page offers **Report a vulnerability**, use GitHub's private reporting feature. If unavailable, open an issue requesting a private contact channel without technical details or credentials, and wait for the maintainer's instructions. No public security email or fixed response deadline is specified.

在私密报告中提供代码提交、部署模式、影响、最小复现步骤和脱敏证据。只在你拥有或获得授权的部署与账号上验证，避免触发真实门锁、短信滥用或影响其他住户。

Privately include the code commit, deployment mode, impact, minimal reproduction, and sanitized evidence. Validate only on deployments and accounts you own or are authorized to assess. Avoid physical door actions, SMS abuse, or disruption to other residents.

## 范围与维护 / Scope and maintenance

关注账号隔离、权限校验、会话与凭据保护、CSRF、目录身份、开门重复发送、存储完整性及公开部署入口。平台服务、门锁固件、网络运营商或第三方代理本身的问题应同时向对应维护方报告。

Relevant areas include account isolation, authorization, sessions and credentials, CSRF, directory identity, duplicate door commands, storage integrity, and public ingress. Report platform, lock firmware, carrier, or third-party proxy vulnerabilities to their respective maintainers as well.

维护重点为 `main` 当前版本，不承诺旧版本安全回补。默认 HTTP/WS 上游的传输边界已在 [隐私与运维](docs/security.md) 中说明；发现超出该已知边界的实际漏洞仍欢迎报告。项目未承诺无漏洞、合规认证或安全 SLA。

Maintenance focuses on the current `main` branch, without promised backports to older versions. The default HTTP/WS upstream boundary is documented in [privacy and operations](docs/security.md); reports of vulnerabilities beyond that known boundary are welcome. No vulnerability-free guarantee, compliance certification, or security SLA is offered.

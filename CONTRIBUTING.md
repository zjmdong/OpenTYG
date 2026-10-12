# 贡献指南 / Contributing

本分支维护独立 SDK 和平台协议参考。修改网页应用请向 main 提交；SDK 贡献请以 `opentyg-sdk` 为目标分支。

先描述问题与兼容基线。新增平台字段应附脱敏结构、字段来源及消费用途，明确哪些是平台原始字段、哪些是 SDK 归一化字段。不要把本地原型路由或未经验证的猜测写成官方接口。更改函数签名时同步 `.d.ts`、SDK 文档与示例。

在 Node.js 22.4+ 的受控环境中安装锁定依赖，检查源码语法、类型与公开示例，使用自己的离线协议模拟进行回归。不得通过公开 CI 使用真实账号、短信或门禁，也不得提交真实日志、手机号、住址、token、密码、个人 SIP 配置、音视频、官方 APK 或反编译文件。测试资料留在私有验证环境，公开提交提供脱敏验证结论。

保留原始第三方许可证及来源信息，阅读 [免责声明](DISCLAIMER.md)。安全问题按照 [SECURITY.md](SECURITY.md) 私密报告。

## English

This branch maintains the standalone SDK and platform references. Target `opentyg-sdk` for SDK changes and main for application changes. Explain the issue and compatibility baseline. Document new protocol fields with sanitized structures, provenance, and consumption behavior; distinguish platform fields from normalized SDK models. Do not label prototype routes or guesses as official APIs. Update declarations, documentation, and examples with signature changes.

Use locked dependencies and private offline protocol fixtures for regression validation. Do not use real accounts, SMS, doors, or media in public CI. Never commit real logs, phone numbers, addresses, secrets, personal SIP configurations, media, official APKs, or decompiled files. Preserve dependency licenses, follow the disclaimer, and report vulnerabilities privately through SECURITY.md.

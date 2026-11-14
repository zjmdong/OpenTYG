# 贡献指南 / Contributing

[项目首页](README.md) · [文档](docs/README.md) · [English](#english)

本分支维护独立 SDK 和平台协议参考。修改网页应用请向 main 提交；SDK 贡献请以 `opentyg-sdk` 为目标分支。

## 修改范围

先描述问题与兼容基线。新增平台字段应附脱敏结构、字段来源及消费用途，明确哪些是平台原始字段、哪些是 SDK 归一化字段。不要把本地原型路由或未经验证的猜测写成官方接口。更改函数签名时同步 `.d.ts`、SDK 文档与示例。

## 验证与提交

在 Node.js 22.4+ 的受控环境中安装锁定依赖，检查源码语法、类型与公开示例，使用自己的离线协议模拟进行回归。不得通过公开 CI 使用真实账号、短信或门禁，也不得提交真实日志、手机号、住址、token、密码、个人 SIP 配置、音视频、官方 APK 或反编译文件。测试资料留在私有验证环境，公开提交提供脱敏验证结论。

文档修改需检查相对链接、图表渲染和中英文说明。核心源码的原始哈希见 [源码清单](docs/source-manifest.json)；不要因排版调整改动协议实现。

保留原始第三方许可证及来源信息，阅读 [免责声明](DISCLAIMER.md)。安全问题按照 [SECURITY.md](SECURITY.md) 私密报告。

## English

This branch maintains the standalone SDK and platform references. Target `opentyg-sdk` for SDK changes and main for application changes. Explain the issue and compatibility baseline. Document new protocol fields with sanitized structures, provenance, and consumption behavior; distinguish platform fields from normalized SDK models. Do not label prototype routes or guesses as official APIs. Update declarations, documentation, and examples with signature changes.

Use locked dependencies and private offline protocol fixtures for regression validation. Do not use real accounts, SMS, doors, or media in public CI. Never commit real logs, phone numbers, addresses, secrets, personal SIP configurations, media, official APKs, or decompiled files. For documentation changes, check links, diagrams, and both language versions. Do not alter protocol code as part of formatting. Preserve dependency licenses, follow the disclaimer, and report vulnerabilities privately through SECURITY.md.

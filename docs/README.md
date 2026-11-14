# OpenTYG 文档

[项目首页](../README.md) · [English](README.en.md)

第一次使用，从部署指南开始；已经在运行，直接看升级、备份和排障。

## 部署与使用

- **[部署指南](deployment.md)** — 安装向导、HTTPS 反代、手机安装、升级与故障处理。
- **[配置参考](configuration.md)** — Compose 模板、环境变量、密钥及本机开发。
- **[隐私与运维](security.md)** — 登录有效期、存储内容、加密边界、限流与备份。

## 开发与贡献

- **[架构说明](architecture.md)** — 数据流、源码职责、SDK 关系与连接恢复。
- **[后端 API](api.md)** — 本应用的会话、房产、目录、开门请求与错误约定。
- **[贡献指南](../CONTRIBUTING.md)** — 本机启动、提交前验证和问题反馈。

## 网页应用还是独立 SDK？

| 项目 | 适合谁 | 接口范围 |
| --- | --- | --- |
| 当前 `main` 分支 | 部署网页客户端、修改 UI 或后端 | 同源 `/api/*`，浏览器 Cookie 会话 |
| [`opentyg-sdk` 分支](https://github.com/zjmdong/OpenTYG/tree/opentyg-sdk) | 开发自己的客户端、研究平台协议 | 平台 HTTP、WebSocket、XML、SIP / RTP |

网页应用内嵌经过适配的 SDK，包含主机限制、稳定门禁标识和凭据处理调整，与独立分支并非完全相同。网页目前只提供门禁功能；独立 SDK 的对讲能力不代表网页已支持对讲。平台协议详见 [SDK 平台接口参考](https://github.com/zjmdong/OpenTYG/blob/opentyg-sdk/docs/platform-api.md)。

[安全问题报告](../SECURITY.md) · [免责声明](../DISCLAIMER.md) · [MIT 许可证](../LICENSE)

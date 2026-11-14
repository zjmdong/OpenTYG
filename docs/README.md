# TYG Core SDK 文档

[项目首页](../README.md) · [English](README.en.md)

想调用 SDK，从使用参考开始；想自己实现协议，直接看平台参考。

## 先理解，再接入

- **[架构说明](architecture.md)** — 模块、状态、传输边界及与 main 的区别。
- **[How it works](how-it-works.md)** — 门禁时序、对讲流程、登录保存与恢复。
- **[SDK 使用参考](sdk-reference.md)** — 构造参数、方法、事件、错误与释放。
- **[只读示例](../examples/list-doors.mjs)** — 查询授权门禁数量，不发短信、不执行开门。

## 平台协议

| 协议 | 内容 |
| --- | --- |
| [HTTP / WebSocket](platform-api.md) | 动态服务、三层凭据、10 个 JSON POST 路径、目录和开门消息 |
| [OpenAPI 3.1](platform-openapi.json) | 可导入工具的 HTTP 字段描述；不覆盖 WS、XML、SIP/RTP |
| [XML / SIP / RTP](intercom-protocol.md) | 五类 XML 配置消息、注册与出呼、音视频和 NAT 穿透 |

协议资料为独立整理，基线是 Android 客户端 1.3.8 与 SDK v0.3.4。平台原始字段、SDK 返回类型与网页应用 API 是不同层次，不应混用。

## 集成与维护

- [安全与集成](security.md)：凭据、限流、网络出口、媒体授权与存储责任。
- [贡献指南](../CONTRIBUTING.md)：以 `opentyg-sdk` 为目标分支，说明协议依据与验证方式。
- [来源与授权边界](provenance.md)：版本基线、源码哈希与发布范围。
- [第三方许可](../THIRD_PARTY_NOTICES.md) · [免责声明](../DISCLAIMER.md) · [安全报告](../SECURITY.md)。

需要可部署的网页客户端？查看 [main 分支](https://github.com/zjmdong/OpenTYG/tree/main)。不要直接互换两个分支的 SDK 源码。

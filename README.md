<div align="center">
  <h1>TYG Core SDK</h1>
  <p>桃园谷平台的非官方 Node.js 协议适配 SDK · 门禁与对讲开发参考</p>
  <p><a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT"></a> <img src="https://img.shields.io/badge/SDK-0.3.4-blue" alt="SDK 0.3.4"> <img src="https://img.shields.io/badge/Node.js-22.4%2B-339933" alt="Node.js 22.4 or newer"></p>
  <p><strong>简体中文</strong> · <a href="README.en.md">English</a></p>
</div>

本分支发布 TYG Core SDK **v0.3.4**，这是本项目当前整理的最新独立 SDK 版本，不表示桃园谷官方 SDK 或平台的版本。它提供服务发现、验证码与登录、房产鉴权、WebSocket 门禁，以及 XML 配置、SIP 信令和 RTP 媒体适配，供开发者在有效授权范围内开发自己的客户端。协议整理基线为桃园谷 Android 客户端 1.3.8；服务端行为和设备兼容性可能变化。

**本 SDK 及文档与桃园谷官方及其关联方无任何隶属、合作或授权关系，未获得官方认可，也不由官方提供技术支持。** 协议资料依据公开渠道可获取的客户端及相关资料整理，代码为独立适配实现；仓库不包含官方 APK、反编译源码、原生二进制库或真实用户凭据。公开可获取不等于服务调用或再分发授权。请负责任地使用，仅操作本人或已获明确授权的账号与设备；用户的行为及其后果由用户自行承担，与作者无关。在适用法律允许的范围内，作者及贡献者不承担因使用或滥用产生的责任。详见 [免责声明](DISCLAIMER.md) 和 [来源与授权边界](docs/provenance.md)。

## 先读平台接口文档

本分支的重点是**桃园谷平台实际使用的接口与协议**，方便不使用本 SDK 的开发者按协议实现自己的客户端。以下文档由本项目独立整理，**不是官方编写、发布或承诺稳定的开发者文档**。

| 文档 | 内容 |
| --- | --- |
| [平台 HTTP 与 WebSocket API](docs/platform-api.md) | 10 个 JSON POST 接口、动态服务地址、三层凭据、字段、回执、门目录及开门消息 |
| [HTTP OpenAPI 3.1](docs/platform-openapi.json) | 仅包含平台的 10 个 JSON HTTP 路径，可导入支持 OpenAPI 3.1 的工具 |
| [平台 XML / SIP / RTP / ICE 协议](docs/intercom-protocol.md) | 5 类 XML 消息、个人 SIP 配置、注册、出呼、媒体与实现边界 |
| [SDK 使用参考](docs/sdk-reference.md) | `TygClient` 方法、返回类型、会话保存及错误处理 |
| [安全与集成](docs/security.md) | 凭据、HTTP 明文边界、主机限制、限流、操作幂等与部署职责 |
| [来源说明](docs/provenance.md) / [第三方许可](THIRD_PARTY_NOTICES.md) | 资料来源边界、版本和依赖许可证 |

这些平台接口没有 `/api/clients/...`、`X-Local-Key` 或 OpenTYG 浏览器会话 Cookie。XML、WebSocket 和 SIP/RTP 无法完整表示为 HTTP OpenAPI，因此单独记录协议。平台的成功码并不统一：例如短信发送成功是 `code=1`，登录成功是 `code=0`。

## 能力与边界

- **门禁**：服务发现、人工图形验证、短信或密码登录、设备变更验证、房产权查询、门目录下载和单次开门请求。
- **对讲**：个人 XML 配置、UDP/IPv4 SIP、Digest 鉴权、主动监看、G.711 音频、H.264 接收、RTCP、SDP 重协商及显式配置的 ICE/STUN/TURN。
- **开发接口**：ES modules、TypeScript 类型声明、状态与媒体事件，以及可选的 Windows DPAPI 登录存储。
- **限制**：Node.js SDK；浏览器不能直接使用其中的 SIP UDP 模块。仅一个并发出呼；不支持来电接听、TCP/TLS SIP、SRTP、备代理自动切换或主动 Session-Timer 刷新。语音扩展和 NAT 穿透依赖平台、设备与网络，不保证所有设备可用。

## 安装

需要 Node.js 22.4 或更新版本，建议使用 Node.js 24。此版本通过 Git 分支分发，未发布到 npm 注册表。

```sh
git clone --branch opentyg-sdk --single-branch https://github.com/zjmdong/OpenTYG.git OpenTYG-SDK
cd OpenTYG-SDK
npm ci --ignore-scripts
```

在其他 Node.js 项目中，可先检出上述目录，再安装本地包：

```sh
npm install --ignore-scripts /path/to/OpenTYG-SDK
```

## 快速接入

以下示例只查询当前账号的门禁目录，**不会开门或发送短信**。密码由你的应用从安全输入或凭据存储获得；不要写进源码、日志或提交记录。

```js
import { TygClient } from 'tyg-core-sdk';

// 一个实例对应一个账号；SDK 本身不提供公网 HTTP 服务。
const sdk = new TygClient({ lastLoginOs: '4' });
try {
  await sdk.initialize();
  await sdk.loginPassword(accountFromSecureInput, passwordFromSecureInput);
  const households = await sdk.getHouseholds();
  const household = households.find(item => item.available);
  if (!household) throw new Error('账号没有可用房产');
  const directory = await sdk.getDoors(household.id);
  // 将 directory.doors 的名称和本次目录引用展示给用户。
} finally {
  sdk.close(); // 释放本地资源；如需注销平台登录，应调用 logout()。
}
```

完整可运行的只读示例见 [examples/list-doors.mjs](examples/list-doors.mjs)。短信流程为 `createCaptcha → 用户查看并填写图形码 → sendSms → 用户填写短信码 → loginSms`；SDK 不识别或绕过验证码。用户明确选择门禁后，使用当前 `householdId`、`directoryId` 和 `doorId` 调用 `openDoor`，见 [SDK 参考](docs/sdk-reference.md)。

## 与网页应用的关系

[main 分支](https://github.com/zjmdong/OpenTYG/tree/main) 是可部署的 OpenTYG 网页 / PWA 应用；本分支是 SDK 库和平台协议参考，不包含网页服务器、客户部署配置、运行日志或现场测试资料。main 内嵌的是经过服务端安全适配的 SDK，包含稳定门 ID 等修改；本分支保留独立 v0.3.4 的核心源码，不能直接覆盖 main 的 vendor 目录。

## 安全、贡献与许可证

SDK 不是完整的公网认证服务：短信与密码限流、浏览器会话、CSRF、主机白名单、加密持久化和操作审计由集成方负责。`serializeLoginSession()` **包含登录令牌与可能的账户密码，不会自动加密**；不要直接写文件、发给浏览器或记录到日志。Windows 存储为可选 DPAPI 适配，其他系统需要自己的可信加密存储。

普通问题通过 [Issues](https://github.com/zjmdong/OpenTYG/issues) 反馈，贡献步骤见 [CONTRIBUTING.md](CONTRIBUTING.md)，安全问题参见 [SECURITY.md](SECURITY.md)。原创代码以 [MIT](LICENSE) 许可；第三方依赖保留 [各自许可证](THIRD_PARTY_NOTICES.md)。MIT 不授予第三方平台、账号、资料、设备或商标的权利。

# 来源与授权边界 / Provenance and permissions

本分支的协议说明依据公开渠道可获取的桃园谷客户端及相关协议资料整理，分析基线为 Android 客户端 1.3.8。SDK v0.3.4 是项目独立维护的 Node.js 适配实现，不是从官方获得的开发者 SDK，也不代表官方开放平台。文档不是官方发布的接口说明。

本次公开整理没有可以核验、可长期引用的原客户端下载地址，因此不编造下载链接，也不把“来源于公开渠道”作为官方授权证明。仓库仅发布独立适配代码、重新整理的协议说明和虚构示例；不分发 APK、反编译 Java 源码、原生库、客户现场资料或访问令牌。协议说明仅覆盖该实现消费的字段，不宣称平台完整接口或未来兼容。

核心源码保留 v0.3.4 原始字节；[源码清单](source-manifest.json) 给出各文件 SHA-256。唯一运行包装调整是 ICE wrapper 使用 npm 包名加载依赖，代替随源码携带的 `node_modules`。包版本和完整性由锁文件固定，各组件原许可另存于 [第三方许可](../THIRD_PARTY_NOTICES.md)。未附带原浏览器原型或其本地 HTTP API。

公开可下载、研究协议、再分发第三方软件及调用第三方服务是不同的权限问题。MIT 只覆盖有权许可的项目代码；平台条款、商标、隐私、设备管理要求和适用法律仍需使用者自行确认。参见 [免责声明](../DISCLAIMER.md)。

## English

Protocol descriptions are organized from publicly accessible Taoyuangu client and related materials, with Android client 1.3.8 as the analysis baseline. SDK v0.3.4 is independently maintained Node.js adapter code, not a developer SDK obtained from the official platform. The reference is not official documentation.

No verifiable, durable download URL for the original client was available during this publication pass. We do not invent one or treat a public-source statement as proof of authorization. This branch publishes independent adapter code, rewritten protocol descriptions, and fictional examples, excluding APKs, decompiled Java source, native libraries, customer field records, and access tokens. Only fields consumed by this implementation are described; platform completeness or future compatibility is not claimed.

Core files retain their v0.3.4 bytes; [source-manifest.json](source-manifest.json) lists their SHA-256 hashes. The runtime packaging change makes the ICE wrapper resolve npm package names instead of bundled `node_modules`. Versions and integrity are pinned by the lockfile and dependency licenses are preserved in [third-party notices](../THIRD_PARTY_NOTICES.md). The browser prototype and its local HTTP API are excluded.

Public download access, protocol research, redistribution rights, and service authorization are separate questions. MIT covers only project code this project is entitled to license. Users must assess platform terms, trademarks, privacy, device rules, and applicable laws. See the [disclaimer](../DISCLAIMER.md).

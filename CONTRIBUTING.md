# 贡献指南 / Contributing

欢迎提交普通问题、功能建议和 Pull Request。先查找已有 Issue，描述预期行为、实际行为、版本、浏览器和部署方式。截图和日志需要去掉账号、房产地址、令牌、Cookie 和密钥。安全漏洞请使用 [安全报告流程](SECURITY.md)，不要公开细节。

Welcome bug reports, suggestions, and Pull Requests. Search existing issues first, then describe expected and actual behavior, version, browser, and deployment method. Remove accounts, property addresses, tokens, cookies, and keys from screenshots and logs. Use the [security reporting process](SECURITY.md) for vulnerabilities.

## 开发 / Development

使用 Node.js 24+，按 [配置参考](docs/configuration.md) 的回环开发步骤启动。服务没有 npm 运行时依赖；前端是原生 ES modules。使用独立数据与密钥，且只用获授权账号。开门验证会产生真实设备操作，应在可控现场进行。

Use Node.js 24+ and the loopback setup in [configuration](docs/configuration.md). There are no npm runtime dependencies; the frontend uses native ES modules. Use separate development data and secrets and authorized accounts only. Door verification performs real hardware actions and belongs in a controlled setting.

## 提交修改 / Submitting changes

- 修改集中于一个清晰问题，说明行为变化和验证方式；同步更新中英文 README 或相关文档。
- 检查修改文件的语法；登录、目录、门禁或存储变化应验证相关行为、权限边界和失败路径。UI 修改检查手机尺寸和深浅色主题。
- 不添加自动重放开门、离线命令队列、凭据日志或在浏览器中保存上游秘密的实现。
- 不提交 `.env`、data、secrets、日志、客户信息、APK、备份、临时测试工具或报告。使用虚构且明确标记的示例数据。
- 不同进程不能共享写入数据目录；新增运行模式或持久格式时解释兼容性与恢复方式。

Keep each change focused, explain the behavior and verification, and update the corresponding documentation in both languages. Check syntax and relevant success, failure, permission, and persistence behavior; verify UI changes on mobile and in both themes. Do not add automatic command replay, offline command queues, credential logs, or browser storage of upstream secrets. Do not commit configuration, private state, customer data, APKs, backups, temporary verification tools, or reports. Changes to runtime or storage formats should explain compatibility and recovery.

贡献的代码以本项目 [MIT 许可证](LICENSE) 发布。不要提交无权再分发的代码、资源或平台凭据。

Contributions are distributed under this project's [MIT License](LICENSE). Do not submit code, assets, or platform credentials you are not authorized to redistribute.

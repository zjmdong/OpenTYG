<div align="center">
  <img src="web/icons/icon-192.png" width="96" height="96" alt="OpenTYG">
  <h1>OpenTYG</h1>
  <p>把已有的桃园谷门禁权限，带到浏览器和手机主屏幕。</p>
  <p>
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License"></a>
    <img src="https://img.shields.io/badge/Node.js-24%2B-339933" alt="Node.js 24 or newer">
    <img src="https://img.shields.io/badge/mobile-PWA-5A0FC8" alt="Mobile PWA">
  </p>
  <p><strong>简体中文</strong> · <a href="README.en.md">English</a></p>
</div>

OpenTYG 是一个可自行部署的移动端网页应用，支持通过已有桃园谷账号登录、选择房产、管理常用门禁和远程开门。前端与后端由一个 Node.js 服务提供，通过 Docker 即可部署，无需前端构建或额外数据库。

本项目为独立实现，与桃园谷官方没有隶属关系。使用前需要已有账号及有效门禁权限；应用不会授予或绕过平台权限。当前应用界面为简体中文，项目文档提供中英双语。

## 功能

- **手机使用**：适配触屏、深浅色主题，支持安装为 PWA；iPhone 提供添加到主屏幕的操作说明。
- **账号登录**：短信验证码、密码登录及平台要求的设备验证；可选择记住登录。
- **房产与门禁**：切换有权限的房产、拖动排序、自定义名称，首页最多收藏 5 个门禁。
- **连接准备**：登录后及回到前台时提前准备门禁连接，发送开门指令前检查目录和权限。
- **私有存储**：服务端加密保存记住的登录状态和用户偏好，浏览器不接收上游登录令牌或开门凭据。
- **简单部署**：单容器、单端口、无 npm 运行时依赖；附带健康检查和 HTTPS 反向代理示例。

## 快速开始

以下命令适用于安装了 Docker Engine、Compose 插件、Git 和 OpenSSL 的 Linux 主机。完整步骤及其他部署方式见 [部署指南](docs/deployment.md)。

```sh
git clone https://github.com/zjmdong/OpenTYG.git
cd OpenTYG
cp .env.example .env
```

编辑 `.env`，把 `PUBLIC_ORIGIN` 改为你的公网 HTTPS 地址，例如 `https://opentyg.example.com`。如果使用非标准端口，必须包含端口，例如 `https://opentyg.example.com:8443`。

首次部署生成密钥，并为默认容器用户准备权限：

```sh
mkdir -p data secrets
(umask 077; set -C; openssl rand -base64 32 > secrets/opentyg_secret.txt)
sudo chown -R 10001:10001 data secrets
sudo chmod 700 data secrets
sudo chmod 600 secrets/opentyg_secret.txt
docker compose up -d --build
curl -fsS http://127.0.0.1:8080/api/health
```

密钥生成命令会拒绝覆盖已有文件。**升级或迁移时保留原有 `data/` 和 `secrets/`，不要重新生成密钥。** 如果修改了 `.env` 中的 UID/GID，目录和密钥文件的所有者也要一致。

接着配置域名、有效证书和 HTTPS 反向代理，指向 `http://127.0.0.1:8080`。可参考 [Nginx 示例](deploy/nginx-opentyg.conf)。默认只把 HTTP 端口绑定到本机；用户从配置的 HTTPS 地址访问应用。直接打开内部 HTTP 地址不能完成生产登录。

## 手机安装

通过 HTTPS 打开应用后，支持安装提示的 Android 浏览器可使用安装入口；也可从浏览器菜单选择安装。iPhone 使用 Safari 的“分享 → 添加到主屏幕”。浏览器是否自动显示安装提示由其自身策略决定。

安装后可从主屏幕启动独立窗口。开门需要联网；离线页只提示恢复连接，不缓存账号数据、不排队或重放开门指令。

## 文档

| 文档 | 内容 |
| --- | --- |
| [部署指南](docs/deployment.md) / [English](docs/deployment.en.md) | Docker、HTTPS、端口映射、手机安装、升级与排障 |
| [配置参考](docs/configuration.md) | 环境变量、运行用户、上游地址与本机开发 |
| [架构说明](docs/architecture.md) | 浏览器、后端、平台服务和数据存储 |
| [隐私与运维](docs/security.md) | 凭据生命周期、加密边界、备份与恢复 |
| [API 参考](docs/api.md) | 会话、目录、门禁操作和错误处理 |

## 安全与使用边界

浏览器到本服务的生产连接必须使用 HTTPS。默认上游配置兼容 HTTP／WS；公网 HTTPS 只保护浏览器到反向代理这一段，无法加密后端到 HTTP 上游的通信。请按你的网络环境评估这一边界，限制上游主机名单；若上游提供经验证的 HTTPS／WSS，再关闭 HTTP 兼容。

收到平台成功回执不等于物理门锁一定开启。发送后断网或超时会显示结果未知，应用不会自动重发；请确认现场状态，再决定是否重新操作。

本项目采用单实例文件存储，不支持多个进程或容器同时读写同一数据目录。不要把 `data/`、`secrets/`、`.env`、证书私钥或运行日志上传到代码仓库。

## 参与项目

欢迎通过 [Issues](https://github.com/zjmdong/OpenTYG/issues) 报告普通问题或提出建议，通过 Pull Request 贡献修改。提交前请阅读 [贡献指南](CONTRIBUTING.md)。安全问题请参照 [SECURITY.md](SECURITY.md)，不要公开账号、令牌或可直接复现的敏感信息。

## 许可证

OpenTYG 的源代码以 [MIT 许可证](LICENSE) 发布。第三方平台服务、账号、门禁设备及商标不属于本项目的授权范围。

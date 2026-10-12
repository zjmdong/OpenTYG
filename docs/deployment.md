# 部署指南

[English](deployment.en.md) · [返回 README](../README.md)

本指南使用 Linux 主机、Docker Compose 和 HTTPS 反向代理，适用于个人服务器、云主机或支持 Docker 的设备。示例域名 `opentyg.example.com` 必须替换为你的域名。

## 1. 准备环境

需要：

- Docker Engine 及 Compose 插件，能够运行 Linux 容器。建议使用受支持的最新稳定版。
- OpenSSL、curl、unzip 和 sha256sum。
- 一个域名，以及能自动续期的受信任 TLS 证书。
- 有效桃园谷账号，以及该账号已有的房产和门禁权限。
- 主机能够连接配置的官方 HTTP／HTTPS 和 WebSocket 上游。

确认工具已安装：

```sh
docker version
docker compose version
openssl version
```

如果当前用户没有 Docker 权限，按系统的 Docker 安装说明处理，或在 Docker 命令前使用 `sudo`。Docker 管理权限应仅授予可信任的管理员。

## 2. 下载部署配置

```sh
mkdir -p OpenTYG
cd OpenTYG
curl -fL -o OpenTYG-deploy-v1.2.1.zip https://github.com/zjmdong/OpenTYG/releases/download/v1.2.1/OpenTYG-deploy-v1.2.1.zip
curl -fL -o DEPLOY-SHA256SUMS.txt https://github.com/zjmdong/OpenTYG/releases/download/v1.2.1/DEPLOY-SHA256SUMS.txt
sha256sum -c DEPLOY-SHA256SUMS.txt
unzip OpenTYG-deploy-v1.2.1.zip
cp .env.example .env
```

选择一个长期保留的目录。`data/` 与 `secrets/` 会在此保存，不应放在自动清理的临时目录中。

配置包只包含 Compose、配置模板、反向代理示例、部署说明和许可证，没有应用源码、账号、数据或密钥。若 SHA256 校验失败，请重新下载，不要继续使用损坏的文件。也可在浏览器中下载 Release 附件并解压。

## 3. 编辑配置

用文本编辑器打开 `.env`，至少修改：

```dotenv
PUBLIC_ORIGIN=https://opentyg.example.com
LAN_BIND_IP=127.0.0.1
APP_PORT=8080
APP_UID=10001
APP_GID=10001
```

`PUBLIC_ORIGIN` 是用户实际打开的“协议 + 域名 + 端口”，不能带路径、查询参数或 `/#/home`。默认 HTTPS 端口 443 可以省略；外部使用 8443 时填写 `https://opentyg.example.com:8443`。外部端口和应用的内部端口可以不同。

默认配置适合同一主机直接运行反向代理。如果代理运行在另一台设备，把 `LAN_BIND_IP` 改为 Docker 主机真实的内网地址，并在防火墙上仅允许代理访问 `APP_PORT`。不要把内部 HTTP 端口映射到公网。Docker 的端口发布行为可参考 [官方说明](https://docs.docker.com/engine/network/port-publishing/)；旧版 Docker 的回环端口隔离存在已知差异，请保持更新。

其他变量见 [配置参考](configuration.md)。不要在 `.env` 中添加真实账号、密码或令牌。

## 4. 生成应用密钥

**仅首次部署执行**：

```sh
mkdir -p data secrets
(umask 077; set -C; openssl rand -base64 32 > secrets/opentyg_secret.txt)
```

命令不会在终端打印密钥，并拒绝覆盖已有文件。若提示文件已存在，保留它；不要删除后重新生成。若 OpenSSL 执行失败，检查新建文件是否为空，修复原因后再准备首次启动，应用要求至少 32 字节的随机外部秘密。

应用还会在 `data/.app-secret` 保存被这个外部秘密加密封装的数据密钥。两者共同用于恢复数据。密钥丢失或被替换时，原数据无法正常解密。

Compose 将文件挂载到 `/run/secrets/opentyg_secret`。普通 Compose 的文件型 secrets 不会自动加密主机上的源文件；应保护源文件权限和备份。[Docker secrets 说明](https://docs.docker.com/compose/how-tos/use-secrets/)

## 5. 设置文件权限

默认容器用户为 `10001:10001`：

```sh
sudo chown -R 10001:10001 data secrets
sudo chmod 700 data secrets
sudo chmod 600 secrets/opentyg_secret.txt
```

如果希望用自己的主机用户身份运行，先执行 `id -u` 和 `id -g`，把实际数字填入 `.env` 的 `APP_UID`、`APP_GID`，再使用相同数字设置以上所有者。

容器不会自动继承当前终端用户。删除 Compose 的 `user` 行会回退到镜像内的 `10001:10001`。应用代码在镜像构建时统一设置为可读取；只有 `data/` 需要写入权限，密钥只需读取。不要使用 `chmod -R 777` 或为了绕过权限而用 root 运行应用。使用 ACL 的主机还需确认父目录及共享目录的访问规则。

## 6. 拉取镜像并启动

```sh
docker compose config --quiet
docker compose pull
docker compose up -d
docker compose ps
docker compose logs --tail=50 opentyg
curl -fsS http://127.0.0.1:8080/api/health
```

如果修改了绑定地址或端口，调整 curl 地址。健康接口返回 `ok: true`、`status: "ok"`。健康检查验证本地服务及已知存储错误，不能证明平台可用或物理门锁正常。

预构建镜像来自本项目的公开 GitHub Container Registry：`ghcr.io/zjmdong/opentyg:1.2.1`，支持 `linux/amd64` 和 `linux/arm64`；Docker 会自动选择主机对应架构，无需 GitHub 登录，也无需下载源码或本地构建。默认镜像以非 root 用户运行，根文件系统只读，持久数据挂载到 `/data`。

## 7. 配置 HTTPS 反向代理

连接结构：

```text
手机浏览器 / PWA
    ↓ HTTPS
反向代理（TLS 证书）
    ↓ HTTP，仅本机或受控内网
Docker 主机:8080 → 容器:8787
    ↓ 官方 HTTP / WS，或可用的 HTTPS / WSS
桃园谷服务
```

对于直接运行在 Docker 主机上的 Nginx，使用 [示例配置](../deploy/nginx-opentyg.conf)，修改域名、证书路径以及需要时的监听端口。将 server 块放入 Nginx 的 `http` 配置中，然后：

```sh
sudo nginx -t
sudo nginx -s reload
```

如果 Nginx 由系统服务管理，也可以在语法检查通过后使用系统的服务重载命令。配置中证书路径只是示例，证书由你自己的证书工具签发和续期。

其他反向代理需要满足这些设置：

| 项目 | 设置 |
| --- | --- |
| 前端协议 | HTTPS，证书包含你的域名并提供完整证书链 |
| 目标 | 同主机代理为 `http://127.0.0.1:8080`；远程代理使用受限内网地址 |
| Host | 保留浏览器的原始 Host，包括非标准端口；Nginx 使用 `$http_host` |
| Origin | 原样传递，必须与 `PUBLIC_ORIGIN` 完全一致 |
| 路径 | 整站部署在 `/`；API、静态资源和 Service Worker 同源 |
| Cookie | 保留 `HttpOnly`、`Secure`、`SameSite=Strict`，不改写或去除属性 |
| 缓存 | 关闭代理/CDN 对 API 和应用资源的缓存，不缓存登录与开门响应 |
| 超时 | 可参照示例设置 120 秒读取/发送超时 |
| 日志 | 不记录请求体、Cookie、Authorization 或带令牌的上游 URL |

门禁 WebSocket 由应用后端连接上游；浏览器到应用使用普通 HTTP API，不需要将上游 WebSocket 或其他服务端口暴露到公网。不要为此添加跨域 CORS、删除 Origin 校验或关闭 Secure Cookie。

如果代理本身在另一个容器内，`127.0.0.1` 指向该代理容器，并非 Docker 主机。应把两个容器接入同一个专用 Docker 网络，用服务名 `opentyg:8787` 作为代理目标，或使用防火墙保护的主机内网端口。保持对外 Host 与 Origin 不变。

## 8. 设置域名与端口映射

让域名的 DNS A 记录指向公网 IPv4。只有实际配置了 IPv6 监听与防火墙时才添加 AAAA 记录。动态公网地址可使用适合你的 DNS 服务商的动态更新工具。

如果服务器位于路由器后面，把**外部 HTTPS 端口**转发到反向代理的 HTTPS 监听端口。示例：外部 TCP 8443 → 代理主机 TCP 443；此时 `PUBLIC_ORIGIN=https://opentyg.example.com:8443`，Host 必须保留 `:8443`。不要把 8443 转发到应用 HTTP 端口 8080。

证书校验的是域名，不是端口。使用非标准 HTTPS 端口时，证书签发与续期仍需满足证书工具采用的挑战方式：HTTP-01 通常需要公网 80，DNS-01 需要 DNS 验证。不要误以为开放 8443 就足以完成所有证书校验。

家庭宽带若处于运营商 NAT 后面，端口映射可能无法接收公网连接，需要向运营商申请可入站地址，或配置支持此场景的安全入口。内网访问同一公网域名可使用路由器回环或分离 DNS；保留同一个 HTTPS 域名、端口和有效证书。

**HTTPS 代理不会加密后端到官方 HTTP 上游的链路。** 默认 `ALLOW_INSECURE_UPSTREAM=1` 用于协议兼容；仅允许列出的上游主机，不允许任意转发。详情见 [隐私与运维](security.md)。

## 9. 登录和安装到手机

先使用电脑访问配置的 HTTPS 地址，确认页面正常、证书有效，然后使用已有账号登录。选择正确房产，确认门禁列表、收藏、排序和名称。

安卓设备用支持 PWA 安装的浏览器打开同一 HTTPS 地址，使用页面安装入口或浏览器菜单。iPhone 使用 Safari，点击“分享 → 添加到主屏幕”。微信等内置浏览器可能不支持安装，先选择用系统浏览器打开。自动弹出安装提示不是所有浏览器都支持的行为。[浏览器安装条件](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable)

安装后从主屏幕启动，确认登录状态、切回前台后的连接准备及有权限的开门操作。开门回执不保证物理锁开启；结果未知时先确认现场，再决定是否重新操作。不要通过重复点击诊断网络问题。

## 10. 备份与恢复

一起备份 `.env`、完整 `data/`（含隐藏的 `.app-secret`）和 `secrets/`。先停止容器再做文件备份，避免不同文件处于不一致时间点：

```sh
docker compose stop
(umask 077; sudo tar -czf - .env data secrets > "../opentyg-backup-$(date +%Y%m%d-%H%M%S).tar.gz")
docker compose start
```

若备份失败，排查原因并恢复服务启动。归档放在项目外，仍包含敏感数据和密钥，应再加密并存放在受控的独立位置，不要上传到 GitHub。记录备份对应的镜像版本和 digest，并定期验证恢复。

恢复时先停止服务，在目标目录恢复整套文件，设置与 `APP_UID:APP_GID` 一致的所有者及受限权限，使用匹配的镜像版本启动，检查健康和登录恢复。不要仅复制 `users/`、漏掉隐藏文件或换掉外部秘密。这里没有自动密钥轮换工具；需要轮换时应先规划重新加密迁移。

## 11. 升级

先按上一节备份，确认发布内容和运行要求。在 `.env` 中将 `OPENTYG_VERSION` 改为目标 Release 的版本号，再执行：

```sh
docker compose pull
docker compose up -d
docker compose ps
```

检查 HTTPS 页面、记住的登录、偏好和连接恢复。升级时保留 `.env`、`data/`、`secrets/` 和现有密钥；不要再次运行首次密钥生成步骤。若要回滚，先确认数据格式兼容，必要时恢复配套备份。

## 12. 常见问题

| 现象 | 检查方法 |
| --- | --- |
| `EACCES` 或反复重启 | 检查 UID/GID、密钥可读、data 可写及主机 ACL；确认使用当前发布镜像 |
| `APP_SECRET_MISMATCH` / `DATA_KEY_MISSING` | 恢复原始密钥和完整 data，不要生成新密钥覆盖 |
| 页面或登录返回 403 | 对照 `PUBLIC_ORIGIN`、外部 Host/端口、Origin 及代理是否改写请求头 |
| HTTPS 页面显示 502 | 检查容器健康、代理目标、Docker 网络、监听地址和端口 |
| 内网 HTTP 登录失败 | 使用配置的 HTTPS 地址；生产登录要求 Secure Cookie 和固定 origin |
| 连接上游失败 | 检查 DNS、出站网络、官方服务状态、HTTP 兼容开关和主机允许名单 |
| 短信或登录被限制 | 等待提示的剩余时间；重启不会清除持久化限流 |
| 安装入口没有出现 | 使用支持的系统浏览器、有效 HTTPS；可尝试浏览器菜单，安装策略由浏览器控制 |
| 离线无法开门 | 恢复网络；应用不会离线存储或排队开门请求 |

排障可查看 `docker compose logs --tail=100 opentyg`，分享日志前再检查敏感内容。健康接口成功只表示本地服务正常，不代表上游或门锁正常。

## 13. 镜像版本与源码构建

`1.2.1` 是固定应用版本；`latest` 跟随以后发布的稳定版，生产环境建议显式设置版本。可通过 `docker image inspect ghcr.io/zjmdong/opentyg:1.2.1 --format '{{json .RepoDigests}}'` 记录本地拉取的 digest，或在 Compose 的 `image` 中使用 `ghcr.io/zjmdong/opentyg@sha256:实际digest` 固定内容。

从以前的源码部署迁移时，先停止并备份，将 Compose 改为镜像拉取版，再拉取启动；保留原有 `.env`、`data/`、`secrets/` 和 UID/GID。同一数据目录只允许一个实例运行。

贡献者也可以下载完整源码，在仓库根目录运行：

```sh
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

源码构建使用可选覆盖文件；仅部署配置包不包含构建所需源码。发布流程从指定版本标签构建，在两种原生架构上检查启动和健康后推送 GHCR。SDK 分支不发布应用容器。

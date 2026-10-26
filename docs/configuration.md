# 配置参考 / Configuration

[中文 README](../README.md) · [English README](../README.en.md)

## Docker Compose

安装脚本会把填写的配置直接写入 `docker-compose.yml`，无需 `.env`。下表用于手动使用仓库的 Compose 模板；可通过环境变量或可选 `.env` 传值。生产配置固定启用 Secure Cookie，并关闭本机开发模式。密钥从独立文件挂载，不能写进镜像或提交到 Git。

The installer writes configuration directly into `docker-compose.yml`, without an `.env`. The table below applies to the repository Compose template; use environment variables or an optional `.env`. It enables Secure cookies, and disables local development mode. The application secret is mounted from a separate file; never embed it in an image or commit it.

| 变量 / Variable | 默认值 / Default | 用途 / Purpose |
| --- | --- | --- |
| `PUBLIC_ORIGIN` | 必填 / Required | 浏览器的完整 HTTPS origin；含非标准端口，无路径。Exact browser-facing HTTPS origin, including a nonstandard port, without a path. |
| `LAN_BIND_IP` | `127.0.0.1` | 主机 HTTP 绑定地址；远程代理需改为受控内网地址。Host HTTP binding; use a restricted private address for a remote proxy. |
| `APP_PORT` | `8080` | 主机端口，映射到容器 `8787`。Host port mapped to container port `8787`. |
| `APP_DATA_DIR` | `./data` | 数据挂载目录；首次需提前创建。Data bind-mount directory; create before first start. |
| `APP_SECRET_PATH` | `./secrets/opentyg_secret.txt` | 外部密钥文件路径。External secret file path. |
| `APP_UID` / `APP_GID` | `10001` / `10001` | 容器数值身份，须匹配数据和密钥文件权限。Numeric container identity; match data and secret ownership. |
| `OPENTYG_VERSION` | `1.2.4` | 拉取的公开镜像版本；建议固定 Release，`latest` 跟随稳定版。Public image version; pin a release, or use `latest` for the current stable image. |
| `NODE_IMAGE` | `node:24-alpine` | 仅用于 `docker-compose.build.yml` 源码构建覆盖文件。构建基础镜像；使用兼容的官方 Alpine Node 镜像，可固定 digest。Only used by the source-build override `docker-compose.build.yml`. Build base; use a compatible official Alpine Node image, optionally pinned by digest. |
| `TYG_ORIGIN` | `http://lxj.taoyuangu.com:80` | 平台初始化入口；地址改变可能使保存的登录失效。Platform bootstrap origin; changing it can invalidate saved login state. |
| `UPSTREAM_ALLOWED_HOSTS` | `lxj.taoyuangu.com,uums.taoyuangu.com,sso.taoyuangu.com` | 逗号分隔的精确主机名，不支持通配符、协议或端口。Comma-separated exact hostnames; no wildcards, schemes, or ports. |
| `ALLOW_INSECURE_UPSTREAM` | `1` | 允许名单内 HTTP/WS。设 `0` 要求 HTTPS/WSS。Allow HTTP/WS on listed hosts; `0` requires HTTPS/WSS. |
| `LOG_QUIET` | `0` | `1` 关闭应用结构化日志；容器启动消息可能仍出现。`1` suppresses application logger output; startup messages can remain. |

上游响应给出的动态地址也必须通过主机名单和协议校验。发生拒绝时，先验证新地址归属再修改配置。TLS 证书校验保持开启；不要用 `NODE_TLS_REJECT_UNAUTHORIZED=0` 绕过错误。

Dynamic addresses returned by the platform must pass the same hostname and protocol checks. Verify a new endpoint before changing the list. TLS certificate validation remains enabled; do not bypass it with `NODE_TLS_REJECT_UNAUTHORIZED=0`.

## 直接运行 Node.js / Running Node.js directly

需要 Node.js 24 或更新版本，无需 `npm install` 或前端构建。下面变量由服务读取；Compose 的 `APP_PORT`、`APP_UID`、`APP_GID`、`LAN_BIND_IP` 只用于容器部署，不会配置直接启动的 Node 进程。

Node.js 24 or newer is required. No `npm install` or frontend build is necessary. The variables below configure the service directly; `APP_PORT`, `APP_UID`, `APP_GID`, and `LAN_BIND_IP` apply only to Compose.

| 变量 / Variable | 默认值 / Default | 用途 / Purpose |
| --- | --- | --- |
| `PORT` | `8787` | Node 监听端口 / Node listener port |
| `HOST` | `0.0.0.0` | Node 监听地址 / Node bind address |
| `DATA_DIR` | 项目 `data/` / Project `data/` | 独占持久目录 / Exclusive persistent directory |
| `APP_SECRET_FILE` | 无 / None | 可读文件，内容至少 32 字节随机秘密 / Readable file containing a random secret of at least 32 bytes |
| `APP_SECRET` | 无 / None | 外部秘密的环境变量替代，不能和 `_FILE` 同时设置；优先文件 / Environment alternative; mutually exclusive with `_FILE`; prefer the file |
| `PUBLIC_ORIGIN` | 无 / None | 生产必填 HTTPS origin / Required HTTPS origin for production |
| `COOKIE_SECURE` | 根据 origin / Based on origin | 生产必须为 `1` / Must be `1` in production |
| `LOCAL_TEST_MODE` | `0` | 仅 `1` 启用回环 HTTP 开发例外 / Only `1` enables loopback HTTP development |
| `TYG_ORIGIN`、`UPSTREAM_ALLOWED_HOSTS`、`ALLOW_INSECURE_UPSTREAM`、`LOG_QUIET` | 见上文 / See above | 直接启动也适用；HTTP 兼容必须显式开启 / Also apply directly; HTTP compatibility must be explicitly enabled |

命令行支持 `--port=8787`、`--host=127.0.0.1`、`--data=/path/to/data`、`--origin=https://upstream.example.com`。这些选项覆盖对应监听、存储或上游变量；生产安全规则仍生效。普通 Node 启动不会自动加载 `.env`。

CLI options include `--port=8787`, `--host=127.0.0.1`, `--data=/path/to/data`, and `--origin=https://upstream.example.com`. They override their corresponding values while preserving production security checks. Plain Node startup does not automatically load `.env`.

## 本机开发 / Local development

仅在自己的电脑回环地址测试时使用下面 Linux/macOS shell 示例。使用独立开发数据和独立密钥，不连接生产数据。命令仍会连接真实上游，输入真实账号时会执行真实平台操作；仓库没有内置演示账号。

Use this Linux/macOS shell example only for loopback development. Keep development data and secrets separate from production. These commands still connect to the real upstream, and real accounts perform real platform operations. No demo accounts are included.

```sh
mkdir -p .local-data .local-secrets
(umask 077; set -C; openssl rand -base64 32 > .local-secrets/app-secret.txt)
HOST=127.0.0.1 PORT=8787 \
PUBLIC_ORIGIN=http://127.0.0.1:8787 COOKIE_SECURE=0 LOCAL_TEST_MODE=1 \
DATA_DIR="$PWD/.local-data" APP_SECRET_FILE="$PWD/.local-secrets/app-secret.txt" \
ALLOW_INSECURE_UPSTREAM=1 \
UPSTREAM_ALLOWED_HOSTS=lxj.taoyuangu.com,uums.taoyuangu.com,sso.taoyuangu.com \
node server/index.mjs
```

打开 `http://127.0.0.1:8787`。本机模式仍验证 Host、Origin 和请求标记，禁止绑定 `0.0.0.0` 或内网地址。对外发布始终使用生产 HTTPS 配置。

Open `http://127.0.0.1:8787`. Local mode still validates Host, Origin, and request markers, and refuses wildcard or LAN binding. Always use production HTTPS settings for public deployment.

## 从源码构建 / Build from source

仅贡献者需要完整源码。配置好 Compose 模板所需变量、数据和密钥后，在仓库根目录执行：

Only contributors need the complete source. Configure the template variables, data, and secret first, then run at the repository root:

```sh
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

安装脚本生成的配置直接拉取已发布镜像。它固定部署值，不读取上表中的环境变量；修改生成的 Compose 文件即可更换端口、镜像版本或目录。

Installer-generated configuration pulls the published image and uses explicit values instead of the variables above. Edit the generated Compose file to change ports, image versions, or paths.

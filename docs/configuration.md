# 配置参考

[文档](README.md) / 配置 · [English](configuration.en.md)

## 先区分两种配置

- **安装向导**：直接把值写入生成的 `docker-compose.yml`，不需要 `.env`。后续修改这个文件即可。
- **仓库模板**：使用 [docker-compose.yml](../docker-compose.yml)，通过环境变量或可选 `.env` 传值；可参考 [.env.example](../.env.example)。

两者都在生产启用 Secure Cookie、关闭本机开发模式，并从独立文件挂载密钥。

## Compose 变量

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `PUBLIC_ORIGIN` | `必填` | 完整 HTTPS origin，含非标准端口，不带路径。 |
| `LAN_BIND_IP` | `127.0.0.1` | 主机 HTTP 绑定地址；远程反代使用受控内网地址。 |
| `APP_PORT` | `8080` | 主机端口，映射到容器 8787。 |
| `APP_DATA_DIR` | `./data` | 数据挂载目录，首次启动前创建。 |
| `APP_SECRET_PATH` | `./secrets/opentyg_secret.txt` | 原始外部密钥文件路径。 |
| `APP_UID / APP_GID` | `10001 / 10001` | 容器数值身份，须匹配数据与密钥的文件权限。 |
| `OPENTYG_VERSION` | `1.2.5` | 公开镜像版本；建议固定 Release，latest 跟随稳定版。 |
| `NODE_IMAGE` | `node:24-alpine` | 仅源码构建覆盖文件使用，可固定兼容官方镜像的 digest。 |
| `TYG_ORIGIN` | `http://lxj.taoyuangu.com:80` | 平台初始化入口；改变地址可能使保存的登录失效。 |
| `UPSTREAM_ALLOWED_HOSTS` | `见下文` | 逗号分隔的精确主机名，不含通配符、协议或端口。 |
| `ALLOW_INSECURE_UPSTREAM` | `1` | 允许名单内 HTTP / WS；设 0 要求 HTTPS / WSS。 |
| `LOG_QUIET` | `0` | 1 关闭应用结构化日志，容器启动消息可能仍出现。 |

默认上游名单：

```text
lxj.taoyuangu.com,uums.taoyuangu.com,sso.taoyuangu.com
```

动态返回的地址也必须通过主机和协议校验。新增主机前先确认归属；不要以 `NODE_TLS_REJECT_UNAUTHORIZED=0` 绕过 TLS 证书校验。HTTP 兼容的影响见 [网络边界](security.md#网络与上线检查)。

手动部署前须创建数据目录和至少 32 字节的随机密钥，使所选 UID:GID 可以读写数据、读取密钥。新私有目录建议 `0700`，密钥文件 `0600`。已有部署始终使用原密钥，不能通过生成新密钥来修复读取错误。

## 直接运行 Node.js

需要 **Node.js 24+**，无需 `npm install` 或前端构建。

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `PORT` | `8787` | Node 监听端口。 |
| `HOST` | `0.0.0.0` | Node 监听地址。 |
| `DATA_DIR` | `项目 data/` | 实例独占的持久目录。 |
| `APP_SECRET_FILE` | `无` | 可读文件，内容至少 32 字节随机秘密。 |
| `APP_SECRET` | `无` | 环境变量替代方式，与 APP_SECRET_FILE 互斥；优先文件。 |
| `PUBLIC_ORIGIN` | `无` | 生产必填 HTTPS origin。 |
| `COOKIE_SECURE` | `依 origin` | 生产必须为 1。 |
| `LOCAL_TEST_MODE` | `0` | 只有 1 开启回环 HTTP 开发例外。 |

`TYG_ORIGIN`、`UPSTREAM_ALLOWED_HOSTS`、`ALLOW_INSECURE_UPSTREAM`、`LOG_QUIET` 也适用。直接启动默认不允许 HTTP 上游，须显式设 `ALLOW_INSECURE_UPSTREAM=1`；Compose 模板的默认值不会自动继承。

`--port`、`--host`、`--data`、`--origin` 分别覆盖监听端口、地址、数据目录和**上游入口**，例如 `--port=8787`。其中 `--origin` 不是 `PUBLIC_ORIGIN`。普通 Node 启动不会自动加载 `.env`；`APP_PORT`、`APP_UID`、`APP_GID`、`LAN_BIND_IP` 只配置 Compose，不配置直接启动的进程。

## 本机开发

以下为 Linux / macOS shell 示例，使用独立数据与密钥。首次创建密钥后，后续启动复用它；创建命令拒绝覆盖已有文件。

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

打开 `http://127.0.0.1:8787`。本机模式仍校验 Host、Origin 和请求标记，禁止绑定 `0.0.0.0` 或内网地址。对外发布始终使用生产 HTTPS 配置。

**这是真实模式**：仓库没有内置演示账号，登录与开门仍会访问真实平台。只使用获授权账号，并在可控现场验证设备操作。

## 源码构建

配置好仓库模板所需变量、数据和密钥后，在仓库根目录运行：

```sh
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

源码构建使用仓库模板及覆盖文件；安装向导生成的配置直接拉取公开镜像。

下一步：[架构说明](architecture.md) · [隐私与运维](security.md) · [部署排障](deployment.md#排障)

# 安装 OpenTYG

[文档](README.md) / 部署 · [English](deployment.en.md)

适用于 Linux 服务器和 NAS。支持 amd64 / arm64，不用下载源码。

## 1. 准备

在设备上安装并启动 **Docker 和 Docker Compose 插件**，需有 curl 和 OpenSSL，并准备自己的 HTTPS 域名与证书。在设备终端或 SSH 中执行下面命令。

## 2. 运行安装向导

```sh
curl -fsSL -o install.sh https://raw.githubusercontent.com/zjmdong/OpenTYG/main/install.sh && \
  bash install.sh
```

按提示填写；方括号是默认值，直接回车即可采用：

| 提示 | 怎么填 |
| --- | --- |
| 安装目录 | 存放配置的固定目录 |
| 数据目录、密钥文件 | 首次用默认值；已有服务选择原目录和原密钥 |
| 公网地址 | 例如 `https://opentyg.example.com:8443`，不带路径 |
| 反代位置 | 本机直接运行选 1；NAS 反代、其他容器或其他设备选 2 |
| 内网地址 | 选 2 时，填写 Docker 主机的实际内网 IP |
| 内网端口、版本、UID:GID | 通常回车；UID:GID 默认使用当前用户或已有数据的所有者 |

脚本会准备目录、生成首次密钥、写入一个 `docker-compose.yml`、拉取镜像、启动并检查服务，**无需 `.env`**。需要管理员权限时会提示输入设备密码；该密码不会保存到应用。

已有配置会优先保留；重新填写前会备份原 Compose 文件。已有密钥不会重新生成。缺少原密钥或数据权限不匹配时，脚本会停止并说明原因。

## 3. 设置 HTTPS 反向代理

在设备的反代工具中新增一条规则：

- **来源**：安装时填写的 HTTPS 域名和端口，选择该域名的有效证书。
- **目标**：脚本最后显示的 `http://内网地址:内网端口`。
- **请求头与缓存**：保留原始 Host（含外部端口）和 Origin；关闭缓存，保留 Cookie 属性。

反代在另一个容器内时，目标填 Docker 主机的内网 IP，不能填 `127.0.0.1`。跨设备代理时，只允许代理访问应用的 HTTP 端口。

有路由器时，只把**公网 HTTPS 端口**转发到**反代的 HTTPS 端口**。例如公网 8443 → 反代 443；不要转发到应用的 HTTP 8080。

域名 DNS 指向公网地址，证书配置好后，打开安装时填写的 **HTTPS 地址**登录。安卓在浏览器菜单安装；iPhone 在 Safari 中“分享 → 添加到主屏幕”。

## 4. 日常使用

先进入安装目录，再执行：

```sh
sudo docker compose ps                      # 看运行状态
sudo docker compose logs --tail=50 opentyg  # 查看错误
sudo docker compose stop                    # 停止服务
sudo docker compose start                   # 启动服务
```

### 升级

先按下节备份，将 `docker-compose.yml` 的 `image` 改为目标版本，例如 `ghcr.io/zjmdong/opentyg:1.2.5`，然后：

```sh
sudo docker compose pull
sudo docker compose up -d
```

保留原数据目录、密钥和 UID:GID，升级后完全关闭手机应用再打开。使用环境变量模板的部署，改 `.env` 中的 `OPENTYG_VERSION` 即可。

### 备份与迁移

停服，备份 Compose 文件及其中指定的完整数据目录（含隐藏文件）、密钥文件；自定义目录及使用中的 `.env` 也要备份。恢复时保留原密钥、文件所有者和权限。同一数据目录只运行一个实例，备份完成后可用 `sudo docker compose start` 恢复运行。

## 排障

| 现象 | 优先检查 |
| --- | --- |
| 无法打开页面 / 502 | 容器状态、反代目标、DNS 与证书；容器内的 `127.0.0.1` 不是 Docker 主机 |
| 403 / 登录失败 | 浏览器是否使用配置的 HTTPS 地址；Host、Origin 和外部端口是否一致 |
| 登录状态已失效 | 重新登录；收藏和设置保留，不必删除数据或密钥；平台可能早于 30 天使凭据失效 |
| 门禁列表暂时无法加载 | 检查服务器到平台的网络与主机名单；普通网络故障不需要清空登录数据 |
| 开门结果未知 | 核实现场门锁状态后再决定是否操作，不自动重发 |
| 凭据存储不可用 | 检查原密钥、数据目录及 UID:GID；保留文件，不通过重新生成密钥“修复” |

内部 HTTP 只供反代连接。浏览器直接访问后端地址可能被引导到 HTTPS 入口，登录仍应使用配置的公网地址。

更多：[Nginx 示例](../deploy/nginx-opentyg.conf) · [配置参考](configuration.md) · [隐私与运维](security.md)。默认兼容平台 HTTP / WS；公网 HTTPS 不会加密后端到平台的 HTTP 通信。

# 安装 OpenTYG

[English](deployment.en.md) · [返回 README](../README.md)

适用于 Linux 服务器和 NAS。支持 amd64 / arm64，不用下载源码。

## 1. 准备

在设备上安装并启动 **Docker 和 Docker Compose 插件**，准备好自己的 HTTPS 域名与证书。在设备终端或 SSH 中执行下面命令。

## 2. 运行安装向导

```sh
curl -fsSL -o install.sh https://raw.githubusercontent.com/zjmdong/OpenTYG/main/install.sh && bash install.sh
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

**升级**：先备份，在 `docker-compose.yml` 中修改 `image` 的版本号，然后：

```sh
sudo docker compose pull
sudo docker compose up -d
```

**备份 / 迁移**：停服，备份 Compose 文件及其中指定的数据目录、密钥文件（包含隐藏文件）；自定义目录也要一起备份。恢复时保留原密钥、文件所有者和权限。同一数据目录只运行一个实例。

**打不开 / 403 / 502**：检查容器状态、反代目标、证书，以及公网地址和 Host 的端口是否一致。内部 HTTP 只供反代连接；登录请使用 HTTPS。

更多：[Nginx 示例](../deploy/nginx-opentyg.conf) · [配置参考](configuration.md) · [隐私与运维](security.md)。默认兼容平台 HTTP / WS；公网 HTTPS 不会加密后端到平台的 HTTP 通信。

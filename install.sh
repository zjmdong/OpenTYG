#!/usr/bin/env bash
# OpenTYG guided installer for Linux. MIT; see the repository LICENSE.
set -Eeuo pipefail
umask 077
LANGUAGE=zh
case "${1:-}" in
  '') ;;
  --lang=en) LANGUAGE=en ;;
  *) printf 'Usage: bash install.sh [--lang=en]\n' >&2; exit 1 ;;
esac
msg() { if [[ "$LANGUAGE" == en ]]; then printf '%s\n' "$2"; else printf '%s\n' "$1"; fi; }
die() { msg "$1" "$2" >&2; exit 1; }
ask() {
  local answer label
  if [[ "$LANGUAGE" == en ]]; then label=$3; else label=$2; fi
  printf '%s [%s]: ' "$label" "$4"
  IFS= read -r answer || die '输入已结束，安装停止。' 'Input ended; installation stopped.'
  printf -v "$1" '%s' "${answer:-$4}"
}
trap 'msg "操作失败，请检查上方提示后重新运行。已有数据和密钥会保留。" "Operation failed. Check the message above and retry; existing data and secrets are preserved." >&2' ERR
[[ "$(uname -s)" == Linux ]] || die '此脚本适用于 Linux / NAS，请在部署设备的终端运行。' 'Run this installer in a Linux / NAS terminal.'
for tool in docker openssl stat mktemp find; do
  command -v "$tool" >/dev/null || die "缺少 $tool，请先安装。" "Install the missing tool: $tool."
done
if [[ "$(id -u)" != 0 ]]; then
  command -v sudo >/dev/null || die '需要 sudo 设置数据权限，请联系管理员。' 'sudo is required to prepare storage permissions.'
  exec sudo bash -- "$0" "$@"
fi
ADMIN=()
DOCKER=(docker)
if ! docker info >/dev/null 2>&1; then
  if "${ADMIN[@]}" docker info >/dev/null 2>&1; then DOCKER=("${ADMIN[@]}" docker)
  else die 'Docker 未启动或无法访问，请先在设备上启用 Docker。' 'Start Docker and ensure it is accessible.'; fi
fi
"${DOCKER[@]}" compose version >/dev/null || die '请先安装 Docker Compose 插件。' 'Install the Docker Compose plugin first.'

# Quote paths for YAML, and escape Compose interpolation. Never evaluate input.
yaml_string() {
  local value=$1
  value=${value//\\/\\\\}; value=${value//\"/\\\"}; value=${value//\$/\$\$}
  printf '"%s"' "$value"
}
check_path() {
  [[ "$1" == /* && "$1" != *[$'\r\n\t']* ]] || die '请填写绝对路径，例如 /opt/opentyg/data。' 'Enter an absolute path, for example /opt/opentyg/data.'
  case "${1%/}" in
    ''|/etc|/usr|/var|/home|/root|/opt|/srv|/tmp|/dev|/proc|/sys)
      die '请选择专用于 OpenTYG 的子目录，不要选择系统目录。' 'Choose a dedicated OpenTYG subdirectory, not a system directory.' ;;
  esac
}
directory() {
  check_path "$2"
  (umask 022; "${ADMIN[@]}" mkdir -p -m 0755 -- "$2")
  local resolved
  resolved=$(cd -- "$2" && pwd -P)
  check_path "$resolved"
  printf -v "$1" '%s' "$resolved"
}
valid_number() { [[ "$1" =~ ^[0-9]{1,5}$ ]] && ((10#$1 >= 1 && 10#$1 <= 65535)); }
valid_origin() {
  local host port label
  [[ "$1" =~ ^https://([A-Za-z0-9.-]+)(:([0-9]{1,5}))?$ ]] || return 1
  host=${BASH_REMATCH[1]}; port=${BASH_REMATCH[3]:-443}
  valid_number "$port" || return 1
  [[ ${#host} -le 253 && "$host" != *..* && "$host" != .* && "$host" != *. ]] || return 1
  local -a labels
  IFS=. read -r -a labels <<< "$host"
  for label in "${labels[@]}"; do
    [[ ${#label} -le 63 && "$label" =~ ^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?$ ]] || return 1
  done
}
valid_ip() {
  local octet first second
  local -a octets
  [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ && "$1" != 0.0.0.0 ]] || return 1
  IFS=. read -r -a octets <<< "$1"
  for octet in "${octets[@]}"; do [[ "$octet" =~ ^(0|[1-9][0-9]{0,2})$ ]] && ((10#$octet <= 255)) || return 1; done
  first=$((10#${octets[0]})); second=$((10#${octets[1]}))
  ((first == 10 || (first == 172 && second >= 16 && second <= 31) || (first == 192 && second == 168) || (first == 100 && second >= 64 && second <= 127)))
}
start_service() {
  local -a compose=("${DOCKER[@]}" compose --project-directory "$INSTALL_DIR" -f "$CONFIG")
  "${compose[@]}" config --quiet
  msg '正在拉取镜像并启动……' 'Pulling the image and starting the app…'
  "${compose[@]}" pull opentyg
  "${compose[@]}" up -d opentyg
  local attempt
  for ((attempt=0; attempt<20; attempt++)); do
    if "${compose[@]}" exec -T opentyg node deploy/healthcheck.mjs >/dev/null 2>&1; then
      msg '服务已启动，健康检查通过。' 'The app is running and its health check passed.'
      printf '\n%s\n' "$CONFIG"
      msg '日常管理：在上述文件所在目录执行 docker compose ps / logs / stop。没有 Docker 权限时加 sudo。' 'Manage the app in that directory with docker compose ps / logs / stop; add sudo if required.'
      return
    fi
    sleep 3
  done
  die '启动检查未通过。进入安装目录运行 docker compose logs --tail=50 opentyg，按提示排查；不要删除数据或密钥。' 'Startup check failed. Run docker compose logs --tail=50 opentyg in the installation directory; preserve data and secrets.'
}

msg 'OpenTYG 安装向导（回车使用默认值）' 'OpenTYG installer (Enter accepts the default)'
default_dir="$PWD/OpenTYG"
[[ ! -f "$PWD/docker-compose.yml" ]] || default_dir=$PWD
ask INSTALL_DIR '安装目录' 'Installation directory' "$default_dir"
new_install_dir=0
[[ -d "$INSTALL_DIR" ]] || new_install_dir=1
directory INSTALL_DIR "$INSTALL_DIR"
if [[ "$new_install_dir" == 1 ]]; then
  chown "${SUDO_UID:-0}:${SUDO_GID:-0}" "$INSTALL_DIR"
  chmod 750 "$INSTALL_DIR"
fi
CONFIG="$INSTALL_DIR/docker-compose.yml"
[[ ! -L "$CONFIG" ]] || die '配置文件不能是符号链接。' 'The configuration file must not be a symlink.'
if [[ -e "$CONFIG" ]]; then
  msg '发现已有配置。1：保留配置并启动；2：重新填写（原配置会备份）。' 'Existing configuration found. 1: keep it and start; 2: reconfigure (a backup is kept).'
  default_mode=1
  if ! "${DOCKER[@]}" compose --project-directory "$INSTALL_DIR" -f "$CONFIG" config --quiet >/dev/null 2>&1; then
    msg '现有配置尚未完成，建议重新填写。' 'Existing configuration is incomplete; reconfiguration is recommended.'
    default_mode=2
  fi
  ask MODE '请选择' 'Choose' "$default_mode"
  case "$MODE" in
    1) start_service; msg '请使用原 HTTPS 地址访问；反向代理设置保持原样。' 'Use your existing HTTPS address and reverse proxy settings.'; exit 0 ;;
    2) ;;
    *) die '请输入 1 或 2。' 'Enter 1 or 2.' ;;
  esac
fi

ask DATA_DIR '数据目录（已有服务请选原目录）' 'Data directory (keep the original for an existing service)' "$INSTALL_DIR/data"
directory DATA_DIR "$DATA_DIR"
ask SECRET_FILE '密钥文件（已有服务请选原文件）' 'Secret file (keep the original for an existing service)' "$INSTALL_DIR/secrets/opentyg_secret.txt"
check_path "$SECRET_FILE"
[[ ! -L "$SECRET_FILE" ]] || die '密钥文件不能是符号链接。' 'The secret file must not be a symlink.'
secret_parent=${SECRET_FILE%/*}; secret_name=${SECRET_FILE##*/}
[[ -n "$secret_name" && "$secret_name" != . && "$secret_name" != .. ]] || die '请填写密钥文件路径。' 'Enter a secret file path.'
directory SECRET_DIR "$secret_parent"
SECRET_FILE="$SECRET_DIR/$secret_name"
[[ "$DATA_DIR" != "$INSTALL_DIR" && "$SECRET_DIR" != "$INSTALL_DIR" && "$DATA_DIR" != "$SECRET_DIR" && "$DATA_DIR" != "$CONFIG" && "$SECRET_FILE" != "$CONFIG" ]] || die '安装、数据、密钥应使用分开的目录。' 'Keep installation, data, and secret directories separate.'
if "${ADMIN[@]}" test -e "$SECRET_FILE"; then
  "${ADMIN[@]}" test -f "$SECRET_FILE" || die '密钥路径不是普通文件。' 'The secret path is not a regular file.'
  size=$("${ADMIN[@]}" stat -c %s "$SECRET_FILE")
  ((size >= 32)) || die '已有密钥文件过短或为空。请恢复原密钥，不要覆盖。' 'Existing secret is empty or too short. Restore the original; do not overwrite it.'
else
  contents=$("${ADMIN[@]}" find "$DATA_DIR" -mindepth 1 -maxdepth 1 -print -quit)
  [[ -z "$contents" ]] || die '数据目录已有文件但未找到原密钥。请选择原密钥文件，避免数据无法解密。' 'Existing data has no matching secret. Select the original secret file.'
fi
contents=$("${ADMIN[@]}" find "$DATA_DIR" -mindepth 1 -maxdepth 1 -print -quit)
[[ -z "$contents" ]] || "${ADMIN[@]}" test -f "$DATA_DIR/.app-secret" || die '该目录已有文件，但不是已初始化的 OpenTYG 数据目录，请选择空目录或原数据目录。' 'This nonempty directory is not initialized OpenTYG storage. Choose an empty directory or the original data directory.'
secret_contents=$("${ADMIN[@]}" find "$SECRET_DIR" -mindepth 1 -maxdepth 1 ! -name "$secret_name" -print -quit)
[[ -z "$secret_contents" ]] || die '密钥目录还有其他文件。请将原密钥文件保留在独立的密钥目录中，再填写路径。' 'Use a dedicated secret directory containing only the original secret file.'
while :; do
  ask PUBLIC_ORIGIN '公网 HTTPS 地址（例如 https://opentyg.example.com:8443）' 'Public HTTPS address (e.g. https://opentyg.example.com:8443)' ''
  PUBLIC_ORIGIN=${PUBLIC_ORIGIN%/}
  valid_origin "$PUBLIC_ORIGIN" && break
  msg '请填写 https://域名，可带端口，不带路径。' 'Enter https://domain, with an optional port and no path.'
done
msg '反向代理位置：1 本机直接运行；2 NAS 反代 / 其他容器 / 其他内网设备。' 'Reverse proxy: 1 directly on this host; 2 NAS proxy / another container / another LAN device.'
ask PROXY_MODE '请选择' 'Choose' 1
case "$PROXY_MODE" in
  1) BIND_IP=127.0.0.1 ;;
  2) while :; do
       ask BIND_IP '此 Docker 主机的内网 IPv4 地址' 'LAN IPv4 address of this Docker host' ''
       valid_ip "$BIND_IP" && break
       msg '请填写本机实际内网 IPv4 地址。' 'Enter the actual LAN IPv4 address of this host.'
     done ;;
  *) die '请输入 1 或 2。' 'Enter 1 or 2.' ;;
esac
while :; do
  ask APP_PORT '内网服务端口' 'Internal service port' 8080
  valid_number "$APP_PORT" && break
  msg '端口范围为 1–65535。' 'Use a port between 1 and 65535.'
done
while :; do
  ask VERSION '镜像版本' 'Image version' 1.2.4
  [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ || "$VERSION" == latest ]] && break
  msg '请输入版本号，例如 1.2.4，或 latest。' 'Enter a release version, such as 1.2.4, or latest.'
done
default_uid=${SUDO_UID:-$(id -u)}; default_gid=${SUDO_GID:-$(id -g)}
if [[ "$default_uid" == 0 || "$default_gid" == 0 ]]; then default_uid=10001; default_gid=10001; fi
if "${ADMIN[@]}" test -f "$DATA_DIR/.app-secret"; then
  default_uid=$("${ADMIN[@]}" stat -c %u "$DATA_DIR/.app-secret")
  default_gid=$("${ADMIN[@]}" stat -c %g "$DATA_DIR/.app-secret")
fi
while :; do
  ask IDENTITY '运行用户 UID:GID（默认沿用当前用户或已有数据）' 'Runtime UID:GID (current user or existing data owner)' "$default_uid:$default_gid"
  if [[ "$IDENTITY" =~ ^([0-9]{1,9}):([0-9]{1,9})$ ]]; then
    APP_UID=${BASH_REMATCH[1]}; APP_GID=${BASH_REMATCH[2]}
    ((10#$APP_UID > 0 && 10#$APP_GID > 0)) && break
  fi
  msg '请输入非 root 的数字 UID:GID，例如 1000:1000。' 'Enter non-root numeric UID:GID, for example 1000:1000.'
done
APP_UID=$((10#$APP_UID)); APP_GID=$((10#$APP_GID)); APP_PORT=$((10#$APP_PORT))
wrong_owner=$("${ADMIN[@]}" find "$DATA_DIR" -mindepth 1 \( ! -uid "$APP_UID" -o ! -gid "$APP_GID" \) -print -quit)
[[ -z "$wrong_owner" ]] || die '已有数据的所有者不匹配。请使用原 UID:GID，脚本不会批量更改已有文件。' 'Existing data ownership differs. Use its original UID:GID; existing files will not be recursively changed.'
# Refuse a second running instance or accidental takeover of another deployment.
if "${DOCKER[@]}" inspect opentyg >/dev/null 2>&1; then
  previous_dir=$("${DOCKER[@]}" inspect --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' opentyg)
  [[ "$previous_dir" == "$INSTALL_DIR" ]] || die '已有 opentyg 容器在其他目录。请到原安装目录运行，或先按部署指南迁移。' 'An opentyg container belongs to another directory. Use its original installation directory or migrate it first.'
fi
msg '即将安装：' 'Ready to install:'
printf '  %s\n  %s\n  %s\n  %s\n' "$INSTALL_DIR" "$DATA_DIR" "$PUBLIC_ORIGIN" "http://$BIND_IP:$APP_PORT (UID:GID $APP_UID:$APP_GID)"
ask CONFIRM '回车安装，输入 n 取消' 'Enter to install, n to cancel' y
[[ "$CONFIRM" == y || "$CONFIRM" == Y ]] || { msg '已取消。' 'Cancelled.'; exit 0; }

# Existing secrets are never regenerated; create a new one atomically, without overwrite.
temporary=''
cleanup() { [[ -z "$temporary" ]] || "${ADMIN[@]}" rm -f -- "$temporary"; }
trap cleanup EXIT
"${ADMIN[@]}" chown "$APP_UID:$APP_GID" "$DATA_DIR" "$SECRET_DIR"
"${ADMIN[@]}" chmod 700 "$DATA_DIR" "$SECRET_DIR"
if ! "${ADMIN[@]}" test -e "$SECRET_FILE"; then
  temporary=$("${ADMIN[@]}" mktemp "$SECRET_DIR/.opentyg-secret.XXXXXX")
  openssl rand -base64 32 | "${ADMIN[@]}" tee "$temporary" >/dev/null
  "${ADMIN[@]}" chown "$APP_UID:$APP_GID" "$temporary"
  "${ADMIN[@]}" chmod 600 "$temporary"
  "${ADMIN[@]}" ln -- "$temporary" "$SECRET_FILE"
  cleanup; temporary=''
fi
"${ADMIN[@]}" chown "$APP_UID:$APP_GID" "$SECRET_FILE"
"${ADMIN[@]}" chmod 600 "$SECRET_FILE"

temporary=$(mktemp "$INSTALL_DIR/.opentyg-compose.XXXXXX")
cat > "$temporary" <<EOF
# Generated by the OpenTYG installer. Keep this file, data, and the secret together.
name: opentyg
services:
  opentyg:
    image: ghcr.io/zjmdong/opentyg:$VERSION
    container_name: opentyg
    restart: unless-stopped
    init: true
    user: "$APP_UID:$APP_GID"
    read_only: true
    cap_drop: [ALL]
    security_opt: [no-new-privileges:true]
    pids_limit: 100
    mem_limit: 512m
    cpus: 1.0
    stop_grace_period: 30s
    ports:
      - "$BIND_IP:$APP_PORT:8787"
    environment:
      PUBLIC_ORIGIN: "$PUBLIC_ORIGIN"
      COOKIE_SECURE: "1"
      APP_SECRET_FILE: /run/secrets/opentyg_secret
      TYG_ORIGIN: http://lxj.taoyuangu.com:80
      UPSTREAM_ALLOWED_HOSTS: lxj.taoyuangu.com,uums.taoyuangu.com,sso.taoyuangu.com
      ALLOW_INSECURE_UPSTREAM: "1"
      LOCAL_TEST_MODE: "0"
      LOG_QUIET: "0"
    secrets: [opentyg_secret]
    volumes:
      - type: bind
        source: $(yaml_string "$DATA_DIR")
        target: /data
        bind:
          create_host_path: false
    tmpfs: ["/tmp:rw,noexec,nosuid,size=16m"]
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
secrets:
  opentyg_secret:
    file: $(yaml_string "$SECRET_FILE")
EOF
"${DOCKER[@]}" compose --project-directory "$INSTALL_DIR" -f "$temporary" config --quiet
if [[ -f "$CONFIG" ]]; then
  cp -p -- "$CONFIG" "$CONFIG.$(date +%Y%m%d-%H%M%S).bak"
fi
mv -- "$temporary" "$CONFIG"; temporary=''
chown "${SUDO_UID:-0}:${SUDO_GID:-0}" "$CONFIG"
chmod 600 "$CONFIG"
start_service
msg '最后一步：在反向代理中设置下面的 HTTPS 地址和 HTTP 目标，保留 Host（含外部端口）和 Origin，关闭缓存。' 'Final step: configure the HTTPS address and HTTP target below in your reverse proxy. Preserve Host (including the public port) and Origin, and disable caching.'
printf '  %s → http://%s:%s\n' "$PUBLIC_ORIGIN" "$BIND_IP" "$APP_PORT"
msg '路由器只转发 HTTPS 端口到反向代理。证书生效后，用上述 HTTPS 地址访问并安装到手机。' 'Forward only the HTTPS port to the proxy. Once its certificate is valid, open the HTTPS address and install on your phone.'

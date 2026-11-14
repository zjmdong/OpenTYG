# Configuration

[Docs](README.en.md) / Configuration · [简体中文](configuration.md)

## Choose the configuration you use

- **Installer output**: values are written directly into the generated `docker-compose.yml`. No `.env` is needed; edit that file for later changes.
- **Repository template**: [docker-compose.yml](../docker-compose.yml) takes environment variables or an optional `.env`. See [.env.example](../.env.example).

Both enable Secure cookies in production, disable local development mode, and mount the secret from a separate file.

## Compose variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `PUBLIC_ORIGIN` | `Required` | Exact browser-facing HTTPS origin, including a nonstandard port, without a path. |
| `LAN_BIND_IP` | `127.0.0.1` | Host HTTP binding; use a controlled private address for a remote proxy. |
| `APP_PORT` | `8080` | Host port mapped to container port 8787. |
| `APP_DATA_DIR` | `./data` | Data bind mount; create before first start. |
| `APP_SECRET_PATH` | `./secrets/opentyg_secret.txt` | Path to the original external secret file. |
| `APP_UID / APP_GID` | `10001 / 10001` | Numeric container identity; match data and secret ownership. |
| `OPENTYG_VERSION` | `1.2.5` | Public image version; pin a release, or use latest for the stable image. |
| `NODE_IMAGE` | `node:24-alpine` | Source-build override only; optionally pin a compatible official image digest. |
| `TYG_ORIGIN` | `http://lxj.taoyuangu.com:80` | Platform bootstrap origin; changing it may invalidate saved login state. |
| `UPSTREAM_ALLOWED_HOSTS` | `See below` | Comma-separated exact hostnames, without wildcards, schemes, or ports. |
| `ALLOW_INSECURE_UPSTREAM` | `1` | Allow HTTP / WS on listed hosts; 0 requires HTTPS / WSS. |
| `LOG_QUIET` | `0` | 1 suppresses application logs; startup messages may remain. |

Default upstream host list:

```text
lxj.taoyuangu.com,uums.taoyuangu.com,sso.taoyuangu.com
```

Dynamic endpoints must pass the same hostname and protocol checks. Verify ownership before adding a host. Do not bypass TLS verification with `NODE_TLS_REJECT_UNAUTHORIZED=0`. See [network boundaries](security.en.md#network-and-launch-checks) for HTTP compatibility.

For manual deployment, create the data directory and a random secret of at least 32 bytes. The selected UID:GID must be able to write data and read the secret. Use `0700` for new private directories and `0600` for the secret file. Existing deployments must keep their original secret; generating a new one does not repair unreadable encrypted data.

## Run Node.js directly

Requires **Node.js 24+**, without `npm install` or a frontend build.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8787` | Node listener port. |
| `HOST` | `0.0.0.0` | Node bind address. |
| `DATA_DIR` | `Project data/` | Persistent directory exclusively owned by this instance. |
| `APP_SECRET_FILE` | `None` | Readable file containing a random secret of at least 32 bytes. |
| `APP_SECRET` | `None` | Environment alternative, mutually exclusive with APP_SECRET_FILE; prefer the file. |
| `PUBLIC_ORIGIN` | `None` | Required HTTPS origin in production. |
| `COOKIE_SECURE` | `From origin` | Must be 1 in production. |
| `LOCAL_TEST_MODE` | `0` | Only 1 enables the loopback HTTP development exception. |

`TYG_ORIGIN`, `UPSTREAM_ALLOWED_HOSTS`, `ALLOW_INSECURE_UPSTREAM`, and `LOG_QUIET` also apply. Direct startup rejects HTTP upstreams by default; explicitly set `ALLOW_INSECURE_UPSTREAM=1` for compatibility. Compose defaults are not inherited.

`--port`, `--host`, `--data`, and `--origin` override the listener port, address, data directory, and **upstream origin**, for example `--port=8787`. The `--origin` flag is not `PUBLIC_ORIGIN`. Plain Node startup does not load `.env`. `APP_PORT`, `APP_UID`, `APP_GID`, and `LAN_BIND_IP` configure Compose only.

## Local development

This Linux / macOS shell example uses separate data and secrets. Create the secret once and reuse it on later starts; the creation command refuses to overwrite an existing file.

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

Open `http://127.0.0.1:8787`. Local mode still validates Host, Origin, and request markers, and refuses wildcard or LAN binding. Always use production HTTPS settings for public deployment.

**This is live mode**: no demo accounts are included. Sign-in and door operations contact the real platform. Use authorized accounts and verify hardware actions in a controlled setting.

## Build from source

Configure the repository template variables, data directory, and secret, then run at the repository root:

```sh
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

Source builds use the repository template and override file. Installer-generated configuration pulls a published image.

Next: [Architecture](architecture.en.md) · [Privacy and operations](security.en.md) · [Troubleshooting](deployment.en.md#troubleshooting)

# Deployment guide

[简体中文](deployment.md) · [Back to README](../README.en.md)

This guide uses a Linux host, Docker Compose, and an HTTPS reverse proxy. It applies to personal servers, cloud hosts, and Docker-capable devices. Replace `opentyg.example.com` with your own domain.

## 1. Prerequisites

Prepare Docker Engine with the Compose plugin and Linux container support, OpenSSL, curl, unzip, sha256sum, a domain, and a trusted TLS certificate with renewal configured. Use a supported current Docker release. You also need an existing Taoyuangu account with valid property and door permissions, and outbound access to the configured platform HTTP/HTTPS and WebSocket services.

```sh
docker version
docker compose version
openssl version
```

If your user cannot manage Docker, follow your operating system's Docker setup instructions or prefix Docker commands with `sudo`. Grant Docker administration privileges only to trusted administrators.

## 2. Download deployment files

```sh
mkdir -p OpenTYG
cd OpenTYG
curl -fL -o OpenTYG-deploy-v1.2.1.zip https://github.com/zjmdong/OpenTYG/releases/download/v1.2.1/OpenTYG-deploy-v1.2.1.zip
curl -fL -o DEPLOY-SHA256SUMS.txt https://github.com/zjmdong/OpenTYG/releases/download/v1.2.1/DEPLOY-SHA256SUMS.txt
sha256sum -c DEPLOY-SHA256SUMS.txt
unzip OpenTYG-deploy-v1.2.1.zip
cp .env.example .env
```

Use a permanent directory, since persistent data and secrets will live here. Avoid automatically cleaned temporary directories.

The bundle contains Compose configuration, an environment template, a reverse-proxy example, deployment instructions, and licensing files. It contains no application source, accounts, user data, or secrets. If SHA256 verification fails, download again before continuing. You can also download and extract the Release attachment in a browser.

## 3. Configure the application

Open `.env` in a text editor and set at least:

```dotenv
PUBLIC_ORIGIN=https://opentyg.example.com
LAN_BIND_IP=127.0.0.1
APP_PORT=8080
APP_UID=10001
APP_GID=10001
```

`PUBLIC_ORIGIN` must match the browser's scheme, domain, and port. Do not include a path, query, or `/#/home`. Omit the standard HTTPS port 443, or specify a nonstandard port, for example `https://opentyg.example.com:8443`. Public and internal ports may differ.

The default binding is for a reverse proxy running directly on the same host. If the proxy is on another device, set `LAN_BIND_IP` to the Docker host's actual private IP and allow only that proxy to reach `APP_PORT` through your firewall. Never forward the internal HTTP port to the internet. See [Docker's port publishing documentation](https://docs.docker.com/engine/network/port-publishing/) and keep Docker updated, as older releases have differences in loopback isolation.

See [configuration](configuration.md) for other variables. Do not add real account credentials or tokens to `.env`.

## 4. Generate the application secret

Run this **only for the first deployment**:

```sh
mkdir -p data secrets
(umask 077; set -C; openssl rand -base64 32 > secrets/opentyg_secret.txt)
```

This does not print the secret and refuses to overwrite an existing file. Preserve existing secrets instead of deleting and regenerating them. If OpenSSL fails, check whether the newly created file is empty and fix the cause before first startup. The application requires a random external secret of at least 32 bytes.

The application stores a data encryption key, wrapped with this external secret, in `data/.app-secret`. Both are required to recover existing data. Losing or replacing either prevents normal decryption.

Compose mounts the file at `/run/secrets/opentyg_secret`. File-based secrets in ordinary Compose do not encrypt the host source file; protect its permissions and backups. See [Docker's secrets documentation](https://docs.docker.com/compose/how-tos/use-secrets/).

## 5. Prepare filesystem permissions

The default container identity is `10001:10001`:

```sh
sudo chown -R 10001:10001 data secrets
sudo chmod 700 data secrets
sudo chmod 600 secrets/opentyg_secret.txt
```

To run under your own host user's numeric identity, read it with `id -u` and `id -g`, set `APP_UID` and `APP_GID` in `.env`, and use those same numbers for ownership.

Containers do not inherit the terminal user's identity. Removing the Compose `user` line falls back to the image's `10001:10001`. Public application files are made readable during image construction; only `data/` needs write access, and the secret needs read access. Avoid `chmod -R 777` or running the application as root to bypass permission errors. On ACL-managed hosts, also check parent directory and share access rules.

## 6. Pull and start

```sh
docker compose config --quiet
docker compose pull
docker compose up -d
docker compose ps
docker compose logs --tail=50 opentyg
curl -fsS http://127.0.0.1:8080/api/health
```

Adjust the curl address if you changed the binding or port. A healthy response contains `ok: true` and `status: "ok"`. The probe checks the local service and known storage failures; it does not verify platform availability or a physical lock.

Prebuilt images are published in this project’s public GitHub Container Registry as `ghcr.io/zjmdong/opentyg:1.2.1`, supporting `linux/amd64` and `linux/arm64`. Docker selects the matching architecture. No GitHub login, source checkout, or local build is required. The container defaults to a non-root identity, a read-only root filesystem, and persistent storage mounted at `/data`.

## 7. Configure HTTPS

```text
Phone browser / PWA
    ↓ HTTPS
Reverse proxy with TLS certificate
    ↓ HTTP over loopback or a controlled private network
Docker host:8080 → container:8787
    ↓ Platform HTTP / WS, or available HTTPS / WSS
Taoyuangu services
```

For Nginx running directly on the Docker host, use the [sample configuration](../deploy/nginx-opentyg.conf). Set the domain, certificate paths, and listener port as needed. Place the server block inside Nginx's `http` configuration, then validate and reload:

```sh
sudo nginx -t
sudo nginx -s reload
```

If Nginx is managed as a system service, you can use that service's reload command after validation. The certificate paths are examples; issuance and renewal are handled by your own certificate tooling.

Other proxies should follow these requirements:

| Setting | Requirement |
| --- | --- |
| Public protocol | HTTPS with a trusted certificate for your domain and a complete chain |
| Target | `http://127.0.0.1:8080` for a host-local proxy, or a restricted private address for a remote proxy |
| Host | Preserve the original browser Host, including a nonstandard port; use `$http_host` in Nginx |
| Origin | Preserve it unchanged; it must exactly match `PUBLIC_ORIGIN` |
| Paths | Serve the entire application at `/`; API, assets, and Service Worker share one origin |
| Cookies | Preserve `HttpOnly`, `Secure`, and `SameSite=Strict`; do not rewrite or remove attributes |
| Caching | Disable proxy/CDN caching for the API and application resources, including login and door responses |
| Timeouts | The example uses 120-second read/send timeouts |
| Logs | Do not record request bodies, cookies, Authorization, or upstream URLs containing tokens |

The backend connects to upstream door WebSockets. Browser-to-application traffic uses ordinary HTTP APIs, so do not expose upstream WebSocket or auxiliary service ports. Do not add cross-origin CORS, remove Origin validation, or disable Secure cookies.

If the proxy is another container, `127.0.0.1` points to that proxy container, not the Docker host. Join both containers to a dedicated Docker network and target `opentyg:8787`, or use the firewall-protected host private address. Preserve the public Host and Origin in either case.

## 8. DNS and public port forwarding

Point the domain's A record to your public IPv4 address. Add an AAAA record only if IPv6 listening and firewall access are configured. Dynamic public addresses may require your DNS provider's supported dynamic update mechanism.

Behind a router, forward the **public HTTPS port** to the reverse proxy's HTTPS listener. For example: external TCP 8443 → proxy TCP 443. Set `PUBLIC_ORIGIN=https://opentyg.example.com:8443` and preserve `:8443` in Host. Do not forward it to the application's HTTP port 8080.

Certificates validate domain names, not ports. Certificate issuance and renewal must still satisfy the chosen challenge method: HTTP-01 usually needs public port 80; DNS-01 needs DNS verification. Opening 8443 alone does not satisfy every certificate challenge.

If your connection is behind carrier-grade NAT, ordinary inbound forwarding may not work. Obtain an inbound-capable address from the provider or configure an appropriate secure ingress. For local access using the same public domain, use router loopback or split DNS while retaining the same HTTPS domain, port, and valid certificate.

**HTTPS termination does not encrypt backend-to-platform HTTP traffic.** The default `ALLOW_INSECURE_UPSTREAM=1` enables protocol compatibility for listed hosts, not an unrestricted proxy. See [privacy and operations](security.md).

## 9. Sign in and install on a phone

Open the public HTTPS address on a computer, confirm the page and certificate, and sign in with an existing account. Select the right property and verify doors, favorites, names, and ordering.

On Android, open the same HTTPS address in a supported browser and use the page's installation entry or browser menu. On iPhone, use Safari's **Share → Add to Home Screen**. Embedded browsers may not support installation; open the page in a system browser. Automatic prompts vary by browser. See [PWA installation conditions](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable).

Launch from the home screen and verify remembered login, connection preparation after returning to the foreground, and an authorized door operation. An acknowledgment does not guarantee the physical lock opened. For an unknown result, check the door before retrying; avoid repeated clicks as a network diagnostic.

## 10. Back up and restore

Back up `.env`, the entire `data/` including its hidden `.app-secret`, and `secrets/` together. Stop the container before a file backup for a consistent snapshot:

```sh
docker compose stop
(umask 077; sudo tar -czf - .env data secrets > "../opentyg-backup-$(date +%Y%m%d-%H%M%S).tar.gz")
docker compose start
```

If backup fails, investigate and restart the service. The archive lives outside the project but still contains private data and key material. Encrypt it separately, store it in a restricted independent location, and never upload it to GitHub. Record the corresponding image version and digest and periodically verify restoration.

To restore, stop the service, restore the complete set, fix ownership and restricted permissions to match `APP_UID:APP_GID`, and start a matching image version. Check health and login restoration. Do not restore only `users/`, omit hidden files, or replace the external secret. No automated key-rotation tool is included; rotation requires a planned re-encryption migration.

## 11. Upgrade

Back up first and review the release and runtime requirements. Set `OPENTYG_VERSION` in `.env` to the target release version, then run:

```sh
docker compose pull
docker compose up -d
docker compose ps
```

Verify the HTTPS page, remembered login, preferences, and connection recovery. Preserve `.env`, `data/`, `secrets/`, and the original secret. Do not repeat initial secret generation. Before rolling back, confirm storage-format compatibility or restore a matching backup.

## 12. Troubleshooting

| Symptom | Check |
| --- | --- |
| `EACCES` or restart loop | UID/GID, readable secret, writable data, host ACLs, and using the current published image |
| `APP_SECRET_MISMATCH` / `DATA_KEY_MISSING` | Restore original keys and the complete data directory; do not overwrite with new keys |
| Page or login returns 403 | Exact `PUBLIC_ORIGIN`, external Host/port, Origin, and proxy header rewriting |
| HTTPS page returns 502 | Container health, proxy target, Docker network, binding, and port |
| Login fails over internal HTTP | Use the configured HTTPS origin; production requires Secure cookies |
| Upstream connection failure | DNS, outbound connectivity, platform status, HTTP compatibility, and allowed host list |
| SMS or login is limited | Wait for the displayed remaining time; restart does not clear persistent limits |
| No install entry | Supported system browser and valid HTTPS; try the browser menu; prompting is browser-controlled |
| Cannot open a door offline | Reconnect; the application never stores or queues offline commands |

Inspect `docker compose logs --tail=100 opentyg` when needed and review logs for sensitive content before sharing. A successful local health probe does not establish upstream or lock health.

## 13. Image versions and source builds

`1.2.1` selects a release; `latest` follows future stable releases. Pin a version in production. Record the downloaded digest with `docker image inspect ghcr.io/zjmdong/opentyg:1.2.1 --format '{{json .RepoDigests}}'`, or use `ghcr.io/zjmdong/opentyg@sha256:actual-digest` in Compose to pin content.

To migrate an existing source-built deployment, stop and back up first, replace Compose with the image-based configuration, then pull and start. Preserve the original `.env`, `data/`, `secrets/`, and UID/GID. Only one instance may access a data directory.

Contributors may clone the full repository and run from its root:

```sh
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

The optional override builds locally; the deployment-only bundle has no build sources. The publication workflow builds from a release tag and checks startup and health on both native architectures before pushing to GHCR. The SDK branch does not publish an application container.

# Install OpenTYG

[简体中文](deployment.md) · [Back to README](../README.en.md)

For Linux servers and NAS devices. Supports amd64 / arm64; no source download is needed.

## 1. Prepare

Install and start **Docker and the Docker Compose plugin**, with curl and OpenSSL available. Prepare your HTTPS domain and certificate. Run the following command in the device's terminal or SSH session.

## 2. Run the installer

```sh
curl -fsSL -o install.sh https://raw.githubusercontent.com/zjmdong/OpenTYG/main/install.sh && bash install.sh --lang=en
```

Answer the prompts. Press Enter to accept the value in brackets:

| Prompt | What to enter |
| --- | --- |
| Installation directory | A permanent location for configuration |
| Data directory and secret file | Defaults for a new installation; original paths for an existing service |
| Public address | For example `https://opentyg.example.com:8443`, without a path |
| Proxy location | 1 for a proxy directly on this host; 2 for a NAS proxy, another container, or another device |
| LAN address | With option 2, the Docker host's actual LAN IP |
| Internal port, version, UID:GID | Usually accept defaults; identity defaults to the current user or existing data owner |

The script prepares permissions, creates a first-time secret, writes one `docker-compose.yml`, pulls the image, starts the app, and checks health. **No `.env` is needed.** If requested, enter your device administrator password; the app never stores it.

Existing configuration is kept by default; reconfiguration backs up the Compose file. Existing secrets are never regenerated. Missing keys or mismatched data ownership stop installation with an explanation.

## 3. Configure the HTTPS reverse proxy

Add a rule in your device's reverse-proxy tool:

- **Source:** the HTTPS domain and port entered during installation, with a valid certificate for that domain.
- **Target:** the `http://address:port` printed by the installer.
- **Headers and caching:** preserve Host (including the public port), Origin, and cookie attributes; disable caching.

For a proxy in another container, target the Docker host's LAN IP, not `127.0.0.1`. For a remote proxy, allow only the proxy to access the application's HTTP port.

Behind a router, forward the **public HTTPS port** to the **proxy's HTTPS port**. Example: public 8443 → proxy 443. Never forward it to the app's HTTP port 8080.

Point domain DNS to the public address and configure the certificate. Open the configured **HTTPS address** to sign in. Android: install from the browser menu. iPhone: Safari → Share → Add to Home Screen.

## 4. Manage the app

Run these commands in the installation directory:

```sh
sudo docker compose ps                      # Status
sudo docker compose logs --tail=50 opentyg  # Errors
sudo docker compose stop                    # Stop
sudo docker compose start                   # Start
```

**Upgrade:** back up, change the `image` version in `docker-compose.yml`, then:

```sh
sudo docker compose pull
sudo docker compose up -d
```

**Backup / migrate:** stop the app and back up Compose plus its configured data directory and secret file, including hidden files and custom paths. Preserve the original key, ownership, and permissions on restore. Run only one instance per data directory.

**Cannot open / 403 / 502:** check container status, proxy target, certificate, and matching public address and Host ports. Internal HTTP is for the proxy; sign in over HTTPS.

Opening the internal HTTP root address in a browser redirects to the configured HTTPS address. If that address is unreachable on your LAN, check NAT loopback or internal DNS and route the domain to the HTTPS proxy. Keep sign-in on HTTPS. APIs and static assets still require the correct Host; the proxy must preserve the browser-facing domain and port.

More: [Nginx example](../deploy/nginx-opentyg.conf) · [Configuration](configuration.md) · [Privacy and operations](security.md). Default platform HTTP / WS compatibility remains enabled; public HTTPS does not encrypt backend-to-platform HTTP.

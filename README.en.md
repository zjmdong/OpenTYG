<div align="center">
  <img src="web/icons/icon-192.png" width="96" height="96" alt="OpenTYG">
  <h1>OpenTYG</h1>
  <p>Your existing Taoyuangu door access, in a browser and on your home screen.</p>
  <p>
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License"></a>
    <img src="https://img.shields.io/badge/Node.js-24%2B-339933" alt="Node.js 24 or newer">
    <img src="https://img.shields.io/badge/mobile-PWA-5A0FC8" alt="Mobile PWA">
  </p>
  <p><a href="README.md">简体中文</a> · <strong>English</strong></p>
</div>

OpenTYG is a self-hosted web application for signing in with an existing Taoyuangu account, selecting a property, organizing frequently used doors, and requesting remote door access. One Node.js service hosts the frontend and backend. Deploy with Docker without a frontend build or a separate database.

This is an independent project with no affiliation to Taoyuangu. An existing account and valid door permissions are required; the application does not grant or bypass platform permissions. The application interface is currently in Simplified Chinese; project documentation is available in Chinese and English.

## Features

- **Mobile experience**: touch-friendly layouts, light and dark themes, PWA installation, and home screen instructions for iPhone.
- **Account sign-in**: SMS verification, password login, platform-required device verification, and optional remembered sessions.
- **Properties and doors**: switch between authorized properties, drag to reorder, rename doors, and keep up to five favorites on the home screen.
- **Connection preparation**: prepare door connections after login and when returning to the foreground; check directory context and permissions before sending a command.
- **Private storage**: encrypt remembered login state and preferences on the server; upstream login tokens and door credentials are never returned to the browser.
- **Simple deployment**: one container, one port, no npm runtime dependencies, a health check, and an HTTPS reverse proxy example.

## Quick start

These commands target a Linux host with Docker Engine, the Compose plugin, Git, and OpenSSL. See the [deployment guide](docs/deployment.en.md) for complete instructions and alternatives.

```sh
git clone https://github.com/zjmdong/OpenTYG.git
cd OpenTYG
cp .env.example .env
```

Edit `.env` and set `PUBLIC_ORIGIN` to your public HTTPS address, for example `https://opentyg.example.com`. Include a nonstandard port when applicable, such as `https://opentyg.example.com:8443`.

For the first deployment, generate a secret and prepare permissions for the default container user:

```sh
mkdir -p data secrets
(umask 077; set -C; openssl rand -base64 32 > secrets/opentyg_secret.txt)
sudo chown -R 10001:10001 data secrets
sudo chmod 700 data secrets
sudo chmod 600 secrets/opentyg_secret.txt
docker compose up -d --build
curl -fsS http://127.0.0.1:8080/api/health
```

The generation command refuses to overwrite an existing secret. **Preserve the original `data/` and `secrets/` during upgrades and migrations; do not regenerate the secret.** If you change the UID/GID in `.env`, update the ownership of both directories and the secret file to match.

Configure your domain, a valid certificate, and an HTTPS reverse proxy targeting `http://127.0.0.1:8080`. A [sample Nginx configuration](deploy/nginx-opentyg.conf) is included. By default the HTTP port is bound to loopback; users access the configured HTTPS origin. Opening the internal HTTP address directly does not support production login.

## Install on a phone

Open the HTTPS site in a supported Android browser and use the installation entry or the browser's install menu. On iPhone, use Safari's **Share → Add to Home Screen**. Automatic installation prompts depend on the browser's own policies.

Once installed, the application opens in a standalone window from the home screen. Door access requires a network connection. The offline page only asks you to reconnect; it never caches account data or queues or replays door commands.

## Documentation

| Document | Contents |
| --- | --- |
| [Deployment](docs/deployment.en.md) / [中文](docs/deployment.md) | Docker, HTTPS, port forwarding, mobile installation, upgrades, and troubleshooting |
| [Configuration](docs/configuration.md) | Environment variables, runtime identity, upstream hosts, and local development |
| [Architecture](docs/architecture.md) | Browser, backend, platform services, and storage |
| [Privacy and operations](docs/security.md) | Credential lifecycle, encryption boundaries, backup, and recovery |
| [API reference](docs/api.md) | Sessions, directory context, door operations, and errors |

## Security and operational boundaries

Production browser connections require HTTPS. The default upstream configuration permits HTTP/WS for compatibility. Public HTTPS protects the browser-to-proxy connection; it cannot encrypt backend communication with an HTTP upstream. Evaluate this boundary for your network and restrict the upstream host list. Disable HTTP compatibility if a verified HTTPS/WSS upstream becomes available.

A successful platform acknowledgment does not guarantee that a physical lock opened. A connection loss or timeout after sending produces an unknown result, and the application does not resend automatically. Check the door before deciding whether to try again.

Storage is designed for a single instance. Do not run multiple processes or containers against the same data directory. Never upload `data/`, `secrets/`, `.env`, certificate private keys, or runtime logs to a repository.

## Contributing

Use [Issues](https://github.com/zjmdong/OpenTYG/issues) for ordinary bug reports and suggestions, and Pull Requests for contributions. Read [CONTRIBUTING.md](CONTRIBUTING.md) first. For security concerns, follow [SECURITY.md](SECURITY.md) and do not publish account details, tokens, or sensitive reproduction information.

## License

OpenTYG source code is distributed under the [MIT License](LICENSE). This license does not cover third-party platform services, accounts, door hardware, or trademarks.

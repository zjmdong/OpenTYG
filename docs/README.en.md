# OpenTYG documentation

[Project home](../README.en.md) · [简体中文](README.md)

Start with deployment for a new installation. For an existing service, jump to upgrades, backups, and troubleshooting.

## Deploy and use

- **[Deployment](deployment.en.md)** — Installer, HTTPS proxy, mobile installation, upgrades, and troubleshooting.
- **[Configuration](configuration.en.md)** — Compose template, environment variables, secrets, and local development.
- **[Privacy and operations](security.en.md)** — Session lifetimes, stored data, encryption boundaries, rate limits, and backups.

## Develop and contribute

- **[Architecture](architecture.en.md)** — Data flow, source layout, SDK relationship, and connection recovery.
- **[How it works](how-it-works.en.md)** — Door sequence, dispatch boundary, and session restoration.
- **[Backend API](api.en.md)** — Sessions, properties, directories, door commands, and errors.
- **[Contributing](../CONTRIBUTING.en.md)** — Local setup, verification, and reporting issues.

## Web app or standalone SDK?

| Project | Intended use | Interface |
| --- | --- | --- |
| Current `main` branch | Deploy the web client or change its UI/backend | Same-origin `/api/*` with cookie sessions |
| [`opentyg-sdk` branch](https://github.com/zjmdong/OpenTYG/tree/opentyg-sdk) | Build a client or study the platform protocol | Platform HTTP, WebSocket, XML, SIP / RTP |

The web app embeds an adapted SDK with host restrictions, stable door identifiers, and credential-handling changes. It is not identical to the standalone branch. The web app currently offers door access only; the standalone SDK's intercom capability is not exposed by the web app. See the [SDK platform API reference](https://github.com/zjmdong/OpenTYG/blob/opentyg-sdk/docs/platform-api.md).

[Security reporting](../SECURITY.md) · [Disclaimer](../DISCLAIMER.md) · [MIT License](../LICENSE)

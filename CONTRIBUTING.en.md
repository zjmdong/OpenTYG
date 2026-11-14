# Contributing

[Project home](README.en.md) · [Docs](docs/README.en.md) · [简体中文](CONTRIBUTING.md)

Bug reports, ideas, and focused Pull Requests are welcome.

## Report a problem

Search existing issues first. Include the version, browser, deployment method, reproduction steps, and expected versus actual behavior. Remove accounts, property addresses, cookies, tokens, and keys from evidence. Use the [security reporting process](SECURITY.md) for vulnerabilities; do not publish exploitable details.

## Local development

1. Use **Node.js 24+** and the [loopback setup](docs/configuration.en.md#local-development) with separate development data and secrets.
2. Run `node server/index.mjs`; no `npm install` or frontend build is needed.
3. Find the relevant module in [Architecture](docs/architecture.en.md) and check interactions against the [API contract](docs/api.en.md).

No demo accounts are included. Real sign-in and door commands contact the platform and hardware. Use authorized accounts and a controlled physical setting.

## Before submitting

- Describe the problem, behavior changes, and verification performed. Update the relevant Chinese and English documentation.
- Check changed JavaScript with `node --check path/to/file`. CI [Verify](.github/workflows/verify.yml) also checks the container and installer.
- For authentication, directory, door, or storage changes, verify success/failure paths, account isolation, permissions, and restoration. Check UI changes at mobile sizes and in both themes.
- For documentation, check local links, code blocks, and rendered Markdown. Use clearly labeled fictional screenshot data.

The current `package.json` provides only a start script, not `npm test`. Describe the checks you actually performed in your PR.

## Preserve these contracts

Do not replay sent door commands, add offline command queues, log credentials, or store upstream secrets in the browser. One process owns each data directory. Explain compatibility and recovery when changing persistent formats.

Do not commit `.env`, runtime state, secrets, logs, customer data, APKs, backups, or temporary test reports. Contribute only code and assets you may redistribute under the project's [MIT License](LICENSE).

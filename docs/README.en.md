# TYG Core SDK documentation

[Project home](../README.en.md) · [简体中文](README.md)

Start with the SDK reference to use the library, or the platform references to implement your own protocol client.

## Understand and integrate

- **[Architecture](architecture.en.md)** — Modules, state, transport boundaries, and differences from main.
- **[How it works](how-it-works.en.md)** — Door sequence, intercom, saved login, and restoration.
- **[SDK reference](sdk-reference.en.md)** — Options, methods, events, errors, and cleanup.
- **[Read-only example](../examples/list-doors.mjs)** — Counts authorized doors without SMS or door commands.

## Platform protocols

| Reference | Contents |
| --- | --- |
| [HTTP / WebSocket](platform-api.md) | Discovery, three credential roles, ten JSON POST paths, directory/door messages |
| [OpenAPI 3.1](platform-openapi.json) | Importable HTTP fields; excludes WS, XML, and SIP/RTP |
| [XML / SIP / RTP](intercom-protocol.md) | Five XML provisioning messages, registration/calls, media, NAT traversal |

Detailed protocol references use Chinese explanations with English headings and wire names. They are independently maintained against Android client 1.3.8 and SDK v0.3.4. Platform fields, SDK return types, and web-app APIs are separate layers.

## Integration and maintenance

- [Security and integration](security.en.md): secrets, limits, outbound networking, media authorization, and storage.
- [Contributing](../CONTRIBUTING.md): target `opentyg-sdk` and explain protocol evidence and verification.
- [Provenance](provenance.md): source baseline, hashes, and publication scope.
- [Third-party notices](../THIRD_PARTY_NOTICES.md) · [Disclaimer](../DISCLAIMER.md) · [Security reporting](../SECURITY.md).

For a deployable web client, see [main](https://github.com/zjmdong/OpenTYG/tree/main). Do not interchange the two SDK implementations directly.

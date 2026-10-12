<div align="center">
  <h1>TYG Core SDK</h1>
  <p>An unofficial Node.js protocol SDK for authorized Taoyuangu door access and intercom development.</p>
  <p><a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT"></a> <img src="https://img.shields.io/badge/SDK-0.3.4-blue" alt="SDK 0.3.4"> <img src="https://img.shields.io/badge/Node.js-22.4%2B-339933" alt="Node.js 22.4 or newer"></p>
  <p><a href="README.md">简体中文</a> · <strong>English</strong></p>
</div>

This branch publishes **TYG Core SDK v0.3.4**, the latest standalone SDK version organized for this project. This is not an official Taoyuangu SDK or platform version. It supports service discovery, captchas and login, property authorization, WebSocket door access, XML provisioning, SIP signaling, and RTP media integration. The protocol baseline is the Taoyuangu Android client 1.3.8; server behavior and hardware compatibility can change.

**This SDK and its documentation have no affiliation, partnership, or authorization relationship with Taoyuangu or its affiliates and are not officially endorsed or supported.** Protocol information is organized from publicly accessible client and related materials; the code is an independent adapter. Official APKs, decompiled source, native binary libraries, and real user credentials are not included. Public availability does not imply permission to use a service or redistribute materials. Use responsibly, only with accounts and devices you own or are explicitly authorized to operate. Users bear responsibility for their actions and consequences independently of the author. To the extent permitted by applicable law, the author and contributors accept no liability arising from use or misuse. See the [disclaimer](DISCLAIMER.md) and [provenance](docs/provenance.md).

## Start with the platform protocols

The focus is the **actual Taoyuangu platform endpoints and wire protocols**, so you can implement a client without this SDK. These references are independently maintained; they are **not official developer documentation or a platform stability commitment**.

| Reference | Contents |
| --- | --- |
| [Platform HTTP and WebSocket API](docs/platform-api.md) | Ten JSON POST endpoints, dynamic service hosts, credential roles, field tables, responses, door configuration, and commands |
| [HTTP OpenAPI 3.1](docs/platform-openapi.json) | Only the ten platform JSON HTTP routes; import with an OpenAPI 3.1 compatible tool |
| [XML / SIP / RTP / ICE protocols](docs/intercom-protocol.md) | Five XML message types, personal SIP credentials, registration, outbound calls, media, and limitations |
| [SDK reference](docs/sdk-reference.md) | `TygClient` methods, types, session storage, and error handling |
| [Security and integration](docs/security.md) | Secrets, plaintext upstream traffic, host controls, authentication limits, and command semantics |
| [Provenance](docs/provenance.md) / [Third-party notices](THIRD_PARTY_NOTICES.md) | Source boundaries, versions, and dependency licenses |

The platform protocols do not use `/api/clients/...`, `X-Local-Key`, or OpenTYG browser cookies. XML, WebSocket, and SIP/RTP are documented separately from the HTTP OpenAPI file. Business success codes differ by endpoint: SMS delivery uses `code=1`, while login uses `code=0`. Detailed protocol field descriptions are primarily in Chinese; identifiers, schemas, examples, and the integration overview are also usable from English.

## Capabilities and limits

- **Door access**: service discovery, human-entered captchas, SMS or password login, device verification, property permissions, door configuration, and individual door commands.
- **Intercom**: XML provisioning, UDP/IPv4 SIP, Digest authentication, outbound monitoring, G.711 audio, H.264 reception, RTCP, SDP renegotiation, and explicitly configured ICE/STUN/TURN.
- **Integration**: ES modules, TypeScript declarations, state and media events, and optional Windows DPAPI session storage.
- **Limits**: Node.js only; browsers cannot directly operate the SIP UDP adapter. One concurrent outbound call; no incoming-call acceptance, TCP/TLS SIP, SRTP, automatic backup-proxy switching, or proactive Session-Timer refresh. Extended voice and NAT traversal depend on the platform, device, and network and are not guaranteed on all installations.

## Install

Node.js 22.4 or newer is required; Node.js 24 is recommended. This version is distributed through Git, not the npm registry.

```sh
git clone --branch opentyg-sdk --single-branch https://github.com/zjmdong/OpenTYG.git OpenTYG-SDK
cd OpenTYG-SDK
npm ci --ignore-scripts
```

To use it in another Node.js project, check out the branch and install the local package:

```sh
npm install --ignore-scripts /path/to/OpenTYG-SDK
```

## Quick start

This example queries the authorized directory only. It **does not send SMS or open a door**. Obtain the password from secure user input or a credential store; never embed it in source, logs, or commits.

```js
import { TygClient } from 'tyg-core-sdk';

const sdk = new TygClient({ lastLoginOs: '4' });
try {
  await sdk.initialize();
  await sdk.loginPassword(accountFromSecureInput, passwordFromSecureInput);
  const households = await sdk.getHouseholds();
  const household = households.find(item => item.available);
  if (!household) throw new Error('No authorized property is available');
  const directory = await sdk.getDoors(household.id);
  // Present directory.doors and the current directory context to the user.
} finally {
  sdk.close(); // Local cleanup; use logout() for platform logout.
}
```

See [examples/list-doors.mjs](examples/list-doors.mjs) for a runnable read-only example. SMS flow: `createCaptcha → human reads and enters the image code → sendSms → human enters the SMS code → loginSms`. The SDK does not solve or bypass verification challenges. After an explicit user choice, call `openDoor` with the current `householdId`, `directoryId`, and `doorId`; see the [SDK reference](docs/sdk-reference.md).

## Relationship to the application

The [main branch](https://github.com/zjmdong/OpenTYG/tree/main) contains the deployable OpenTYG web/PWA application. This branch contains the SDK library and platform references, without a web server, customer configuration, runtime logs, or field reports. Main embeds a server-specific SDK adaptation, including stable door identifiers. This branch preserves the standalone v0.3.4 core source; do not replace main's vendor directory directly with it.

## Security, contributions, and license

This SDK is not a complete public authentication service. Integrators must provide SMS/password limits, browser sessions, CSRF protection, host restrictions, encrypted persistence, and operation auditing. `serializeLoginSession()` **contains tokens and potentially an account password and does not encrypt them**. Never write those bytes directly to a file, send them to browsers, or log them. Optional Windows storage uses DPAPI; other systems require their own trusted encrypted store.

Use [Issues](https://github.com/zjmdong/OpenTYG/issues) for ordinary reports, read [CONTRIBUTING.md](CONTRIBUTING.md) before contributing, and follow [SECURITY.md](SECURITY.md) for vulnerabilities. Original code uses [MIT](LICENSE); dependencies retain their [respective licenses](THIRD_PARTY_NOTICES.md). MIT grants no rights to third-party services, accounts, materials, hardware, or trademarks.

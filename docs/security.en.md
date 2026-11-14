# Security and integration

[Docs](README.en.md) / Security and integration · [简体中文](security.md)

This is a protocol library, not a complete public backend. The integrating application owns authentication, permissions, validation, rate limits, network restrictions, storage, logging, and explicit user actions.

## Credentials

Passwords, verification codes, login/property tokens, authcodes, cookies, personal SIP secrets, and ICE/TURN credentials are secret. Login responses may contain a Base64 account password; Base64 is not encryption. The SDK can retain a password for intercom, including in serialized login state.

`serializeLoginSession()` returns **unencrypted secret-bearing bytes**. Persist only through trusted encryption. Never expose full responses, token-bearing URLs, personal configuration, raw SDP, or session bytes to browsers or logs. Masked credentials do not erase secrets in memory; `includeSecrets: true` is for trusted backend use only.

WindowsLoginStore uses current-user DPAPI. Other systems need their own encryption and key lifecycle. Never fall back to plaintext files or localStorage.

## Network boundaries

| Transport | Current boundary |
| --- | --- |
| HTTP / WS | Defaults permit plaintext upstream traffic; browser HTTPS does not encrypt it |
| SIP Digest | Authenticates signaling; it does not encrypt SIP or RTP |
| SIP / RTP UDP | No SIP TLS or SRTP support |
| Custom `fetchImpl` | HTTP only; does not cover native WebSocket, DNS, or UDP |

Standalone v0.3.4 does not include main's full host allowlist or stable-door-ID adaptations. Restrict discovered HTTP/WS hosts, captcha URLs, SIP proxies, and SDP/media destinations by host, address, protocol, and port. Control redirects and outbound firewall rules; never disable TLS verification or pass arbitrary browser URLs into the SDK.

If system DNS returns a Fake-IP, SIP resolution can send the proxy domain to AliDNS or Google HTTPS DNS. This fallback and its privacy implications are documented in [NAT traversal](intercom-protocol.md#nat). Use only authorized STUN/TURN services and avoid long-lived hardcoded credentials.

## Users and physical actions

Bind one instance to one account. Devices must come from that user's current authorized configuration. SDK list references are temporary, not persistent business IDs across directory reloads.

The three-second door interval and 60-second SMS hint are not account-wide protection. Add persistent phone/SMS, password-failure, and IP/session limits. Preserve platform device verification and request limits.

A missing acknowledgment after dispatch means an unknown door result, without automatic replay. Let the user verify the physical lock. SIP registration or call acceptance proves only signaling progress; verify actual media and remote hangup separately. Obtain the necessary authorization for microphone use, monitoring, storing, or sharing media.

## Public applications

Use browser HTTPS and implement secure cookies, CSRF/Origin/Host checks, revocation, account isolation, authorization, output escaping, and request-size limits. Do not expose secret-bearing SDK return objects as public APIs.

Encrypted production state needs tested backup/restore and exclusive writers; the SDK provides no distributed persistence. You may study main's web integration, but do not replace its adapted SDK directly with this branch. See the [disclaimer](../DISCLAIMER.md) and [architecture comparison](architecture.en.md#compared-with-main).

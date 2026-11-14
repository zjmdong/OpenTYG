# Privacy and operations

[Docs](README.en.md) / Privacy and operations · [简体中文](security.md) · [Report a vulnerability](../SECURITY.md)

## Credential lifecycle

| State | Lifetime and behavior |
| --- | --- |
| Browser-only sign-in | At most 12 hours; does not survive a server restart |
| Remembered sign-in | A 30-day absolute limit with encrypted restoration state; the platform can expire it sooner |
| Logout | Revokes all browser sessions for this account on this service, removes saved credentials, and retains favorites/settings |
| Expired platform account token | Clears this account's in-memory login, saved credentials, and local sessions; requests sign-in, without affecting other accounts |
| Expired property token | One refresh within the existing preparation deadline; failures surface without resending door commands |

Account-token expiry specifically means the property-permission query returns platform `1002` / `Token过期`. An expired browser cookie, ordinary network failure, or other business rejection does not trigger account-wide cleanup. The integrated SDK has no account-token renewal endpoint; remembered login does not promise 30 uninterrupted days.

Passwords and SMS codes pass through same-origin backend requests to the platform protocol. The app does not write passwords to logs, preferences, or remembered-login files. Unused intercom password retention is disabled.

The browser holds only this service's signed random cookie, with production attributes `HttpOnly`, `Secure`, and `SameSite=Strict`. Upstream login tokens, door authcodes, and property tokens are not returned. Authorized users can still see their own names, masked accounts, and properties.

Restoration credentials may remain if another browser for the same account has a remembered session. Expired credentials without remembered sessions are pruned periodically. Preferences have no automatic expiry; operators should define retention and deletion policies.

## Data on disk

| File | Contents and protection |
| --- | --- |
| `secrets/opentyg_secret.txt` | External random secret, plaintext on the host; protect separately |
| `data/.app-secret` | Random data key wrapped by the external secret |
| `data/users/*.blob` | Remembered login restoration data, encrypted with AES-256-GCM |
| `data/prefs/*.prefs`, `*.prefs.bak` | Encrypted user/property preferences and previous-write backups |
| `data/sessions.json` | Encrypted remembered-session records |
| `data/auth-limits.json` | Encrypted authentication limits, without passwords |

These are default paths; check your Compose configuration. User filenames are HMAC-derived from the external secret and account. Rate-limit identifiers use purpose-bound HMACs. Encryption uses random IVs, authentication tags, and purpose-bound context. Credentials, preferences, sessions, and business limits share a data key; the external secret also derives identifiers and signs cookies.

**Encryption primarily protects a leaked copy of the data directory.** It does not protect against an attacker with the keys, host administrator access, or process control. Ordinary Compose secrets are file mounts, not a host-side key vault. Manage TLS private keys in the proxy environment.

## Writes, backups, and restoration

Writes sync a temporary file before atomic replacement, plus parent-directory syncing on POSIX. New private files use `0600`. Preference writes retain the previous encrypted version. Load errors, missing data keys, and rate-limit write failures are surfaced, without silently regenerating keys or clearing limits.

These measures do not replace backups or guarantee durability on failing disks or every network filesystem. Use reliable local storage and one instance per data directory.

1. Stop the service. Back up Compose, the complete data directory including hidden files, and the original external secret.
2. Restrict backup access. Include custom paths and any `.env` in use.
3. Preserve the original secret, ownership, and permissions when restoring, then start one instance.
4. Restart after replacing data files manually so the process does not use stale preference caches.

Never commit runtime data, secrets, certificate private keys, or raw logs. See [deployment](deployment.en.md) for commands.

## Authentication limits

| Operation | Persistent rule |
| --- | --- |
| SMS sends | Shared per phone across browsers: three per hour and twelve per twelve hours |
| Password failures | The fourth failure within ten minutes locks new logins for one hour, including password and SMS sign-in |

Successful and uncertain SMS sends count; definite non-send rejections can release a reservation. Device verification and network failures do not count as incorrect passwords. Limits survive restarts without revoking existing signed-in sessions.

Short-window network limits behind a proxy may be shared by that proxy's requests; business account limits remain independent. Design ingress protection for the expected scale. This is not a general-purpose identity platform.

## Network and launch checks

Production requires a fixed HTTPS `PUBLIC_ORIGIN`, Secure cookies, exact Host / Origin checks, and request markers. Restrict internal HTTP to loopback or a controlled private network. Disable proxy/CDN caching of private responses.

Default HTTP / WS compatibility leaves backend-to-platform traffic unencrypted and may expose login and door credentials. Browser HTTPS and hostname allowlists cannot encrypt this segment. Disable compatibility only after verifying a working HTTPS / WSS upstream.

Before launch, check certificates, proxy ports and Origin, internal-port isolation, filesystem permissions, secret backups, single-instance operation, and actual account permissions. Avoid body/credential logging. Logs go to stdout and are rotated by Docker; review before sharing. No external analytics is included. Assess data handling in any monitoring, CDN, backup, or logging service you add.

## Memory and command boundaries

Login/configuration state is bounded to approximately 24 idle hours and 200 accounts, with possible earlier LRU eviction; sockets close after 30 idle minutes. Expired sessions are denied immediately, retained login state is periodically cleared, and logout clears it directly. Longer memory residency neither extends sessions nor protects a compromised host.

Permission verification is reused for up to approximately 60 seconds. Idle recovery, disconnection, or expired checks trigger revalidation. Cached favorites are presentation only, never authorization. All writes update preference caches; multiple writers are unsupported.

**After possible dispatch, a missing acknowledgment does not mean the door stayed closed.** The integrated protocol has no usable idempotency key. Users must verify physical state after an unknown result; the application must not resend or queue commands automatically.

The project claims neither formal security certification nor a complete penetration test. Report vulnerabilities privately through [SECURITY.md](../SECURITY.md).

# Backend API

[Docs](README.en.md) / API · [简体中文](api.md)

These are the **same-origin endpoints** used by the OpenTYG web client. For platform HTTP / WebSocket / SIP protocols, see the [standalone SDK reference](https://github.com/zjmdong/OpenTYG/blob/opentyg-sdk/docs/platform-api.md).

## Conventions

- JSON success: `{ "ok": true, "data": ... }`.
- Error: `{ "ok": false, "error": { "code": "...", "message": "...", "details": ... } }`, with the appropriate HTTP status.
- POST bodies must be JSON objects, up to **64 KiB**.
- Mutations require `Content-Type: application/json`, `X-OpenTYG-Request: 1`, and an `Origin` exactly matching `PUBLIC_ORIGIN`.
- Host must match the configured public domain and port, except for `/api/health`. Cross-origin CORS is not provided.
- Protected endpoints also require a valid `opentyg_session` cookie. The request marker is not authentication. Cookies are signed and set by the server, with production attributes HttpOnly, Secure, SameSite=Strict, and Path=/; scripts cannot read them.

Do not fabricate session IDs or log cookies. The captcha-image endpoint returns an image directly, without a JSON success envelope.

## Authentication and sessions

| Request | Input | Behavior |
| --- | --- | --- |
| `GET /api/health` | — | Local health and version, without testing locks |
| `GET /api/meta` | — | App name, version, favorite capacity, and cooldown |
| `POST /api/auth/captcha` | `mobile` | Creates an anonymous cookie and challengeId |
| `GET /api/auth/captcha-image` | Query `challengeId` | Returns the captcha image bound to this anonymous browser |
| `POST /api/auth/sms` | `challengeId`, `picRandom` | Validates the captcha and requests an SMS |
| `POST /api/auth/login-sms` | `mobile`, `smsCode`, `remember` | SMS sign-in |
| `POST /api/auth/login-password` | `account`, `password`, `remember`; optional `changeDeviceSmsCode` | Password sign-in and platform device verification |
| `GET /api/auth/session` | Cookie (optional) | Authentication, user, and property context |
| `GET /api/bootstrap` | Cookie (optional) | Returns `{meta, session}` in one request |
| `POST /api/auth/logout` | `{}` + cookie | Revokes this account's local sessions and saved credentials, retaining preferences |

Only boolean `true` enables `remember`. Failed sign-in does not revoke another valid session. Unauthenticated session/bootstrap reads return `authenticated: false`; clients should not interpret temporary network or storage errors as logout.

Explicit account-token expiry from the property-permission query (platform `1002` / `Token过期`) returns **401 / SESSION_EXPIRED**, including restoration through session/bootstrap. The server clears that account's login and sessions and the current cookie, retaining preferences. Old sessions on other devices for the same account are revoked; other accounts are unaffected.

An expired property token gets one refresh within the existing preparation deadline. Ordinary network errors do not trigger account-wide logout. The SDK has no account-token renewal endpoint; see [credential lifecycle](security.en.md#credential-lifecycle).

## User and directory

These endpoints require sign-in; POST requests also require the common headers.

| Request | Input | Behavior |
| --- | --- | --- |
| `GET /api/me` | Cookie | Masked user, properties, and counts |
| `POST /api/me/name` | `name` | Local display name, up to 20 Unicode characters; empty resets |
| `GET /api/households` | Cookie | Authorized properties and selected ID |
| `POST /api/households/select` | `householdId` | Validates the property, loads its directory, invalidates old context |
| `GET /api/doors` | Optional query `refresh=1` | Current directory, doors, favorites, and context |

Directories contain `householdId`, `directoryId`, `doors`, `favorites`, and `loadedAt`. Use returned IDs unchanged, never guesses or array positions. Reads check connectivity and recover if needed without issuing door commands.

`refresh=1` creates new UI context. Automatic recovery preserves it only when the property and complete device/configuration fingerprint are unchanged. Session/bootstrap may include `doorsPreview`: the current cookie owner's public display fields and favorites, without upstream credentials. It grants no authority and is not persisted by the browser or Service Worker.

## Door operations

Every POST below additionally requires current **`householdId`, `directoryId`**, and a valid cookie. Use a `doorId` from the current directory.

| Request | Input | Behavior |
| --- | --- | --- |
| `POST /api/doors/rename` | `doorId`, `name` | Name of 1–20 Unicode characters; empty resets |
| `POST /api/doors/reset-name` | `doorId` | Resets the default name |
| `POST /api/doors/favorite` | `doorId`, `favorite`; optional `priority` | Up to five favorites, positions 1–5; false removes |
| `POST /api/doors/reorder` | `doorIds` | Permutation of the full current directory, without missing, duplicate, or foreign doors |
| `POST /api/doors/open` | `doorId` | Sends after context, authorization, serialization, and cooldown checks |

Check `data.success`, not just HTTP 200. Responses include the property and directory IDs actually used; synchronize them on the client. Recovery resolves the same stable door ID and rejects removed doors.

## Error handling

| Code | Client behavior |
| --- | --- |
| `SESSION_EXPIRED / SAVED_LOGIN_INVALID / NOT_LOGGED_IN` | Sign in again; do not loop restoration of invalid state |
| `STALE_DIRECTORY` | Refresh context and confirm intent; continue the same tap only after explicit pre-send rejection with unchanged account, property, and door |
| `HOUSEHOLD_NOT_SELECTED / HOUSEHOLD_UNAVAILABLE` | Select a valid property or verify permissions with its operator |
| `DOOR_NOT_FOUND` | Refresh the directory; never substitute another door |
| `BUSY / OPEN_COOLDOWN / RATE_LIMITED` | Wait without accumulating door requests |
| `SMS_RATE_LIMITED / PASSWORD_RATE_LIMITED` | HTTP 429; honor Retry-After and details.retryAfterSeconds |
| `DOORS_LOAD_FAILED / UPSTREAM_REJECTED` | Surface the error; it does not by itself imply expired login |
| `CREDENTIAL_STORE_UNAVAILABLE` | Investigate permissions, keys, and storage without discarding data |
| `OPEN_RESULT_UNKNOWN / WS_TIMEOUT` | Verify physical state; never resend automatically |

Network failures, timeouts, or invalid responses after dispatch also mean an unknown result. **No response does not prove that the command was not executed. Never automatically resend, cache offline, or queue door commands.** A platform success response does not guarantee the physical lock opened.

See [server/errors.mjs](../server/errors.mjs) for all errors, and [authentication limits](security.en.md#authentication-limits) for SMS and password rules.

## Connection progress and deadlines

`GET /api/connection/status` requires a valid session and returns `data: { phase, step, elapsedMs }`. It remains readable while the same account reconnects. It never starts platform operations, returns credentials or account details, or extends the session lifetime.

- `phase`: `idle`, `restoring`, `connecting`, `directory`, `retrying`, `ready`, or `failed`.
- `step`: stage number for restoring login, connecting, or loading the directory.
- `elapsedMs`: time spent preparing, not an estimated completion time.

Preparation defaults to approximately 2.9 seconds and at most three attempts, with about 950ms per unresponsive stage. `GET /api/doors` uses the remainder of a roughly three-second budget measured from request start. Warm taps submit directly; retries cover only preparation and confirmed pre-queue failures. Possibly sent commands retain one five-second acknowledgment window and are not replayed. Timeout settings are not success-latency guarantees.

Healthy directories are reused for up to approximately 60 seconds. See [sessions and storage](architecture.en.md#sessions-and-storage) for cache limits. Preparation timing logs record phases, attempts, and durations; request timing logs record local API paths and durations. Neither includes accounts, tokens, authcodes, door addresses, or request bodies.

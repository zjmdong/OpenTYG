# SDK reference

[Docs](README.en.md) / SDK reference · [简体中文](sdk-reference.md)

Use one `TygClient` per account in a trusted **Node.js 22.4+** process. Node.js 24 is recommended. The SDK starts no HTTP server and supplies no browser authentication.

[Options](#options) · [Core methods](#core-methods) · [Intercom](#intercom) · [Persistence](#persistence) · [Errors](#errors)

## Options

```js
import { TygClient, TygError, DEFAULT_ORIGIN, ROUTES, envelope } from 'tyg-core-sdk';
const sdk = new TygClient({ lastLoginOs: '4' });
```

| Option | Default | Purpose |
| --- | --- | --- |
| `origin` | `http://lxj.taoyuangu.com:80` | Bootstrap URL, HTTP/HTTPS only, no URL userinfo |
| `timeZone` | `Asia/Shanghai` | Request timestamps |
| `lastLoginOs` | `'4'` | Device type; accepts '2'/'3'/'4'/'5', not a verification bypass |
| `deviceUniqueId`, `lastLoginDeviceToken` | Empty strings | Optional device/push identity |
| `httpTimeoutMs` | `30000` | HTTP/configuration requests |
| `connectTimeoutMs` | `10000` | Door WebSocket handshake |
| `configTimeoutMs` | `15000` | Directory response |
| `openTimeoutMs` | `5000` | Acknowledgment after dispatch |
| `openCooldownMs` | `3000` | Per-instance command interval |
| `fetchImpl` | `globalThis.fetch` | Trusted HTTP transport; not WebSocket or UDP |
| `intercomMediaOptions.apkBridge` | `true` | Original-client media compatibility |
| `intercomMediaOptions.offerIce` | `false` | Explicit ICE offer |
| `intercomMediaOptions.ice` | Optional | STUN/TURN [host, port], TURN username/password, forceTurn |

These are SDK policies, not platform guarantees. Supply trusted configuration, never arbitrary browser-provided destinations. Full shapes are in [tyg-client.d.ts](../src/tyg-client.d.ts).

## Core methods

| Method | Returns | Contract |
| --- | --- | --- |
| `new TygClient(options?)` | Client | No network request |
| `initialize({ force=false }?)` | Promise&lt;Configuration&gt; | Use before sign-in; reuse configuration unless forced |
| `createCaptcha(mobile, options?)` | Promise&lt;challenge&gt; | challengeId, imageUrl, expiresIn, optional validated image bytes |
| `captchaImage(challengeId)` | Promise&lt;image&gt; | bytes and contentType, bound to this challenge |
| `sendSms(challengeId, picRandom)` | Promise&lt;receipt&gt; | sent, code, retryAfterSeconds; consumes a successful challenge |
| `loginSms(mobile, smsVerifyCode)` | Promise&lt;login&gt; | user and full sessionToken; trusted backend only |
| `loginPassword(account, password, changeDeviceSmsCode="")` | Promise&lt;login&gt; | Preserves platform device verification |
| `getHouseholds()` | Promise&lt;Household[]&gt; | Clears current door connection/directory; returned list omits full tokens |
| `getDoorCredentials(householdId)` | Promise&lt;Credentials&gt; | Authorization only, without WS or directory; usually use getDoors instead |
| `getDoors(householdId)` | Promise&lt;Directory&gt; | Parallel authcode/WS setup, then configuration download and a fresh directoryId |
| `getCredentials({ includeSecrets=false }?)` | Credentials | Synchronous masked credentials; secrets only for trusted backend use |
| `getState()` | ClientState | Synchronous memory snapshot; no login or renewal |
| `openDoor(input)` | Promise&lt;OpenResult&gt; | Current context only; no automatic replay after timeout |
| `logout()` | Promise&lt;{ loggedOut: true }&gt; | Clears local state, then attempts remote logout |
| `close()` | void | Synchronous local cleanup; no HTTP logout, instance cannot be reused |

### SMS sign-in

```js
await sdk.initialize();
const challenge = await sdk.createCaptcha(mobileFromUser, { includeImage: true });
// Display challenge.image.bytes for the user to read.
await sdk.sendSms(challenge.challengeId, pictureCodeFromUser);
await sdk.loginSms(mobileFromUser, smsCodeFromUser);
```

The SDK does not solve captchas. Challenge context defaults to 600 seconds and is consumed on successful SMS sending. `retryAfterSeconds=60` is a local hint, not a persistent account-wide rate limiter. SMS success requires platform `result=0` and `code=1`.

### Explicit door action

```js
const home = (await sdk.getHouseholds()).find(h => h.available);
if (!home) throw new Error('No authorized property');
const directory = await sdk.getDoors(home.id);
// Run only after the user selects a door from this directory.
const door = directory.doors.find(d => d.id === userSelectedDoorId);
if (!door) throw new Error('Invalid door selection');
const receipt = await sdk.openDoor({
  householdId: directory.householdId,
  directoryId: directory.directoryId,
  doorId: door.id,
});
```

`receipt.success` reports a matched platform response, not physical lock state. `household-1` and `door-1` are current-list references. Reloading invalidates old context. Concurrent business operations return `BUSY`; do not queue implicit command retries. See the [door sequence](how-it-works.en.md#doors-directory-first-explicit-action-second).

## Intercom

| Method | Returns | Contract |
| --- | --- | --- |
| `prepareIntercom({ password? })` | Promise&lt;IntercomState&gt; | XML personal configuration; an HTTP token cannot replace the password |
| `registerIntercom()` | Promise&lt;IntercomState&gt; | UDP registration only, no call |
| `getIntercomState()` | IntercomState | Synchronous state, errors, and media counters |
| `callIntercom({ configurationId, deviceId, video?, mode? })` | IntercomState | Immediate startup state; observe events for later outcomes |
| `hangupIntercom()` | Promise&lt;IntercomState&gt; | CANCEL before answer, BYE after; no automatic redial |
| `onIntercomEvent(listener)` | Unsubscribe function | state, audio, or video events |
| `writeIntercomAudio(pcm)` | void | 320-byte PCM16LE frames, 8 kHz mono, 20ms; about 200ms maximum queue |
| `closeIntercom()` | void | Clears media, timers, and personal config; best-effort hangup/deregistration |

`mode` defaults to `'talk'`. Monitoring explicitly uses `{ mode: 'monitor', video: true }` and neither sends nor receives audio. One outbound call per instance; no incoming calls.

Subscribe before starting a call. State events carry `IntercomState`; audio is PCM16LE; video includes Annex B H.264 bytes, an RTP timestamp, and keyframe information. Decoding/playback belongs to the application. No negotiated media means microphone frames are not sent.

Starting and ending a call are **separate user actions**. When ending, await `hangupIntercom()` if confirmation matters, then unsubscribe and call `closeIntercom()` in cleanup. See [intercom flow](how-it-works.en.md#intercom-provisioning-signaling-media) and the [wire protocols](intercom-protocol.md).

## Persistence

| Method | Contract |
| --- | --- |
| `serializeLoginSession()` | Uint8Array with token, account/device identity, and possibly password; **unencrypted** |
| `restoreLoginSession(bytes)` | Promise&lt;ClientState&gt;; requires a signed-out instance, checks origin/format, queries properties to validate |

Restoration excludes the current door WS, authcode, selected door, and call. Reload directories and personal SIP configuration afterwards. Failure clears restored in-memory login but does not manage your disk records; distinguish explicit rejection from transient network errors.

Optional Windows storage:

```js
import { WindowsLoginStore } from 'tyg-core-sdk/login-store';
const store = new WindowsLoginStore({
  origin: sdk.origin,
  directory: privateDirectoryOwnedByCurrentUser,
});
const bytes = sdk.serializeLoginSession();
try { await store.save(bytes); } finally { bytes.fill(0); }
```

`load()` returns decrypted bytes or null if absent; restore them on a new client and clear the byte buffer afterwards. `status()` reports whether a record exists. `clear()` deletes the stored record, not the active login.

DPAPI is bound to the current Windows user; Linux/macOS/NAS are unsupported, without plaintext fallback. Use an exclusive private directory. It cannot protect a compromised Windows user, and clearing a buffer does not erase all JavaScript string copies.

## Errors

`TygError` contains `code`, `message`, `details`, and `status`. This is an SDK structure, not a universal platform response. Raw upstream text may be sensitive; log only approved codes and sanitized statistics.

| Codes | Handling |
| --- | --- |
| `NOT_INITIALIZED`, `NOT_LOGGED_IN` | Initialize or sign in |
| `DEVICE_VERIFICATION_REQUIRED`, `DEVICE_VERIFICATION_INVALID` | Human device SMS verification |
| `CAPTCHA_EXPIRED`, `SMS_REJECTED`, `LOGIN_REJECTED` | User correction within request limits |
| `HOUSEHOLD_UNAVAILABLE`, `INTERCOM_FORBIDDEN` | Respect platform permissions |
| `STALE_DIRECTORY`, `STALE_INTERCOM_CONFIG` | Reload and obtain a new selection |
| `BUSY`, `OPEN_COOLDOWN` | Wait without queuing retries |
| `WS_NOT_CONNECTED` | Reload before a new user action |
| `OPEN_RESULT_UNKNOWN` | Verify physical state; never resend automatically |
| `INTERCOM_PASSWORD_REQUIRED` | Obtain the user's password through trusted input |
| `SIP_TIMEOUT`, `CALL_UNAVAILABLE`, `MEDIA_UNSUPPORTED` | Check network, device, and negotiation |
| `HANGUP_UNCONFIRMED` | Local media released; verify remote state |

Even if remote logout fails, clear your application's session and saved credentials. Use `finally` for cleanup. Full integration responsibilities are in [Security and integration](security.en.md).

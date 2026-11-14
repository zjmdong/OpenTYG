# How it works

[Docs](README.en.md) / How it works · [简体中文](how-it-works.md)

These flows describe standalone SDK v0.3.4, without main's browser sessions, stable door IDs, or automatic connection-recovery policy.

## Doors: directory first, explicit action second

```mermaid
sequenceDiagram
    participant A as Your app
    participant S as TygClient
    participant P as Platform
    A->>S: initialize()
    S->>P: Discover service addresses
    A->>S: loginPassword / loginSms
    S->>P: Sign in, verify device if needed
    P-->>S: sessionToken
    A->>S: getHouseholds()
    S->>P: Query property permissions
    P-->>S: Properties and householdToken
    A->>S: getDoors(selected property)
    par Authorization
        S->>P: HTTP getAuthcode
        P-->>S: authcode
    and Transport
        S->>P: WebSocket handshake (householdToken)
    end
    S->>P: MobileDownloadConfig (authcode)
    P-->>S: Device configuration
    S-->>A: New directoryId and doors
    Note over A,S: User selects a door from this directory
    A->>S: openDoor(property, directory, door ID)
    S->>S: Check context, connection, concurrency, cooldown
    S->>P: OpenDoor once
    P-->>S: Acknowledgment, timeout/disconnect means unknown
    S-->>A: OpenResult or TygError
```

`getHouseholds()` clears the previous door connection and directory. Each `getDoors()` creates a new directory. Update UI context rather than reusing the previous `door-1`.

| Credential | Source | Used for |
| --- | --- | --- |
| `sessionToken` | Successful sign-in | Property lookup and remote logout |
| `householdToken` | Current authorized property | Door HTTP authorization and WebSocket URL |
| `authcode` | Door authorization response | WebSocket business message headers |

Success codes vary: SMS sending uses `code=1`, whereas login normally uses `code=0`. Door acknowledgment requires `result=0`, `code=0`, and `data="开门成功"`. Even then, `physicalStateVerified` is `false`. See the [platform reference](platform-api.md).

### After a failure

For pre-send disconnection, the application reloads the directory and obtains a new user selection. Post-send timeout or disconnection means `OPEN_RESULT_UNKNOWN`, never an automatic retry. Timed-out channels are discarded so late replies cannot match a later operation. The default acknowledgment window is five seconds, with a three-second per-instance command interval; neither is a platform guarantee or account-wide rate limit.

## Intercom: provisioning, signaling, media

```mermaid
flowchart TB
    Login["Signed in<br/>Intercom allowed, account password available"] --> XML["prepareIntercom<br/>XML authentication and personal config"]
    XML --> Register["registerIntercom<br/>REGISTER / Digest"]
    Register --> Select["User selects a device from current config"]
    Select --> Call["callIntercom<br/>INVITE / SDP; startup state returns immediately"]
    Call --> State["Events advance state<br/>Ringing / early media / answered"]
    State --> Media["Negotiate RTP / RTCP<br/>Check actual frames and counters"]
    State -->|End before answer| Cancel["CANCEL"]
    Media -->|End after answer| Bye["BYE"]
    Cancel --> Close["Release media and listeners<br/>closeIntercom as needed"]
    Bye --> Close
    classDef default fill:#eef4ff,stroke:#8ca9dc,color:#101827
    classDef core fill:#2f6bed,stroke:#2f6bed,color:#ffffff
    class XML,Register,Media core
```

This is the normal outbound path. Any stage may fail; state/events expose errors without automatically calling again.

- XML uses an account-password digest and a shared provisioning cookie. An HTTP login token cannot replace personal SIP credentials.
- `callIntercom()` defaults to `mode: 'talk'`. Monitoring requires explicit `mode: 'monitor', video: true` and carries no audio.
- `183 + SDP` can start early media without final acceptance. SIP 200/ACK does not prove media reachability.
- Audio input is **PCM16LE / 8 kHz mono / 20ms / 320 bytes**. Video events carry Annex B H.264; your app handles decoding and playback.
- ICE requires negotiation and usable candidates. No public STUN/TURN is preset. An HTTPS reverse proxy does not transport SIP/RTP UDP.

See [Intercom protocols](intercom-protocol.md) for the five XML messages, SIP fields, and media formats.

## Persistence: serialization is not encryption

```mermaid
flowchart TB
    Live["Signed-in instance"] --> Bytes["serializeLoginSession<br/>Unencrypted secret-bearing bytes"]
    Bytes --> Store["Application encrypted store<br/>or WindowsLoginStore / DPAPI"]
    Store --> Load["Read and decrypt in a trusted process"]
    Load --> Restore["New instance: restoreLoginSession<br/>Check format/origin; query properties"]
    Restore --> Valid{"Platform validation succeeds?"}
    Valid -->|Yes| Ready["Restore account<br/>Reload directories or intercom config"]
    Valid -->|No| Error["Clear restored in-memory login; return error<br/>Application decides whether to retain disk record"]
    classDef default fill:#eef4ff,stroke:#8ca9dc,color:#101827
    classDef secret fill:#fff4e5,stroke:#b07824,color:#603b0c
    class Bytes secret
```

Saved state excludes the current door WebSocket, authcode, selected door, and calls. Restoration failures do not delete your files. Distinguish explicit credential rejection from transient network failure. The web app's 30-day remembered-session policy does not apply here.

## Logout and cleanup

| Method | Local resources | Platform action | Reuse |
| --- | --- | --- | --- |
| `hangupIntercom()` | Ends media/current call | CANCEL or BYE; acknowledgment may be unconfirmed | Instance remains usable |
| `closeIntercom()` | Media, timers, personal configuration | Best-effort hangup/deregistration | Door login remains usable |
| `logout()` | Clears login, door, and intercom state first | Then attempts remote logout | Instance can sign in again |
| `close()` | Synchronously releases resources | No HTTP remote logout; best-effort intercom cleanup | Instance cannot be reused |

If hangup confirmation matters, `await hangupIntercom()` before removing listeners/configuration. Clean up your own sessions and storage even after remote logout fails. See the [SDK reference](sdk-reference.en.md).

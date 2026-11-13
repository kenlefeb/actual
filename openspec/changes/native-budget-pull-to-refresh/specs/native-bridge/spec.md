# Spec Delta

## Purpose

The `sync` call that lets a native screen ask loot-core to sync with the server (sc-3884): its allowlist entry, the result the page returns, its deadline, and what an error may reveal. The base requirements ("The bridge forwards only allowlisted handlers", "Native views survive a suspended engine") are in the `native-bridge` change, and the write allowlist is in `add-native-budget-screen`; this delta adds to them and does not replace them.

## ADDED Requirements

### Requirement: Sync is allowlisted as a call with no arguments
The bridge allowlist, on the Swift and the page side, SHALL also hold `sync`, loot-core's existing sync handler, and the two lists SHALL stay equal. Swift SHALL send it only through one typed method that passes no arguments, and the generic `call` SHALL refuse the name `sync` in every shape, including with no arguments, so the result is always decoded and the 30 second deadline always applies. `sync` SHALL be the only handler on the allowlist that is neither a batched read, `query`, nor one of the named budget writes. Every call SHALL still go through the origin-checked path.

#### Scenario: A sync call
- **GIVEN** the iOS app with a budget open
- **WHEN** native code calls `sync` through its typed method
- **THEN** loot-core runs its sync handler and native code receives the reduced result

#### Scenario: The generic call with no arguments
- **GIVEN** the iOS app with a budget open
- **WHEN** native code calls `call("sync")` with no arguments
- **THEN** the call is refused with an error naming the handler, and loot-core never receives it

#### Scenario: Sync with arguments
- **GIVEN** the iOS app with a budget open
- **WHEN** native code calls `sync` with any argument
- **THEN** the call is refused with an error naming the handler, and loot-core never receives it

#### Scenario: Bank sync is not allowlisted
- **GIVEN** the iOS app with a budget open
- **WHEN** native code calls `simplefin-batch-sync`, `accounts-bank-sync` or any other bank sync handler
- **THEN** the call is refused with an error naming the handler, and loot-core never receives it

#### Scenario: The lists differ
- **GIVEN** the Swift allowlist and `native-bridge-allowlist.json`
- **WHEN** one lists `sync` and the other does not
- **THEN** the allowlist tests on both sides fail

#### Scenario: A foreign page
- **GIVEN** the main frame shows a page on another host
- **WHEN** native code calls `sync`
- **THEN** the call returns the fixed origin error, and the page receives nothing

### Requirement: The page returns only whether the sync worked and why not
The page bridge SHALL return `{"ok": true}` when loot-core's sync returns no error, and `{"ok": false, "reason": R}` when it does. R SHALL be one of `network`, `unauthorized`, `out-of-sync`, `clock-drift`, `encryption` or `other`. The page SHALL call `send('sync')` with no arguments, whatever it was given, and SHALL build this shape itself. loot-core's `messages`, `message` and `meta` SHALL NOT cross the bridge, and a rejection of `send('sync')` SHALL return `{"ok": false, "reason": "other"}`, never the rejection's message.

#### Scenario: A sync that works
- **GIVEN** a budget with a sync server and a change made on another device
- **WHEN** native code calls `sync`
- **THEN** the result is `{"ok": true}` and carries no messages

#### Scenario: A rejection that carries the server address
- **GIVEN** `send('sync')` rejects with a message containing `https://sync.example.com/sync/sync`
- **WHEN** native code calls `sync`
- **THEN** the result is `{"ok": false, "reason": "other"}` and the address appears nowhere in it

#### Scenario: Arguments are not forwarded
- **GIVEN** the page bridge
- **WHEN** it is called for `sync` with any arguments
- **THEN** it calls `send('sync')` with none

#### Scenario: The shape changes
- **GIVEN** the contract fixtures checked by vitest and decoded by the Swift tests
- **WHEN** the result shape changes
- **THEN** the vitest contract test fails, and the Swift decode test fails against the regenerated fixture

### Requirement: Sync failure reasons map to a closed set
The page SHALL map loot-core's reason as follows: `network-failure` to `network`; `unauthorized`, `out-of-sync` and `clock-drift` to themselves; `encrypt-failure` and `decrypt-failure` to `encryption`; every other reason, including an unknown one, to `other`. Swift SHALL decode R into a closed set and treat any other value as `other`.

#### Scenario: Each failure
- **GIVEN** loot-core's sync fails with reason `network-failure`, `unauthorized`, `out-of-sync`, `clock-drift`, `encrypt-failure`, `decrypt-failure` or `invalid-schema`
- **WHEN** native code calls `sync`
- **THEN** the result is `{"ok": false, "reason": R}` with `network`, `unauthorized`, `out-of-sync`, `clock-drift`, `encryption`, `encryption` or `other`, in that order

#### Scenario: An unknown reason
- **GIVEN** loot-core's sync fails with a reason not listed above, or the page returns a reason Swift does not know
- **WHEN** native code receives the result
- **THEN** the reason is `other`

### Requirement: A sync error reveals nothing about the server
No part of a failed sync's call result SHALL reach native code, a log line or the screen except R. The page SHALL drop the error's `message` and `meta`, which can carry the server address, an HTTP status or a response body. No credential, token or file id SHALL cross the bridge in either direction. The `sync-event` the page forwards still carries loot-core's payload, including `meta`; Swift SHALL read only the event name and SHALL NOT read, store or log the payload.

#### Scenario: A failure that carries the server address
- **GIVEN** loot-core's sync fails with a `message` and `meta` that contain `https://sync.example.com/sync/sync` and a response body
- **WHEN** native code calls `sync`
- **THEN** the result is the reduced shape only, and neither the address nor the body appears in the result, in any log line or on the screen

#### Scenario: The sync-event payload
- **GIVEN** a failed sync emits `sync-event` with a `meta` holding an error message and stack
- **WHEN** native code receives the event
- **THEN** it reads only the event name, and the payload is stored and logged nowhere

#### Scenario: Read-only mode after unauthorized
- **GIVEN** loot-core's sync fails with `unauthorized`, which puts it into read-only mode
- **WHEN** native code receives `{"ok": false, "reason": "unauthorized"}`
- **THEN** native code changes nothing about that mode, which is loot-core's existing behaviour

### Requirement: A sync call has its own 30 second deadline
Every bridge call SHALL keep the 5 second default deadline, except `sync`, which SHALL have a deadline of 30 seconds, set per call. When it passes, the call SHALL fail with the timeout error naming the handler. The deadline SHALL stop only the wait: loot-core SHALL keep syncing, and native code SHALL NOT retry the call.

#### Scenario: A slow sync
- **GIVEN** a sync that takes 12 seconds
- **WHEN** native code calls `sync`
- **THEN** the call returns the result after 12 seconds, without a timeout error

#### Scenario: A sync that outlasts the deadline
- **GIVEN** a sync, or a suspended engine, that does not answer
- **WHEN** native code calls `sync`
- **THEN** the call fails with the timeout error after 30 seconds, and loot-core is not told to stop

#### Scenario: Other calls keep their deadline
- **GIVEN** the 30 second deadline for `sync`
- **WHEN** native code calls `native/budget-month` and the engine does not answer
- **THEN** that call fails with the timeout error after about 5 seconds

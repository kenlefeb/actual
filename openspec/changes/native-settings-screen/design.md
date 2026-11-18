# Design

## Facts read on origin/development 2645aa42

**Web Settings** (`components/settings/index.tsx`) has these sections:

- **About.** The client version comes from `window.Actual.ACTUAL_VERSION`, set by `browser-preload.js` (`computeClientVersion`). The server version comes from `useServerVersion`. There are links to release notes and `/notifications`.
- **Themes, Format, Currency, Language.** Currency is shown only when `flags.currency` is on.
- **Native screens.** Shown only inside the iOS app.
- **Budget type.** It sets `budgetType` and then calls `reset-budget-cache`.
- **Security (Auth, Encryption).**
- **Data.** Backups (Electron only) and Export.
- **Advanced.** IDs, Reset cache, Repair transactions and Experimental flags.

**Where preferences are stored:**

- **Synced:** the `preferences` table, read and written with `preferences/get` and `preferences/save`.
- **Global per device:** `global-store.json` holds language and theme.
- **Budget metadata:** `metadata.json` holds `budgetName`, `id`, `groupId` and `encryptKeyId`.

**Native-screen switches** are UserDefaults keys read by `NativeScreenSwitch` and written by Swift or by the page's `setNativeScreenOn` through the chrome plugin. They read as follows when unset:

| Switch | Unset reads as | Story that changes it |
| --- | --- | --- |
| Reconcile | on | — |
| Budget, Paychecks | off | sc-5090 flips both to on |
| Accounts | off | sc-3611 task 3.8 flips it and shows its web toggle |
| Add transaction | off | sc-3602 task 3.9 |

**`LIMITS`** (`server/native/reconcile-lock.ts`) holds five synced limits. Each has a default and a ceiling and is read by `readLimit` on every call. Open changes add more: #435 (sc-3602) adds five and #436 (sc-4973) adds one; D11 lists them all.

**The MCP server's own limits** are not in `LIMITS` and are not synced preferences. They come from `packages/mcp/src/limits.ts` (environment) and from each grant: rows, cells, deletes, reconcile, audit tail and line, response bytes, statement age, clock skew, `confirm_destructive`, `allow_reconciled` and scopes. `reconcile-statement-balance` says the operator alone sets statement expiry and skew.

**Sign-out.** `subscribe-sign-out` revokes the server session. It then unloads the encryption keys and removes `user-token`, `encrypt-keys`, `lastBudget` and `readOnly`. The page's `signOut` thunk closes the budget afterwards. The user menu passes `endProviderSession` (openid-true-sign-out).

**Server version.** `get-server-version` asks the server over the network.

## D1. Two reads and one write

**`native/settings`** reads local data only and returns:

- **`prefs`:** `dateFormat`, `numberFormat`, `hideFraction`, `firstDayOfWeekIdx`, `budgetType`, `learn-categories` and `upcomingScheduledTransactionLength`. While `flags.currency` is on it also returns `defaultCurrencyCode`, `currencySymbolPosition` and `currencySpaceBetweenAmountAndSymbol`.
- **`flags`:** whether the currency setting is shown.
- **`budget`:** `{name, id, groupId}`.
- **`encryption`:** `{enabled}`, from `encryptKeyId`.
- **`server`:** `{url}`, or null for a local-only budget, plus `signedIn` and the user's display name.
- **`sync`:** `{pending}`, true while the engine holds changes not yet sent (`messages_pending` has rows).
- **`limits`:** every registry limit as `{id, value, default, ceiling}`, in registry order.
- **`clientVersion`:** added by the page from `window.Actual.ACTUAL_VERSION`. loot-core cannot see it.

**`native/server-info`** returns `{reachable, version}`:

- It calls `get-server-version` with its own deadline: `server-info-timeout-seconds` in the limits registry, default 5, ceiling 30.
- An unreachable server returns `{reachable: false, version: null}`. That is not an error.
- It is separate from `native/settings` so that a slow server never slows the local read.

**`native/settings-save {changes, undoToken}`** replaces sc-4643's working name `native/budget-prefs-save`, because it writes limits too.

- **Input.** `changes` maps keys from a closed list to values. The list is the `prefs` keys above plus every limit id.
- **Validation:**
  - Each value is checked against its closed set: date formats, number formats, budget types, day 0 to 6, booleans, the currency codes and positions, and the upcoming length as the web's picker stores it: a preset from `UPCOMING_LENGTH_PRESET_VALUES` (`1`, `7`, `14`, `oneMonth`, `currentMonth`), or a custom length matching exactly `^[1-9][0-9]{0,2}-(day|week|month|year)$`: 1 to 999 of a known unit, lower case, with no sign, space or leading zero. It is stored exactly as typed, as the web stores it, and the literal `custom` is never stored.
    - The web's own picker (`CustomUpcomingLength.tsx`) can write values this pattern refuses. It saves `${parseInt(input)}-${unit}`, so an empty field writes `NaN-day`, a typed 0 writes `0-day`, a typed minus writes `-3-day`, and there is no upper bound (`1000-day`). Those come from typing outside the field's `min=1` and are not meaningful lengths, so the native save refuses them rather than widening the pattern. That web behaviour is upstream code.
    - A value like that already stored is still returned by `native/settings` as it is, and shown as Custom. Because the save validates only the keys it changes, it never blocks saving another setting.
  - A limit value must be a whole number from 1 to its ceiling, or null, which resets it to the default by deleting the preference.
  - An unknown key, a bad value or an empty `changes` refuses the whole call with `[native:invalid-setting]`. The refusal names no value, and nothing is written.
- **The write:**
  - Every key is written in one batch, with any `reset-budget-cache` the batch needs. Every device and every in-flight read sees either the old set or the new set, never part of one.
  - It is one undo step under the native token.
  - A `budgetType` change runs `reset-budget-cache`, as the web does.
  - Validation and write are one engine function. Every caller uses it: the native save, web Settings › Limits, and the MCP tools in `mcp-settings-tools`. None has a copy.
- **Undo.** Preferences are last write wins (ADR 3). `native/undo` restores the earlier values with no changed-since check, and the spec says so.

Rejected: allowlisting `preferences/save`. It accepts any key, including the import mappings and the per-account flags.

## D2. Allowlists and the page

- **The three names** join both lists, with a test that the two lists are equal.
- **`nativeBridge.ts` forwards only the listed fields:** none for the two reads, and `changes` and `undoToken` for the save.
- **The page adds `clientVersion`** to the `native/settings` result. It is the only field the page adds.
- **The save** joins the origin-guard write names.
- **Raw handlers stay refused natively, with a test:** `preferences/save`, `save-global-prefs`, `subscribe-sign-out`, `set-server-url`, `key-make` and `reset-budget-cache`.

## D3. Latency gate

`settings.perf.test.ts` measures `native/settings` and `native/settings-save` on a seed with 2,000 preference rows (import mappings and per-account flags) and every limit set. The gate is a median under 50 ms. The test prints the median and p95.

`native/server-info` has no gate. It is bounded by its own deadline.

## D4. What is stored where

| Setting | Stored in | Owner | Native writes it through |
| --- | --- | --- | --- |
| Native-screen switches | UserDefaults (per device) | Swift | UserDefaults; the page through `setNativeScreenOn` |
| Formatting, budget type, learn categories, upcoming length, currency | synced `preferences` | engine | `native/settings-save` |
| Limits | synced `preferences` | engine | `native/settings-save` (group 4) |
| Budget name and ids, encryption, server address, user | metadata and global store | engine | read only; changes hand off |
| Language | global store (per device) | engine | hand-off |
| Theme | global store | engine | not offered; see D7 |

Swift stores only the switches. It keeps no copy of engine-owned values beyond the visible view model, and it re-reads on change events and on returning to the foreground.

## D4a. How a changed setting reaches running code

- Engine limits are read through `readLimit` on every call. A change applies on the next call everywhere: this iPhone, other devices once synced, the web, and a running MCP server, which reads them through the engine.
- The MCP server's own limits are read from its environment and grants at start. A change to those needs a restart, and none of them is reachable through `native/settings-save`.
- A device that is behind syncs only the keys it changed, because the save sends only changed keys. It therefore cannot roll back a key it never touched (last write wins per key, ADR 3).

## D5. Native-screen switches

**Rows.** The Native screens section lists one row per switch, from a registry in `NativeScreenSwitch`:

- Budget, Schedules & Paychecks, Reconcile, Accounts, Add transaction, and Settings itself.
- A screen's row appears once its own story ships the screen.
- Each later screen adds its registry entry in its own story.

**Values.**

- A row shows the screen's own current value: the stored value when set, otherwise that screen's default. The default belongs to the screen's story. Today Reconcile reads on while unset; Budget, Paychecks, Accounts and Add transaction read off until sc-5090, sc-3611 and sc-3602 flip them.
- Toggling stores an explicit true or false. An explicit false is kept across updates.
- The native row and web Settings › Native screens write the same key, so both always agree.

**Ownership.**

- This change owns the section and the Settings row.
- sc-5090 owns the Budget and Paychecks unset-reads-on behaviour.
- sc-3611 task 3.8 owns the Accounts default and its web toggle. sc-3602 task 3.9 owns Add transaction's.
- The native section shows whatever the registry says when it ships. It never sets a default itself.

**The Settings switch.** `NativeScreen.settings` reads off while unset until the hands-on pass in task 3.8. That task flips it to on (Ken, 2026-11-15).

- While it is off, the Settings tab is the web screen, and its Native screens section shows the Settings row, so the native screen can be turned back on.
- While it is on, turning it off in native Settings returns the tab to the web screen at once.

## D6. Hand-offs

A row that has no native screen yet sends the chrome message `webSettingsAction {action}`. The page then opens the existing web section, and the native screen steps aside and re-reads when that section closes.

The closed action list, each with the story that makes it native:

| Action | Opens | Made native by |
| --- | --- | --- |
| `language` | the language setting | sc-4621 |
| `budgets` | switch or close the budget file | sc-4621 |
| `sync-server` | change the server address | sc-4637 |
| `encryption` | set up or change the key | sc-4637 |
| `users` | users and access | sc-4638 |
| `bank-sync` | bank sync providers | sc-4639 |
| `business-calendars` | business calendars | sc-4640 |
| `experimental` | experimental features | sc-4641 |
| `export` | export | sc-4642 |
| `reset-cache` | reset cache | sc-4642 |
| `repair` | repair transactions | sc-4642 |
| `notifications` | the fork news page | sc-4621 |
| `sign-out` | the page's sign-out (D8) | sc-4637 |

The chrome refuses anything else, accepts the message only from the app's own page, and reads no field other than `action`. Backups are not offered on iPhone (Ken, 2026-11-16; sc-4648).

## D7. Theme

The native screens follow the system appearance (the Product Owner's decision). Inside the iOS app, the web screens do too:

- The shell tells the page to use `auto` for the session without writing the stored theme. Electron and browsers keep their stored theme.
- Web Settings hides the Themes row while `hasNativeTabBar()` is true.

## D8. Sign-out, server address, encryption

**Sign-out.**

- The Sync section offers Sign out, in red, with a native confirmation: "Sign out of <server>? The budget stays on the server. You'll need to sign in again on this iPhone."
- While `sync.pending` is true, the confirmation also says "Some changes on this iPhone haven't synced yet. Signing out now loses them." It offers Sync now, which runs the allowlisted `sync` and then asks again. Sign out stays available.
- On confirm, Swift sends `webSettingsAction {action: 'sign-out'}`. The page runs its existing sign-out with `endProviderSession: true`, as the user menu does.
- On the device, that removes the session token, the encryption keys, the last-opened budget and the read-only marker, and closes the budget.
- The native view models drop their cached values and show the page's sign-in screen.
- The native-screen switches are kept, because they are device settings, not account data.
- The local budget copy stays on the device, as on the web. An unencrypted budget remains readable there after sign-out.
- Native code keeps no copy of budget data outside the view models it drops.

It stays page-driven because sign-out changes the origin and the session, and the origin guard keys on the page.

**Server address and encryption.** Both are read-only rows with a hand-off to change them:

- The server address shows the host.
- Encryption shows "End-to-end encrypted" or "Not encrypted".

**A local-only budget** (`server` is null; decision of 2026-11-18, story comment 5149):

- The Sync section shows "Server: Local only, not syncing", the line "This budget is stored only on this iPhone. Set up sync to keep a copy on your server.", and a "Set up sync" row. That row hands off with the existing `sync-server` action (sc-4637).
- There is no Sign out row and no Encryption row: there is nothing to sign out of, and an encryption state would mislead.
- About shows "Server: not syncing", with no Retry. `native/server-info` is not called.

## D9. AI

No AI-use setting exists in the app today, and nothing in this change uses AI. When AI features arrive, their setting (off, local model, or bring-your-own-key, with a working no-AI path) belongs in Settings under Features, as story 5111.

## D10. View model and screen

**`SettingsViewModel`** (`NativeBridgeCore`) is tested against the fake transport and the fixtures:

- The first load is redacted: every section on its real layout, with placeholder values and no spinner (Reduce Motion: no shimmer). VoiceOver reads "Loading settings".
- If the first read fails, the tab shows an error with Retry instead of the sections.
- The native-screen switches show at once, because Swift stores them.
- A re-read keeps the old values.
- Events for `preferences` and `sync` coalesce into one re-read.
- It makes no calls in the background.
- An edit is sent with a token and shows an Undo toast. Time in the tests uses an injected sleep.
- A refusal restores the shown value and says "Couldn't save that setting".
- A timeout says the save didn't finish and offers Retry.

**The iPhone tab** follows the Figma frames:

- **Budget card:** the budget name, and Switch budget (hand-off).
- **Budget:** Formatting drill-down (date, number, hide decimals, first day of week, currency when flagged), Budget type (with a confirmation that explains the change), Learn categories, and Upcoming length. The Upcoming length picker offers exactly the web's choices (`UPCOMING_LENGTH_PRESET_OPTIONS` and Custom length, a number and a unit), with the same stored values (story comment 5151).
- **This iPhone:** the Native screens switches, and Language (hand-off, "Opens the web version"). Both are per-device settings. Language is not a feature.
- **Sync:** server, encryption, Sign out. For a local-only budget, the local-only rows above instead.
- **Features and Data:** the remaining hand-off rows.
- **Advanced:** budget and sync ids, which can be copied, and Limits (group 4).
- **About:** the client version, the iPhone app version and build (from the bundle), the server version, or "Server unreachable" with Retry, and Notifications (hand-off).

**Copy.** Exact text comes from the approved copy table: Figma node 90:1489, with the Product Owner's corrections in story comment 5151. Each string is a localized string, and wording quoted here is illustrative. Never say "web view"; a hand-off reads "Opens the web version".

## D11. Limits (group 4, sc-4643)

**The registry.** After #435 and #436 land:

| Limit | Name shown | Protects | Default | Ceiling |
| --- | --- | --- | --- | --- |
| `reconcile-match-max-candidates` | Reconcile: rows searched for a match | Keeps matching fast on a large account | 300 | 2000 |
| `reconcile-match-max-results` | Reconcile: matches shown | Keeps the match list short | 5 | 20 |
| `reconcile-lock-list-max-rows` | Reconcile: rows listed when locking | Keeps the lock summary readable | 200 | 2000 |
| `accounts-register-page-size` | Register: rows per page | Keeps the register fast on a large account | 50 | 200 |
| `accounts-write-max-ids` | Register: rows changed at once | Limits how much one tap can change | 100 | 500 |
| `accounts-register-upcoming-max-days` | Scheduled rows: days ahead | Keeps the register's upcoming list bounded | 92 | 366 |
| `payee-picker-max-results` | Payee search: results shown | Keeps payee search fast | 50 | 500 |
| `payee-search-max-length` | Payee search: longest search | Keeps search cheap | 100 | 200 |
| `payee-name-max-length` | New payee: longest name | Keeps payee lists readable | 200 | 500 |
| `transaction-notes-max-length` | Notes: longest note | Keeps each transaction small | 10,000 | 50,000 |
| `transaction-split-max-children` | Splits: most parts | Keeps a split editable | 50 | 200 |
| `server-info-timeout-seconds` | About: server check wait | Stops About waiting on a dead server | 5 | 30 |

A change that adds a limit to `LIMITS` adds its name and help line in the same PR.

**What is not here.** The MCP server's own limits (Facts) are never in `LIMITS` and are never settable through `native/settings-save`. They stay with the operator: environment, server configuration and grants. #435 keeps no retry tokens, so it has no lifetime limit.

**Tests.**

- The `native/settings` limits equal the `LIMITS` registry.
- Every registry id has a localized name and help line, or the build fails.
- A key the MCP server enforces is refused by the save.

**Native screen.**

- One row per limit, with its name, its help line, the value, "Default 50", and a stepper and a number field bounded by the ceiling ("Up to 200").
- Reset to default sends null.

**Web.** Web Settings › Advanced gets the same list through a page call to the same handler code, so web, iPhone and MCP store identical values.

## D12. Keyboard and accessibility

These are requirements, not polish.

- **With a hardware keyboard:**
  - Tab and the arrows move between rows; Space toggles a switch; Return opens a drill-down; Esc goes back.
  - In the number fields, typed digits and Return save.
  - ⌘, selects the Settings tab.
- **VoiceOver** reads each row's label, value and state. A switch reads as a switch. A hand-off row says "Opens the web version".
- **Dynamic Type to AX5:** values move under their labels, and the version strings wrap rather than truncate.
- **Dark Mode** uses the HE colour variables. All text is localized.

## Risks

- **Old clients.** A synced limit or preference changed natively applies on every device. Older clients ignore limits they don't know.
- **Hand-offs** leave the native tab until each sc-4621 story ships.
- **Page script** could send `native/settings-save`. Every value is validated, so the worst case is a valid, undoable preference change.

## Decisions for Ken

None. The Product Owner recorded every open point in comment 5093.

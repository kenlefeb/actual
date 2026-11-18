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

**`LIMITS`** (`server/native/reconcile-lock.ts`) holds five synced limits. Each has a default and a ceiling and is read by `readLimit`. sc-3602 adds two more: `payee-picker-max-results` and `transaction-split-max-children`.

**Sign-out.** `subscribe-sign-out` revokes the server session. It then unloads the encryption keys and removes `user-token`, `encrypt-keys`, `lastBudget` and `readOnly`. The page's `signOut` thunk closes the budget afterwards. The user menu passes `endProviderSession` (openid-true-sign-out).

**Server version.** `get-server-version` asks the server over the network.

## D1. Two reads and one write

**`native/settings`** reads local data only and returns:

- **`prefs`:** `dateFormat`, `numberFormat`, `hideFraction`, `firstDayOfWeekIdx`, `budgetType`, `learn-categories` and `upcomingScheduledTransactionLength`. While `flags.currency` is on it also returns `defaultCurrencyCode`, `currencySymbolPosition` and `currencySpaceBetweenAmountAndSymbol`.
- **`flags`:** whether the currency setting is shown.
- **`budget`:** `{name, id, groupId}`.
- **`encryption`:** `{enabled}`, from `encryptKeyId`.
- **`server`:** `{url}`, or null for a local-only budget, plus `signedIn` and the user's display name.
- **`limits`:** every registry limit as `{id, value, default, ceiling}`.
- **`clientVersion`:** added by the page from `window.Actual.ACTUAL_VERSION`. loot-core cannot see it.

**`native/server-info`** returns `{reachable, version}`:

- It calls `get-server-version` with its own deadline: `server-info-timeout-seconds` in the limits registry, default 5, ceiling 30.
- An unreachable server returns `{reachable: false, version: null}`. That is not an error.
- It is separate from `native/settings` so that a slow server never slows the local read.

**`native/settings-save {changes, undoToken}`** replaces sc-4643's working name `native/budget-prefs-save`, because it writes limits too.

- **Input.** `changes` maps keys from a closed list to values. The list is the `prefs` keys above plus every limit id.
- **Validation:**
  - Each value is checked against its closed set: date formats, number formats, budget types, day 0 to 6, booleans, the currency codes and positions, and upcoming lengths from the web's list.
  - A limit value must be a whole number from 1 to its ceiling, or null, which resets it to the default by deleting the preference.
  - An unknown key, a bad value or an empty `changes` refuses the whole call with `[native:invalid-setting]`. The refusal names no value, and nothing is written.
- **The write:**
  - `preferences/save` for every key, in one undo step under the native token.
  - A `budgetType` change runs `reset-budget-cache` inside the same handler, as the web does.
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
| Limits | synced `preferences` | engine | `native/settings-save` (group 5) |
| Budget name and ids, encryption, server address, user | metadata and global store | engine | read only; changes hand off |
| Language | global store (per device) | engine | hand-off |
| Theme | global store | engine | not offered; see D7 |

Swift stores only the switches. It keeps no copy of engine-owned values beyond the visible view model, and it re-reads on change events and on returning to the foreground.

## D5. Native-screen switches

**Rows.** The Native screens section lists one row per switch, from a registry in `NativeScreenSwitch`:

- Budget, Schedules & Paychecks, Reconcile, Accounts, Add transaction, and Settings itself.
- A screen's row appears once its own story ships the screen.
- Each later screen adds its registry entry in its own story.

**Values.**

- A row shows on when the key is unset or true.
- Toggling stores an explicit true or false. An explicit false is kept across updates.
- The native row and web Settings › Native screens write the same key, so both always agree.

**Ownership.**

- This change owns the section and the Settings row.
- sc-5090 owns the Budget and Paychecks unset-reads-on behaviour.
- sc-3611 task 3.8 owns the Accounts default and its web toggle. sc-3602 task 3.9 owns Add transaction's.
- The native section shows whatever the registry says when it ships. It never sets a default itself.

**The Settings switch.** `NativeScreen.settings` reads off while unset until the hands-on pass in task 4.8. That task flips it to on (Ken, 2026-11-15).

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

The chrome refuses anything else, and it accepts the message only from the app's own page. Backups are not offered on iPhone (Ken, 2026-11-16; sc-4648).

## D7. Theme

The native screens follow the system appearance (the Product Owner's decision). Inside the iOS app, the web screens do too:

- The shell tells the page to use `auto` for the session without writing the stored theme. Electron and browsers keep their stored theme.
- Web Settings hides the Themes row while `hasNativeTabBar()` is true.

## D8. Sign-out, server address, encryption

**Sign-out.**

- The Sync section offers Sign out, in red, with a native confirmation: "Sign out of <server>? The budget stays on the server. You'll need to sign in again on this iPhone."
- On confirm, Swift sends `webSettingsAction {action: 'sign-out'}`. The page runs its existing sign-out with `endProviderSession: true`, as the user menu does.
- On the device, that removes the session token, the encryption keys, the last-opened budget and the read-only marker, and closes the budget.
- The native view models drop their cached values and show the page's sign-in screen.
- The native-screen switches are kept, because they are device settings, not account data.

It stays page-driven because sign-out changes the origin and the session, and the origin guard keys on the page.

**Server address and encryption.** Both are read-only rows with a hand-off to change them:

- The server address shows the host, or "Local only — not syncing".
- Encryption shows "End-to-end encrypted" or "Not encrypted".

## D9. AI

No AI-use setting exists in the app today, and nothing in this change uses AI. When AI features arrive, their setting (off, local model, or bring-your-own-key, with a working no-AI path) belongs in Settings under Features. The Product Owner is to file a placeholder story for that row.

## D10. View model and screen

**`SettingsViewModel`** (`NativeBridgeCore`) is tested against the fake transport and the fixtures:

- The first load is redacted.
- A re-read keeps the old values.
- Events for `preferences` and `sync` coalesce into one re-read.
- It makes no calls in the background.
- An edit is sent with a token and shows an Undo toast. Time in the tests uses an injected sleep.
- A refusal restores the shown value and says "Couldn't save that setting".
- A timeout says the save didn't finish and offers Retry.

**The iPhone tab** follows the Figma frames:

- **Budget card:** the budget name, and Switch budget (hand-off).
- **Budget:** Formatting drill-down (date, number, hide decimals, first day of week, currency when flagged), Budget type (with a confirmation that explains the change), Learn categories, and Upcoming length.
- **Native screens.**
- **Sync:** server, encryption, Sign out.
- **Features and Data:** the hand-off rows.
- **Advanced:** budget and sync ids, which can be copied, and Limits (group 5).
- **About:** the client version, the iPhone app version and build (from the bundle), the server version, or "Server unreachable" with Retry, and Notifications (hand-off).

## D11. Limits drill-down (group 5, sc-4643)

**Native.**

- One row per limit, showing the value and the default ("Default 50"), with a stepper and a number field bounded by the ceiling.
- Reset to default sends null.
- Labels and help text come from a localized table keyed by the limit id. A limit id without a label falls back to the id, so a new limit is never hidden.

**Web.** Web Settings › Advanced gets the same list through a page call to the same handler code, so web, iPhone and MCP store identical values.

## D12. Keyboard and accessibility

These are requirements, not polish.

- **With a hardware keyboard:**
  - Tab and the arrows move between rows; Space toggles a switch; Return opens a drill-down; Esc goes back.
  - In the number fields, typed digits and Return save.
  - ⌘, selects the Settings tab.
- **VoiceOver** reads each row's label, value and state. A switch reads as a switch. A hand-off row says "Opens in the web view".
- **Dynamic Type to AX5:** values move under their labels, and the version strings wrap rather than truncate.
- **Dark Mode** uses the HE colour variables. All text is localized.

## Risks

- **Old clients.** A synced limit or preference changed natively applies on every device. Older clients ignore limits they don't know.
- **Hand-offs** leave the native tab until each sc-4621 story ships.
- **Page script** could send `native/settings-save`. Every value is validated, so the worst case is a valid, undoable preference change.

## Decisions for Ken

None. The Product Owner recorded every open point in comment 5093.

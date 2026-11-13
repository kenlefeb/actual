This is the main project to run [Actual](https://github.com/actualbudget/actual), a local-first personal finance tool. It comes with the latest version of Actual, and a server to persist changes and make data available across all devices.

### Getting Started

Actual is a local-first personal finance tool. It is 100% free and open-source, written in NodeJS, it has a synchronization element so that all your changes can move between devices without any heavy lifting.

If you are interested in contributing, or want to know how development works, see our [contributing](https://actualbudget.org/docs/contributing/) document we would love to have you.

Want to say thanks? Click the ⭐ at the top of the page.

### Using the CLI tool

Node.js v22 or higher is required for the @actual-app/sync-server npm package

**Install globally with npm:**

```bash
npm install --location=global @actual-app/sync-server
```

After installing, you can execute actual-server commands directly in your terminal.

**Usage**

```bash
actual-server [options]
```

**Available options**

| Command             | Description                  |
| ------------------- | ---------------------------- |
| `-h` or `--help`    | Print this list and exit.    |
| `-v` or `--version` | Print this version and exit. |
| `--config`          | Path to the config file.     |
| `--reset-password`  | Reset your password          |

**Examples**

Run with default configuration

```bash
actual-server
```

Run with custom configuration

```bash
actual-server --config ./config.json
```

Reset your password

```bash
actual-server --reset-password
```

### Removed documents (fork only)

Documents attached to transactions are deleted from the server 30 days after every device has reported them removed, and a budget deleted on the server has its documents deleted 30 days later. A daily job does the deleting, at most 500 per run, and logs each deletion.

- `attachments.orphanRetentionDays` (`ACTUAL_ATTACHMENTS_ORPHAN_RETENTION_DAYS`), default `30`: the days to wait. Set it to `0` to stop all deletion at once. The server refuses to start with a negative, fractional or non-numeric value.
- `/metrics` includes an `attachments` block: `bytes` (all stored documents), `removalBytes` and `removalCount` (stored documents waiting to be deleted), and `lastCleanup` (`at`, `deleted`, and `result`, which is `ok`, `partial` or `error`). It names no budget or file, and its totals are refreshed at most once a minute.

### Documentation

We have a wide range of documentation on how to use Actual. This is all available in our [Community Documentation](https://actualbudget.org/docs/), including topics on [installing](https://actualbudget.org/docs/install/), [Budgeting](https://actualbudget.org/docs/budgeting/), [Account Management](https://actualbudget.org/docs/accounts/), [Tips & Tricks](https://actualbudget.org/docs/getting-started/tips-tricks) and some documentation for developers.

### Feature Requests

Current feature requests can be seen [here](https://github.com/actualbudget/actual/issues?q=is%3Aissue+label%3A%22needs+votes%22+sort%3Areactions-%2B1-desc). Vote for your favorite requests by reacting 👍 to the top comment of the request.

To add new feature requests, open a new Issue of the "Feature Request" type.

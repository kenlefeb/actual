# Sync-server access log: daily off-host copy

Fork-only; never upstream. Spec: `openspec/changes/production-identities`
(requirement "Every request is attributable to an identity"). Used by the
vault-separation slice (slice D).

## What the log is

The sync server writes one JSON line to stdout for each request that touches a
budget file (the container's log, for example `docker logs`):

```json
{
  "event": "file-access",
  "time": "2026-11-02T00:57:14.513Z",
  "userId": "…",
  "fileId": "…",
  "method": "POST",
  "route": "/sync/sync",
  "status": 200
}
```

It holds the user id, file id, method, route, status and time. It never holds a
token, a password, a request body, a query string or budget content. Denied
requests appear with status 403. Requests that touch no budget (for example
listing files) are not logged. Filter with `grep '"event":"file-access"'`.

## Why copy it off the host

The spec requires the log to be copied to a place that agents and the VPS
cannot rewrite, and kept at least 90 days. Container logs on the VPS can be
rotated or edited by anyone with root there.

## Daily pull (Mac mini)

Same pattern as the nightly ciphertext backup (`pull-backup.py`): the Mac mini
pulls, the VPS pushes nothing, and the Mac mini logs in to nothing but a forced
command.

1. On the VPS, a forced-command SSH key (separate from the backup key) may run
   only one command: print the previous day's `file-access` lines, for example
   `docker logs --since 24h <sync-server container> 2>&1 | grep '"event":"file-access"'`.
   The container name and the `authorized_keys` entry belong to the production
   compose template (Release & Operations Engineer).
2. Once a day the Mac mini runs that key and writes the output to
   `access-log/YYYY-MM-DD.jsonl` in a directory only Ken's account can write.
3. Check after each pull: the file is non-empty on a day anyone synced, every
   line parses as JSON, and every line has only the keys `event`, `time`,
   `userId`, `fileId`, `method`, `route`, `status`.

## Retention: 90 days

Keep each daily file at least 90 days, then delete files older than that, for
example `find access-log -name '*.jsonl' -mtime +90 -delete`. Never delete
earlier. Overlapping pulls are harmless; de-duplicate by whole line.

## Not covered here

Installing the forced-command key and the Mac mini job touches production and
the VPS, so it is Ken's gate and part of slice D's checklist, written after
LOCKDOWN (sc-563).

# Tasks

## 1. Hosted entry is read-write

- [x] 1.1 Tests first: the hosted entry lists the `--writes` entry's tools, a hosted write is audited with its OAuth subject, the hosted engine opens read-write, the hosted config sets writes and its audit log, and the stdio entry allows `--writes` on an allowed production host.
- [x] 1.2 Register the write tools on the hosted entry with its audit log and identity, open the engine read-write, and drop the stdio production `--writes` refusal.
- [x] 1.3 Update the README and add a release note.

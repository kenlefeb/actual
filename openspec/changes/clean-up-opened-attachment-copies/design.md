# Design

- Copies live in `actual-attachment-*` folders made by `mkdtemp` in `app.getPath('temp')`. Cleanup removes only directories with that prefix, so other temp files are never touched.
- Cleanup runs on `before-quit` and on `ready`. It is synchronous so quitting cannot cut it short, and best effort: an error (for example a Windows viewer still holding the file) is ignored and the next start retries.
- It never runs right after an open, so the viewer can read the file.
- Known limit: a second app instance starting while the first has a document open would remove that copy. Accepted for a single-user desktop app.

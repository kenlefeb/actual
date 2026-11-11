# Proposal

## Why

The desktop app cannot open a new window, so "Open" writes a plain (decrypted) copy of the document to the OS temp folder and hands it to the OS viewer. Nothing deletes those copies, so receipts and invoices from an encrypted budget pile up unencrypted on disk (sc-2528). The spec has no rule for them.

## What Changes

- Adds a requirement that the desktop app removes the temporary copies it made for opening: when the app quits, and at the next start for a run that crashed. A copy is never removed right after opening, because the OS viewer may still be reading it.
- Code: `packages/desktop-electron` (`attachment-temp.ts`, hooked into `index.ts`).
- Out of scope: the phone (it shows documents inside the app and writes no such copy); copies the user saves elsewhere on purpose.

Mobile scope: none, with the reason above. No Ken-approved exception is needed.

## Capabilities

### New Capabilities

- none

### Modified Capabilities

- `transaction-attachments`: adds "Temporary copies are removed".

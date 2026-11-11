# Tasks

## 1. Spec (sc-2528)

- [ ] 1.1 Solution Architect and Product Owner review this change (spec PRs need both). Verify `npx openspec validate clean-up-opened-attachment-copies --strict` and `yarn check:openspec-shortcut` pass.

## 2. Desktop cleanup (sc-2528)

- [x] 2.1 Write failing tests in `desktop-electron/tests/attachment-temp.test.ts` for removing `actual-attachment-*` folders only and for a missing temp folder. See them fail.
- [x] 2.2 Implement `attachment-temp.ts` and call it on `before-quit` and `ready`. Verify the tests pass.

# Tasks

Tests first: write the tests, see them fail, then write the code.

## 1. Budget and Paychecks read on when unset (sc-5090)

- [x] 1.1 Failing tests: unset reads on for Budget and Paychecks (Swift and page), explicit off stays off, explicit on stays on, Accounts unset stays off, and a shared-file test that keeps page and Swift defaults equal. Verify: they fail before the code change.
- [x] 1.2 Swift `NativeScreenSwitch` and page `isNativeScreenOn` read on when unset for Budget and Paychecks; Settings text and tests follow. Verify: the tests pass.
- [x] 1.3 Release note, `yarn typecheck`, `yarn lint`, Swift tests, `yarn check:native-swift`, `openspec validate --all --strict`, and an iPhone simulator build.

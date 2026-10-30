// Run from the repo root: `node --test fork/scripts/*.test.mjs`.
import assert from 'node:assert/strict';
// oxlint-disable-next-line actual/no-extraneous-dependencies -- node:test is a builtin that exists only with the node: prefix, so Module.builtinModules omits it
import { test } from 'node:test';

import { parseScenarios, untested } from './check-spec-scenarios.mjs';

const spec = `## Requirements

### Requirement: Paycheck schedules
#### Scenario: Both devices add a deposit
- **WHEN** …
#### Scenario:   Saving "Acme" again
- **THEN** …
### Requirement: Hidden
#### Scenario: Hidden when the feature is off
`;

void test('parseScenarios reads each scenario name, trimmed', () => {
  assert.deepEqual(parseScenarios(spec), [
    'Both devices add a deposit',
    'Saving "Acme" again',
    'Hidden when the feature is off',
  ]);
});

void test('untested lists scenarios no test names, by spec', () => {
  const specs = new Map([['paychecks', parseScenarios(spec)]]);
  const tests = [
    "it('Both devices add a deposit', () => {});",
    // A suffix after the name still counts, as in "Name: what it checks"
    'it(\'Saving "Acme" again: keeps the schedules\', () => {});',
  ];
  assert.deepEqual(untested(specs, tests), [
    { spec: 'paychecks', scenario: 'Hidden when the feature is off' },
  ]);
});

void test('untested matches the exact name, not a looser one', () => {
  const specs = new Map([['paychecks', ['Hidden when the feature is off']]]);
  assert.deepEqual(untested(specs, ["it('hidden when the feature is off')"]), [
    { spec: 'paychecks', scenario: 'Hidden when the feature is off' },
  ]);
});

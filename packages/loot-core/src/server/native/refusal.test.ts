import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { NATIVE_REFUSAL_CODES, nativeRefusal } from './refusal';

const codes: string[] = JSON.parse(
  readFileSync(
    path.join(__dirname, 'fixtures/native-refusal-codes.json'),
    'utf8',
  ),
);

// sc-3611 (native-bridge: "Native refusals carry a stable code"). Native code
// branches on the code token, never on the wording after it; the fixture is
// the contract the Swift package tests against too.
describe('native refusal codes', () => {
  it('are the contract fixture', () => {
    expect([...NATIVE_REFUSAL_CODES]).toEqual(codes);
  });

  it('put the token first, with optional machine detail, and leave the words free', () => {
    expect(
      nativeRefusal('undo-nothing', 'native/undo: nothing to undo').message,
    ).toBe('[native:undo-nothing] native/undo: nothing to undo');
    expect(
      nativeRefusal('invalid-draft', 'native/paycheck-save: invalid draft', [
        'name-missing',
        'amount-zero',
      ]).message,
    ).toBe(
      '[native:invalid-draft:name-missing,amount-zero] native/paycheck-save: invalid draft',
    );
  });

  // Each code is thrown somewhere in the native handlers; the behaviour tests
  // (accounts-writes, undo, app, paycheck-editor) check each one fires
  it('is each thrown by a native handler', () => {
    const dir = __dirname;
    const source = readdirSync(dir)
      .filter(
        f => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'refusal.ts',
      )
      .map(f => readFileSync(path.join(dir, f), 'utf8'))
      .join('\n');
    for (const code of codes) {
      expect(source).toMatch(new RegExp(`nativeRefusal\\(\\s*'${code}'`));
    }
  });
});

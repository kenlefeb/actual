import { readFileSync } from 'node:fs';
import path from 'node:path';

// Guards the production-server Dependabot fixes: yarn.lock must not resolve
// the vulnerable versions again.
const lock = readFileSync(
  path.resolve(__dirname, '../../../yarn.lock'),
  'utf8',
);

function resolvedVersions(name: string): string[] {
  const re = new RegExp(`^"?${name}@[^\\n]*:\\n  version: (\\S+)`, 'gm');
  return [...lock.matchAll(re)].map(m => m[1]);
}

function atLeast(version: string, min: string): boolean {
  const a = version.split('.').map(Number);
  const b = min.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return true;
}

describe('patched dependency versions', () => {
  it('resolves follow-redirects at 1.16.2 or newer', () => {
    const versions = resolvedVersions('follow-redirects');
    expect(versions.length).toBeGreaterThan(0);
    for (const v of versions) expect(atLeast(v, '1.16.2')).toBe(true);
  });

  it('resolves uuid at 11.1.1 or newer', () => {
    const versions = resolvedVersions('uuid');
    expect(versions.length).toBeGreaterThan(0);
    for (const v of versions) expect(atLeast(v, '11.1.1')).toBe(true);
  });
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import afterPack from './mas-fix-permissions.cjs';

test('makes root-only files readable and keeps execute bits and symlinks', async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'mas-perm-'));
  const app = path.join(out, 'Home Economics.app');
  const dir = path.join(app, 'Contents/Resources/node_modules/x');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const secret = path.join(dir, 'index.js');
  const exe = path.join(app, 'Contents/MacOS-tool');
  const link = path.join(app, 'Contents/outside');
  fs.writeFileSync(secret, 'x', { mode: 0o600 });
  fs.writeFileSync(exe, 'x', { mode: 0o700 });
  const outside = path.join(out, 'outside.txt');
  fs.writeFileSync(outside, 'x', { mode: 0o600 });
  fs.symlinkSync(outside, link);
  fs.chmodSync(dir, 0o700);
  fs.chmodSync(secret, 0o600);

  await afterPack({
    electronPlatformName: 'mas',
    appOutDir: out,
    packager: { appInfo: { productFilename: 'Home Economics' } },
  });

  const mode = f => fs.statSync(f).mode & 0o777;
  assert.equal(mode(secret), 0o644);
  assert.equal(mode(dir), 0o755);
  assert.equal(mode(exe), 0o755);
  assert.equal(mode(outside), 0o600); // symlink target left alone

  // Other platforms are untouched.
  fs.chmodSync(secret, 0o600);
  await afterPack({
    electronPlatformName: 'darwin',
    appOutDir: out,
    packager: { appInfo: { productFilename: 'Home Economics' } },
  });
  assert.equal(mode(secret), 0o600);
  fs.rmSync(out, { recursive: true });
});

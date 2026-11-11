import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { test } from 'vitest';

import {
  ATTACHMENT_TEMP_PREFIX,
  removeAttachmentTempDirs,
} from '../attachment-temp';

test('removes opened attachment copies and leaves other temp files alone', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'actual-temp-test-'));
  try {
    const copy = join(temp, `${ATTACHMENT_TEMP_PREFIX}abc123`);
    await mkdir(copy);
    await writeFile(join(copy, 'receipt.pdf'), 'decrypted');
    const other = join(temp, 'other-app-file');
    await mkdir(other);
    const lookalike = join(temp, `${ATTACHMENT_TEMP_PREFIX}notes.txt`);
    await writeFile(lookalike, 'file');

    removeAttachmentTempDirs(temp);

    assert.equal(existsSync(copy), false);
    assert.equal(existsSync(other), true);
    // Only the folders the app made are removed, never a lookalike file.
    assert.equal(existsSync(lookalike), true);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('does not throw when the temp folder is missing', () => {
  assert.doesNotThrow(() =>
    removeAttachmentTempDirs(join(tmpdir(), 'actual-temp-does-not-exist')),
  );
});

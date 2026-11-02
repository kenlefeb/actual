// Run from the repo root: `node --test fork/scripts/*.test.mjs`.
// The hosted MCP image builds with `COPY . /app` (hosting repo, Dockerfile.mcp): a stray local `.env` must not be copied in.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// oxlint-disable-next-line actual/no-extraneous-dependencies -- node:test is a builtin that exists only with the node: prefix, so Module.builtinModules omits it
import { test } from 'node:test';

const lines = readFileSync(
  new URL('../../.dockerignore', import.meta.url),
  'utf8',
)
  .split('\n')
  .map(l => l.trim());

void test('.dockerignore keeps local env files out of the build context', () => {
  for (const pattern of ['**/.env', '**/.env.local', '**/.env.*.local']) {
    assert.ok(lines.includes(pattern), `missing ${pattern}`);
  }
});

void test('.dockerignore leaves the committed build-time env files alone', () => {
  // packages/desktop-client/.env.browser and .env.production are tracked and the web build reads them
  assert.ok(!lines.includes('**/.env.*') && !lines.includes('.env*'));
});

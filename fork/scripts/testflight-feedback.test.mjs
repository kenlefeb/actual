import assert from 'node:assert/strict';
import { createVerify, generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  makeToken,
  parseSubmissions,
  summarise,
} from './testflight-feedback.mjs';

const load = name =>
  JSON.parse(
    readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'),
  );

const shots = parseSubmissions(
  load('testflight-screenshot-submissions.json'),
  'screenshot',
);
const crashes = parseSubmissions(
  load('testflight-crash-submissions.json'),
  'crash',
);

void test('parses a screenshot submission', () => {
  assert.equal(shots.length, 1);
  assert.equal(shots[0].id, 'FIXTURE-SHOT-0001');
  assert.equal(shots[0].device, 'iPad15_4');
  assert.equal(shots[0].os, '27.3');
  assert.equal(shots[0].comment, 'The top is overlapping with OS components.');
  assert.match(
    shots[0].screenshots[0],
    /^https:\/\/tf-feedback\.itunes\.apple\.com\//,
  );
});

void test('summary lists details and flags only crashes', () => {
  const text = summarise([...shots, ...crashes], '2026-11-01');
  assert.match(text, /FIXTURE-SHOT-0001 {2}2026-11-11T17:59:48.493Z\n/);
  assert.match(text, /device: iPad15_4 {2}OS: 27.3/);
  assert.match(text, /screenshot: https:/);
  assert.match(text, /CRASH-EXAMPLE-1 {2}2026-11-12T09:30:00.000Z {2}CRASH/);
  assert.equal(text.match(/ {2}CRASH\n/g).length, 1);
});

void test('summary drops feedback before --since and handles none', () => {
  assert.equal(summarise(shots, '2026-11-12'), 'No new TestFlight feedback.');
  assert.equal(summarise([], '2026-11-01'), 'No new TestFlight feedback.');
});

void test('handles empty data and missing fields', () => {
  assert.deepEqual(parseSubmissions({}, 'crash'), []);
  assert.equal(
    parseSubmissions({ data: [{ id: 'x' }] }, 'crash')[0].comment,
    '',
  );
});

void test('signs an ES256 JWT that verifies and holds no key', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
  });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const token = makeToken({ keyId: 'KID', issuerId: 'ISS', pem }, 1_000_000);
  const [h, b, s] = token.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url')), {
    alg: 'ES256',
    kid: 'KID',
    typ: 'JWT',
  });
  assert.equal(JSON.parse(Buffer.from(b, 'base64url')).iss, 'ISS');
  assert.ok(
    createVerify('SHA256')
      .update(`${h}.${b}`)
      .verify(
        { key: publicKey, dsaEncoding: 'ieee-p1363' },
        Buffer.from(s, 'base64url'),
      ),
  );
});

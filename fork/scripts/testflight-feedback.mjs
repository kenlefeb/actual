// Fork-only (sc-3555): list TestFlight beta feedback for the iOS app, as part
// of release prep (see "TestFlight feedback" in AGENTS.md).
//
//   ASC_KEY_ID=... ASC_ISSUER_ID=... ASC_KEY_P8=... \
//     node fork/scripts/testflight-feedback.mjs [--since YYYY-MM-DD]
//
// Without --since it uses the commit date of the newest change under
// fork/release-notes. Prints one block per submission; never prints the key.
import { execFileSync } from 'node:child_process';
import { createSign } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { normalizePem } from './normalize-pem.mjs';

const API = 'https://api.appstoreconnect.apple.com/v1';
const BUNDLE_ID = 'app.homeeconomics.budget';

const b64url = input => Buffer.from(input).toString('base64url');

export function makeToken({ keyId, issuerId, pem }, now = Date.now()) {
  const iat = Math.floor(now / 1000);
  const head = b64url(JSON.stringify({ alg: 'ES256', kid: keyId, typ: 'JWT' }));
  const body = b64url(
    JSON.stringify({
      iss: issuerId,
      iat,
      exp: iat + 600,
      aud: 'appstoreconnect-v1',
    }),
  );
  const sig = createSign('SHA256')
    .update(`${head}.${body}`)
    .sign({ key: pem, dsaEncoding: 'ieee-p1363' });
  return `${head}.${body}.${sig.toString('base64url')}`;
}

// One API response body to plain records. kind: 'screenshot' or 'crash'.
export function parseSubmissions(json, kind) {
  return (json.data ?? []).map(({ id, attributes: a = {} }) => ({
    id,
    kind,
    date: a.createdDate,
    device: a.deviceModel,
    os: a.osVersion,
    comment: a.comment ?? '',
    screenshots: (a.screenshots ?? []).map(s => s.url),
  }));
}

export function summarise(records, since) {
  const cutoff = since ? Date.parse(since) : -Infinity;
  const kept = records
    .filter(r => Date.parse(r.date) >= cutoff)
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  if (!kept.length) return 'No new TestFlight feedback.';
  return kept
    .map(r =>
      [
        `${r.id}  ${r.date}${r.kind === 'crash' ? '  CRASH' : ''}`,
        `  device: ${r.device ?? '?'}  OS: ${r.os ?? '?'}`,
        `  comment: ${r.comment || '(none)'}`,
        ...r.screenshots.map(u => `  screenshot: ${u}`),
      ].join('\n'),
    )
    .join('\n\n');
}

async function get(url, token) {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const why = (json.errors ?? [])
      .map(e => `${e.title}: ${e.detail}`)
      .join('; ');
    throw new Error(
      `App Store Connect ${res.status} for ${url.split('?')[0]}: ${why}`,
    );
  }
  return json;
}

async function fetchAll(url, kind, token) {
  const out = [];
  for (let next = url; next;) {
    const json = await get(next, token);
    out.push(...parseSubmissions(json, kind));
    next = json.links?.next;
  }
  return out;
}

const lastReleaseDate = () =>
  execFileSync(
    'git',
    ['log', '-1', '--format=%cI', '--', 'fork/release-notes'],
    {
      encoding: 'utf8',
    },
  ).trim();

async function main(argv, env) {
  const i = argv.indexOf('--since');
  const since = i >= 0 ? argv[i + 1] : lastReleaseDate();
  if (!since || Number.isNaN(Date.parse(since))) {
    throw new Error('Pass --since YYYY-MM-DD (a valid date).');
  }
  const { ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_P8 } = env;
  if (!ASC_KEY_ID || !ASC_ISSUER_ID || !ASC_KEY_P8) {
    throw new Error('Set ASC_KEY_ID, ASC_ISSUER_ID and ASC_KEY_P8.');
  }
  const token = makeToken({
    keyId: ASC_KEY_ID,
    issuerId: ASC_ISSUER_ID,
    pem: normalizePem(ASC_KEY_P8),
  });
  const apps = await get(`${API}/apps?filter[bundleId]=${BUNDLE_ID}`, token);
  const appId = apps.data?.[0]?.id;
  if (!appId) throw new Error(`No app with bundle id ${BUNDLE_ID}.`);
  const base = `${API}/apps/${appId}`;
  const records = [
    ...(await fetchAll(
      `${base}/betaFeedbackScreenshotSubmissions?limit=200`,
      'screenshot',
      token,
    )),
    ...(await fetchAll(
      `${base}/betaFeedbackCrashSubmissions?limit=200`,
      'crash',
      token,
    )),
  ];
  console.log(`TestFlight feedback since ${since}\n`);
  console.log(summarise(records, since));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2), process.env).catch(err => {
    console.error(err.message);
    process.exit(1);
  });
}

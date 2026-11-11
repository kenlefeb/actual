// Fork-only (sc-3398): Apple's MARKETING_VERSION accepts only x.y.z integers,
// so the fork version maps to major.minor.(patch × 10000 + n), with n the alpha
// number (1–9998) and 9999 for the stable release, which then sorts above all
// its alphas. Run with `node fork/scripts/apple-version.mjs <version>`.
import { fileURLToPath } from 'node:url';

export function appleVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-alpha\.(\d+))?$/.exec(version);
  if (!match) {
    throw new Error(`${version} is not x.y.z or x.y.z-alpha.n`);
  }
  const [, major, minor, patch, alpha] = match;
  const n = alpha === undefined ? 9999 : Number(alpha);
  if (n < 1 || (alpha !== undefined && n > 9998)) {
    throw new Error(`${version}: the alpha number must be 1 to 9998`);
  }
  return `${major}.${minor}.${Number(patch) * 10000 + n}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(appleVersion(process.argv[2]));
}

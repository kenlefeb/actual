import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  cmpSemanticVersion,
  computeClientVersion,
  getIsOutdated,
} from './versions';

describe('cmpSemanticVersion', () => {
  it('compares major, minor and patch numerically', () => {
    expect(cmpSemanticVersion('26.8.1', '26.8.1')).toBe(0);
    expect(cmpSemanticVersion('26.8.0', '26.8.1')).toBeLessThan(0);
    expect(cmpSemanticVersion('26.10.0', '26.9.9')).toBeGreaterThan(0);
    expect(cmpSemanticVersion('27.0.0', '26.12.5')).toBeGreaterThan(0);
  });

  it('ignores a leading "v"', () => {
    expect(cmpSemanticVersion('v26.8.1', '26.8.1')).toBe(0);
  });
});

describe('computeClientVersion', () => {
  const base = {
    isPlaywright: false,
    reviewId: undefined,
    commitRef: undefined,
    packageVersion: '26.9.0',
  };

  it('returns a fixed version under Playwright, regardless of other inputs', () => {
    expect(
      computeClientVersion({
        ...base,
        isPlaywright: true,
        commitRef: 'e18c8adddee6dc699ff8a8a8c65aa93e97b3a81d',
      }),
    ).toBe('99.9.9');
  });

  it('returns the preview marker for PR review deploys', () => {
    expect(computeClientVersion({ ...base, reviewId: 'review-123' })).toBe(
      '.preview',
    );
  });

  it('prefers the preview marker when both a review ID and commit ref are set', () => {
    expect(
      computeClientVersion({
        ...base,
        reviewId: 'review-123',
        commitRef: 'e18c8adddee6dc699ff8a8a8c65aa93e97b3a81d',
      }),
    ).toBe('.preview');
  });

  it('appends a short commit ref as semver build metadata when present', () => {
    expect(
      computeClientVersion({
        ...base,
        commitRef: 'e18c8adddee6dc699ff8a8a8c65aa93e97b3a81d',
      }),
    ).toBe('26.9.0+e18c8ad');
  });

  it('falls back to the plain package version otherwise', () => {
    expect(computeClientVersion(base)).toBe('26.9.0');
  });

  it('does not break cmpSemanticVersion comparisons once a commit ref is appended', () => {
    const withCommit = computeClientVersion({
      ...base,
      commitRef: 'e18c8adddee6dc699ff8a8a8c65aa93e97b3a81d',
    });
    expect(cmpSemanticVersion(withCommit, '26.9.0')).toBe(0);
    expect(cmpSemanticVersion(withCommit, '26.10.0')).toBeLessThan(0);
  });
});

describe('getIsOutdated', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  function stubClient(version: string) {
    vi.stubGlobal('window', { Actual: { ACTUAL_VERSION: version } });
  }

  it('reports an older client as outdated on upstream builds', () => {
    vi.stubEnv('REACT_APP_NEWS_FEED_BUNDLED', '');
    stubClient('26.10.1-alpha.23');
    expect(getIsOutdated('v26.11.0')).toBe(true);
  });

  it('never reports an update on fork builds', () => {
    vi.stubEnv('REACT_APP_NEWS_FEED_BUNDLED', 'true');
    stubClient('26.10.1-alpha.23');
    expect(getIsOutdated('v26.11.0')).toBe(false);
  });
});

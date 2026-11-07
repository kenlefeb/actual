import path from 'path';

import { loadEnv } from 'vite';
import { describe, expect, it } from 'vitest';

const clientDir = path.resolve(__dirname, '../..');

describe('fork build env files', () => {
  it.each(['browser', 'desktop'])(
    'the %s build bundles the news feed',
    mode => {
      const env = loadEnv(mode, clientDir, 'REACT_APP_');
      expect(env.REACT_APP_NEWS_FEED_BUNDLED).toBe('true');
    },
  );
});

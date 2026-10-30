import { createHash } from 'node:crypto';

import { makeViews, schema, schemaConfig } from './aql';
import { hashViews } from './update';

// The stored view hash must not change, or every budget would rebuild its
// views on the first load after an update
describe('hashViews', () => {
  it('matches the MD5 hex digest the stored view hash was made with', () => {
    const views = makeViews(schema, schemaConfig);
    for (const input of [views, '', 'CREATE VIEW v AS SELECT 1; -- é ✓']) {
      expect(hashViews(input)).toBe(
        createHash('md5').update(input).digest('hex'),
      );
    }
  });
});

import type * as ApiModule from '@actual-app/api';

import { startHarness } from '#client-harness';

import { budgetId } from './shared';

// Production loads the API's CJS build. Node snapshots a CJS module's named
// exports when it is imported, so `api.internal` stays null there, although
// `api.init()` returns the engine. This stands in for that snapshot.
vi.mock('@actual-app/api', async importOriginal => ({
  ...(await importOriginal<typeof ApiModule>()),
  internal: null,
}));

it('finds the loaded budget id when api.internal is a null snapshot', async () => {
  const h = await startHarness({ count: 1 });
  try {
    await expect(budgetId()).resolves.toBeTruthy();
  } finally {
    await h.close();
  }
});

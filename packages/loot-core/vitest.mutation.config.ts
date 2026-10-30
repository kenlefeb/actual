// Fork-only (sc-632): the unit tests Stryker runs against the shared date and
// money modules. Only their own tests, so each mutant runs in seconds rather
// than pulling in every server test that imports these modules.
import { defineConfig, mergeConfig } from 'vitest/config';

import base from './vitest.config';

export default mergeConfig(
  base,
  defineConfig({
    test: {
      include: [
        'src/shared/{paychecks,business-calendars,relative-dates,schedules}.test.ts',
      ],
      // Stryker reports the results; the CI junit reporter would only add files
      reporters: ['default'],
    },
  }),
);

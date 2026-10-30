// Fork-only (sc-632): nightly mutation report for the shared date and money
// modules (.github/workflows/fork-mutation-report.yml). Report only: it never
// fails a build. Run with `yarn workspace @actual-app/core run mutation-report`.
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  testRunner: 'vitest',
  vitest: { configFile: 'vitest.mutation.config.ts', related: false },
  mutate: [
    'src/shared/paychecks.ts',
    'src/shared/business-calendars.ts',
    'src/shared/relative-dates.ts',
    'src/shared/schedules.ts',
  ],
  coverageAnalysis: 'perTest',
  reporters: ['clear-text', 'html', 'json', 'progress'],
  htmlReporter: { fileName: 'reports/mutation/index.html' },
  jsonReporter: { fileName: 'reports/mutation/mutation.json' },
  thresholds: { high: 80, low: 60, break: null },
};

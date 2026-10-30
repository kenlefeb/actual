import { captureException } from '#platform/exceptions';
import { logger } from '#platform/server/log';
import * as db from '#server/db';
import * as prefs from '#server/prefs';

import { app, waitOnSchedulesService } from './app';

vi.mock('#platform/exceptions', async importOriginal => ({
  ...(await importOriginal<object>()),
  captureException: vi.fn(),
}));

beforeEach(async () => {
  await global.emptyDatabase()();
  vi.spyOn(prefs, 'getPrefs').mockReturnValue({
    id: 'budget',
    lastScheduleRun: undefined,
  } as ReturnType<typeof prefs.getPrefs>);
  vi.spyOn(prefs, 'savePrefs').mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(captureException).mockClear();
});

it('reports a failed service run and still lets the budget close', async () => {
  const failure = new Error('posting failed');
  vi.spyOn(db, 'all').mockRejectedValueOnce(failure);
  const logError = vi.spyOn(logger, 'error');

  app.events.emit('sync', { type: 'success' });
  await waitOnSchedulesService();

  expect(captureException).toHaveBeenCalledWith(failure);
  expect(logError).toHaveBeenCalledWith('Schedules service failed:', failure);
});

it('waits for a run that starts while it is already waiting', async () => {
  // Each run fails after a moment, so captureException marks it finished
  vi.spyOn(db, 'all').mockImplementation(async () => {
    await new Promise(resolve => setTimeout(resolve, 20));
    throw new Error('posting failed');
  });

  app.events.emit('sync', { type: 'success' });
  const waiting = waitOnSchedulesService();
  // A second sync lands before the first run finishes
  app.events.emit('sync', { type: 'success' });
  await waiting;

  expect(captureException).toHaveBeenCalledTimes(2);
});

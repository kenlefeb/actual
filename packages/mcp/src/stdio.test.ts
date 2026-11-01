import { vi } from 'vitest';

import { redirectConsoleToStderr } from './stdio';

it('sends console.log, info and debug to stderr, not stdout', () => {
  const saved = {
    log: console.log,
    info: console.info,
    debug: console.debug,
    error: console.error,
  };
  const stdout = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation(() => true);
  const error = vi.fn();
  console.error = error;
  try {
    redirectConsoleToStderr();
    console.log('a');
    console.info('b');
    console.debug('c');
    expect(error).toHaveBeenCalledTimes(3);
    expect(stdout).not.toHaveBeenCalled();
  } finally {
    Object.assign(console, saved);
    vi.restoreAllMocks();
  }
});

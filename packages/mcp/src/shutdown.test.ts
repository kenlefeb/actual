import { EventEmitter } from 'events';
import { PassThrough } from 'stream';

import { registerShutdown } from './shutdown';

function setup() {
  const close = vi.fn(() => Promise.resolve());
  const exit = vi.fn();
  const stdin = new PassThrough();
  const proc = new EventEmitter();
  const stop = registerShutdown(close, exit, stdin, proc);
  return { close, exit, stdin, proc, stop };
}

const settled = () => new Promise(resolve => setImmediate(resolve));

it('closes the budget and exits 0 when the client closes stdin', async () => {
  const { close, exit, stdin } = setup();
  stdin.resume();
  stdin.end();
  await settled();
  expect(close).toHaveBeenCalledTimes(1);
  expect(exit).toHaveBeenCalledWith(0);
});

it.each(['SIGINT', 'SIGTERM'])('still shuts down on %s', async signal => {
  const { close, exit, proc } = setup();
  proc.emit(signal);
  await settled();
  expect(close).toHaveBeenCalledTimes(1);
  expect(exit).toHaveBeenCalledWith(0);
});

it('still exits once, with a fixed stderr message, when closing fails', async () => {
  const unhandled = vi.fn();
  process.on('unhandledRejection', unhandled);
  const write = vi
    .spyOn(process.stderr, 'write')
    .mockImplementation(() => true);
  try {
    const exit = vi.fn();
    const stop = registerShutdown(
      () => Promise.reject(new Error('secret-url')),
      exit,
      new PassThrough(),
      new EventEmitter(),
    );
    stop();
    stop();
    await settled();
    await settled();
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
    expect(write).toHaveBeenCalledWith('actual-mcp: shutdown failed\n');
    expect(JSON.stringify(write.mock.calls)).not.toContain('secret-url');
    expect(unhandled).not.toHaveBeenCalled();
  } finally {
    write.mockRestore();
    process.off('unhandledRejection', unhandled);
  }
});

it('shuts down once even when several close events fire', async () => {
  const { close, exit, stdin, proc, stop } = setup();
  stdin.resume();
  stdin.end();
  proc.emit('SIGTERM');
  stop();
  await settled();
  await settled();
  expect(close).toHaveBeenCalledTimes(1);
  expect(exit).toHaveBeenCalledTimes(1);
});

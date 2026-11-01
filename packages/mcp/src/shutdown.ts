/**
 * Shuts down once, whichever comes first: a signal, the client closing stdin,
 * or the returned `stop` (for the server's close hook). The SDK's stdio
 * transport never reports stdin ending, so stdin is watched here.
 */
export function registerShutdown(
  close: () => Promise<unknown>,
  exit: (code: number) => void = code => process.exit(code),
  stdin: NodeJS.EventEmitter = process.stdin,
  proc: NodeJS.EventEmitter = process,
) {
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    void close().finally(() => exit(0));
  };
  proc.on('SIGINT', stop);
  proc.on('SIGTERM', stop);
  stdin.on('end', stop);
  stdin.on('close', stop);
  return stop;
}

import { Refusal } from './refusal';

/** How long a write waits for the one before it; a slow engine call can't stall writes forever. */
export const WRITE_LOCK_WAIT_MS = 30_000;

let tail: Promise<void> = Promise.resolve();

/**
 * Runs `fn` when no other write is running in this process. A caller that
 * waits longer than `waitMs` is refused (nothing ran); its place in the queue
 * is kept until the holder ahead finishes, so order still holds.
 */
export async function withWriteLock<T>(
  fn: () => Promise<T>,
  waitMs = WRITE_LOCK_WAIT_MS,
): Promise<T> {
  const ahead = tail;
  let release!: () => void;
  tail = new Promise<void>(resolve => (release = resolve));
  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Refusal(
            'Another write is still running. Try again shortly. Nothing changed.',
          ),
        ),
      waitMs,
    );
  });
  try {
    await Promise.race([ahead, timedOut]);
  } catch (error) {
    void ahead.then(release);
    throw error;
  } finally {
    clearTimeout(timer);
  }
  try {
    return await fn();
  } finally {
    release();
  }
}

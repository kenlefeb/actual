import { withWriteLock } from './write-lock';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

describe('Writes are serialized', () => {
  it('runs holders one at a time, in order', async () => {
    const order: string[] = [];
    const run = (name: string, ms: number) =>
      withWriteLock(async () => {
        order.push(`${name}+`);
        await sleep(ms);
        order.push(`${name}-`);
      });
    await Promise.all([run('a', 20), run('b', 1), run('c', 1)]);
    expect(order).toEqual(['a+', 'a-', 'b+', 'b-', 'c+', 'c-']);
  });

  it('a slow holder cannot stall a waiter past the timeout, and order holds', async () => {
    const order: string[] = [];
    const slow = withWriteLock(async () => {
      await sleep(80);
      order.push('slow');
    }, 1000);
    const waiter = withWriteLock(async () => {
      order.push('waiter');
    }, 10);
    await expect(waiter).rejects.toThrow(/another write/i);
    // the next caller still waits for the slow holder
    await withWriteLock(async () => {
      order.push('next');
    }, 1000);
    await slow;
    expect(order).toEqual(['slow', 'next']);
  });

  it('releases after a throw', async () => {
    await expect(
      withWriteLock(async () => {
        throw new Error('x');
      }),
    ).rejects.toThrow('x');
    expect(await withWriteLock(async () => 1)).toBe(1);
  });
});

import { act, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SyncRefresh } from './SyncRefresh';

describe('SyncRefresh', () => {
  it('clears its busy state after a rejected sync so another attempt is possible', async () => {
    let refresh: () => Promise<void> = async () => undefined;
    let refreshing = false;
    render(
      <SyncRefresh onSync={vi.fn().mockRejectedValue(new Error('offline'))}>
        {state => {
          refresh = state.onRefresh;
          refreshing = state.refreshing;
          return null;
        }}
      </SyncRefresh>,
    );
    await act(async () => {
      await expect(refresh()).rejects.toThrow('offline');
    });
    expect(refreshing).toBe(false);
  });
});

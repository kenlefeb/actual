import { describe, expect, it, vi } from 'vitest';

import { pushModal, reducer } from './modalsSlice';

describe('pushModal', () => {
  it('opens the moved-history confirmation only once', () => {
    // A cell save and the blur caused by the dialog opening both fire
    const modal = {
      name: 'confirm-categorize-moved-history',
      options: { onConfirm: vi.fn() },
    } as const;

    let state = reducer(undefined, pushModal({ modal }));
    state = reducer(state, pushModal({ modal }));

    expect(state.modalStack).toHaveLength(1);
  });
});

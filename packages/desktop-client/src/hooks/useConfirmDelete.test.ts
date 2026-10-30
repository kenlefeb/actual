import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TestProviders } from '#mocks';

import { useConfirmDelete } from './useConfirmDelete';

const state = vi.hoisted(() => ({
  isNarrowWidth: true,
  pushModal: vi.fn(),
}));

vi.mock('@actual-app/components/hooks/useResponsive', () => ({
  useResponsive: () => ({ isNarrowWidth: state.isNarrowWidth }),
}));
vi.mock('#modals/modalsSlice', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  pushModal: (payload: unknown) => {
    state.pushModal(payload);
    return { type: 'test/pushModal' };
  },
}));

function confirm() {
  const onConfirm = vi.fn();
  const { result } = renderHook(() => useConfirmDelete(), {
    wrapper: TestProviders,
  });
  result.current({
    title: 'Delete paycheck',
    message: 'Delete the paycheck?',
    onConfirm,
  });
  return onConfirm;
}

describe('useConfirmDelete', () => {
  beforeEach(() => {
    state.pushModal.mockReset();
  });

  it('asks on a phone with the mobile delete sheet', () => {
    state.isNarrowWidth = true;
    const onConfirm = confirm();
    expect(state.pushModal).toHaveBeenCalledWith({
      modal: {
        name: 'mobile-confirm-delete',
        options: {
          title: 'Delete paycheck',
          message: 'Delete the paycheck?',
          onConfirm,
        },
      },
    });
  });

  it('keeps the desktop delete dialog on wider layouts', () => {
    state.isNarrowWidth = false;
    const onConfirm = confirm();
    expect(state.pushModal).toHaveBeenCalledWith({
      modal: {
        name: 'confirm-delete',
        options: { message: 'Delete the paycheck?', onConfirm },
      },
    });
  });
});

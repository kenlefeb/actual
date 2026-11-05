import { send } from '@actual-app/core/platform/client/connection';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { importAmazonOrders } from './importAmazonOrders';

vi.mock('@actual-app/core/platform/client/connection', async importActual => ({
  ...(await importActual<object>()),
  send: vi.fn(),
}));

function actionTypes(dispatch: ReturnType<typeof vi.fn>) {
  return dispatch.mock.calls.map(([action]) => action.type);
}

describe('importAmazonOrders', () => {
  beforeEach(() => {
    vi.mocked(send).mockReset();
    window.Actual = {
      ...window.Actual,
      openFileDialog: vi.fn(async () => ['/uploads/orders.csv']),
    };
  });

  it('Not an order export: refuses with the missing fields, and no review opens', async () => {
    vi.mocked(send).mockResolvedValueOnce({ error: { missing: ['tax'] } });
    const dispatch = vi.fn();

    await importAmazonOrders(dispatch, vi.fn());

    expect(actionTypes(dispatch)).toEqual(['notifications/addNotification']);
    expect(dispatch.mock.calls[0][0].payload.notification.message).toContain(
      'tax',
    );
  });

  it('a file the import fails to read gets the same refusal', async () => {
    vi.mocked(send).mockRejectedValueOnce(new Error('Invalid Opening Quote'));
    const dispatch = vi.fn();

    await importAmazonOrders(dispatch, vi.fn());

    expect(actionTypes(dispatch)).toEqual(['notifications/addNotification']);
  });

  it('opens the review for an order export', async () => {
    vi.mocked(send).mockResolvedValueOnce({ reviews: [] });
    const dispatch = vi.fn();

    await importAmazonOrders(dispatch, vi.fn());

    expect(actionTypes(dispatch)).toEqual(['modals/pushModal']);
  });
});

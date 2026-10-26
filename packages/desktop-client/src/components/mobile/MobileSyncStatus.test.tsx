import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TestProviders } from '#mocks';

import { MobileSyncStatus } from './MobileSyncStatus';

type Event = { type: string; subtype?: string; syncDisabled?: boolean };
const backend = vi.hoisted(() => ({
  emit: (_event: Event): void => undefined,
  status: 'online',
}));
vi.mock('@actual-app/core/platform/client/connection', () => ({
  listen: (_name: string, listener: (event: Event) => void) => {
    backend.emit = listener;
    return () => undefined;
  },
  send: vi.fn().mockResolvedValue({}),
}));
vi.mock('#hooks/useMetadataPref', () => ({
  useMetadataPref: () => ['synthetic-cloud-file'],
}));
vi.mock('#hooks/useSyncServerStatus', () => ({
  useSyncServerStatus: () => backend.status,
}));

describe('MobileSyncStatus', () => {
  beforeEach(() => {
    backend.status = 'online';
  });

  it('distinguishes connectivity from a completed sync and keeps busy until the event ends', async () => {
    render(
      <TestProviders>
        <MobileSyncStatus />
      </TestProviders>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Server online');
    await act(() => backend.emit({ type: 'start' }));
    expect(screen.getByRole('status')).toHaveTextContent('Syncing…');
    expect(
      screen.getByRole('button', { name: 'Sync with server' }),
    ).toBeDisabled();
    await act(() => backend.emit({ type: 'success' }));
    expect(screen.getByRole('status')).toHaveTextContent('Synced');
    expect(
      screen.getByRole('button', { name: 'Sync with server' }),
    ).toBeEnabled();
  });

  it('keeps offline and failed-sync outcomes visible and retry available', async () => {
    render(
      <TestProviders>
        <MobileSyncStatus />
      </TestProviders>,
    );
    await act(() => backend.emit({ type: 'error', subtype: 'network' }));
    expect(screen.getByRole('status')).toHaveTextContent(
      'Offline — changes saved on this device',
    );
    expect(
      screen.getByRole('button', { name: 'Sync with server' }),
    ).toBeEnabled();
    await act(() => backend.emit({ type: 'start' }));
    await act(() => backend.emit({ type: 'error', subtype: 'out-of-sync' }));
    expect(screen.getByRole('status')).toHaveTextContent(
      'Sync failed — try again',
    );
  });

  it('does not claim a local-only file is synced', () => {
    backend.status = 'no-server';
    render(
      <TestProviders>
        <MobileSyncStatus />
      </TestProviders>,
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      'Local file — not syncing',
    );
    expect(
      screen.queryByRole('button', { name: 'Sync with server' }),
    ).not.toBeInTheDocument();
  });
});

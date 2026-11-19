import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TestProviders } from '#mocks';

import { SyncStatusLine } from './SyncStatusLine';

type Event = { type: string; subtype?: string };
const backend = vi.hoisted(() => ({
  emit: (_event: Event): void => undefined,
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
  useSyncServerStatus: () => 'online',
}));

const waiting = 'Waiting for this device to finish saving';

// native-durable-writes: "A held sync says it is waiting" (sc-5219)
describe('SyncStatusLine', () => {
  it('says a held sync is waiting, through its retries, until one succeeds', async () => {
    render(
      <TestProviders>
        <SyncStatusLine />
      </TestProviders>,
    );
    await act(async () => {
      backend.emit({ type: 'start' });
    });
    expect(screen.getByText('Syncing…')).toBeInTheDocument();
    await act(async () => {
      backend.emit({ type: 'error', subtype: 'storage-slow' });
    });
    expect(screen.getByText(waiting)).toBeInTheDocument();
    await act(async () => {
      backend.emit({ type: 'start' });
    });
    expect(screen.getByText(waiting)).toBeInTheDocument();
    await act(async () => {
      backend.emit({ type: 'success' });
    });
    expect(screen.getByText('Synced')).toBeInTheDocument();
  });
});

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TestProviders } from '#mocks';

import { TransactionAttachmentViewerModal } from './TransactionAttachmentViewerModal';

vi.mock('@actual-app/components/hooks/useResponsive', () => ({
  useResponsive: () => ({ isNarrowWidth: true, isNarrowWidthLoaded: true }),
}));

const url = 'blob:http://localhost/doc';

function renderViewer(name: string, mime: string) {
  render(
    <TestProviders>
      <TransactionAttachmentViewerModal name={name} mime={mime} url={url} />
    </TestProviders>,
  );
}

describe('Open a document on the phone', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    // jsdom has no Web Share API; tests add it as needed
    Reflect.deleteProperty(navigator, 'share');
    Reflect.deleteProperty(navigator, 'canShare');
  });

  it('Open a PDF on the phone', () => {
    renderViewer('invoice.pdf', 'application/pdf');

    expect(screen.getByTitle('invoice.pdf')).toHaveAttribute('src', url);
    expect(screen.getByText('Share or save')).toBeInTheDocument();
    expect(
      screen.getByText('Use Share or save to see every page.'),
    ).toBeInTheDocument();
  });

  it('Open a photo on the phone', () => {
    renderViewer('photo.jpg', 'image/jpeg');

    expect(screen.getByRole('img', { name: 'photo.jpg' })).toHaveAttribute(
      'src',
      url,
    );
    expect(
      screen.queryByText('Use Share or save to see every page.'),
    ).toBeNull();
  });

  it('shares the file when the phone can share files', async () => {
    const share = vi.fn(async () => undefined);
    Object.assign(navigator, { share, canShare: () => true });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Blob(['%PDF-1.4'], { type: 'application/pdf' })),
    );
    renderViewer('invoice.pdf', 'application/pdf');

    await userEvent.click(
      await screen.findByRole('button', { name: 'Share or save' }),
    );

    await waitFor(() => expect(share).toHaveBeenCalled());
    const [{ files }] = share.mock.calls[0] as unknown as [{ files: File[] }];
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe('invoice.pdf');
    expect(files[0].type).toBe('application/pdf');
  });

  it('is a download link when the phone cannot share files', () => {
    renderViewer('invoice.pdf', 'application/pdf');

    const link = screen.getByRole('link', { name: 'Share or save' });
    expect(link).toHaveAttribute('href', url);
    expect(link).toHaveAttribute('download', 'invoice.pdf');
  });

  it('revokes the object URL when it closes', async () => {
    const revoke = vi.fn();
    URL.revokeObjectURL = revoke;
    renderViewer('photo.jpg', 'image/jpeg');

    expect(revoke).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(revoke).toHaveBeenCalledWith(url);
  });
});

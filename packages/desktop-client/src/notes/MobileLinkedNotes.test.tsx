import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { TestProviders } from '#mocks';

import { MobileLinkedNotes } from './MobileLinkedNotes';

describe('MobileLinkedNotes', () => {
  it('offers a real HTTPS link without opening the surrounding transaction', async () => {
    const openTransaction = vi.fn();
    render(
      <TestProviders>
        <div onClick={openTransaction}>
          <MobileLinkedNotes
            displayText="Receipt PDF"
            url="https://example.com/receipt.pdf"
            separator=""
            isFilePath={false}
          />
        </div>
      </TestProviders>,
    );
    const link = screen.getByRole('link', { name: 'Receipt PDF' });
    expect(link).toHaveAttribute('href', 'https://example.com/receipt.pdf');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    await userEvent.click(link);
    expect(openTransaction).not.toHaveBeenCalled();
  });
});

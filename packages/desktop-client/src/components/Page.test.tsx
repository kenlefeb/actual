import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TestProviders } from '#mocks';

import { MobilePageHeader } from './Page';

describe('MobilePageHeader', () => {
  it('ends a text title that does not fit with an ellipsis', () => {
    const title = 'Acme Paycheck Clearing Account business days';
    render(
      <TestProviders>
        <MobilePageHeader title={title} />
      </TestProviders>,
    );

    // The heading keeps the full title as its accessible name
    const heading = screen.getByRole('heading', { name: title });
    expect(heading).toHaveStyle({ minWidth: '0px' });
    // Clipping the heading itself would cut wider titles, like the month picker
    expect(heading).not.toHaveStyle({ overflow: 'hidden' });
    expect(screen.getByText(title)).toHaveStyle({
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    });
  });
});

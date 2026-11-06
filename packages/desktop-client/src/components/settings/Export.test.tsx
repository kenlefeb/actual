import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TestProviders } from '#mocks';

import { ExportBudget } from './Export';

describe('ExportBudget', () => {
  it('Export a budget with attachments: says documents are left out', () => {
    render(
      <TestProviders>
        <ExportBudget />
      </TestProviders>,
    );

    expect(
      screen.getByText(/Attached documents aren't included in the export\./),
    ).toBeInTheDocument();
  });
});

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TestProviders } from '#mocks';

import { GenericInput } from './GenericInput';

vi.mock('#hooks/useCategories', () => ({
  useCategories: () => ({ data: { grouped: [], list: [] } }),
}));

function renderCategory(placeholder?: string) {
  render(
    <TestProviders>
      <GenericInput
        aria-label="Category"
        type="id"
        field="category"
        value=""
        onChange={vi.fn()}
        placeholder={placeholder}
      />
    </TestProviders>,
  );
  return screen.getByLabelText('Category');
}

describe('GenericInput', () => {
  it('shows "nothing" for an empty autocomplete by default', () => {
    expect(renderCategory()).toHaveAttribute('placeholder', 'nothing');
  });

  it('shows the given empty state for an empty autocomplete', () => {
    expect(renderCategory('No category')).toHaveAttribute(
      'placeholder',
      'No category',
    );
  });
});

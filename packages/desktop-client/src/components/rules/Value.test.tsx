import { setScheduleNames } from '@actual-app/core/shared/schedule-date-lookup';
import type { RelativeDateConfig } from '@actual-app/core/types/models';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { TestProviders } from '#mocks';

import { Value } from './Value';

describe('Value', () => {
  afterEach(() => setScheduleNames([]));

  it('describes a relative date instead of parsing it as a date', () => {
    setScheduleNames([['payday', 'Payday']]);
    const value: RelativeDateConfig = {
      relativeTo: {
        scheduleId: 'payday',
        offset: 2,
        unit: 'business-days',
        direction: 'before',
      },
    };
    render(
      <TestProviders>
        <Value value={value} field="date" />
      </TestProviders>,
    );
    expect(
      screen.getByText('2 business days before Payday'),
    ).toBeInTheDocument();
  });
});

import { Button } from '@actual-app/components/button';
import { render, screen } from '@testing-library/react';

import { StickyFormFooter } from './StickyFormFooter';

describe('StickyFormFooter', () => {
  it('renders the summary above the children', () => {
    render(
      <StickyFormFooter summary="Net pay" data-testid="footer">
        <Button variant="primary">Save</Button>
      </StickyFormFooter>,
    );

    const footer = screen.getByTestId('footer');
    expect(footer.textContent).toBe('Net paySave');
  });

  it('keeps the safe-area padding', () => {
    render(
      <StickyFormFooter data-testid="footer">
        <Button variant="primary">Save</Button>
      </StickyFormFooter>,
    );

    // jsdom drops env() values from computed styles, so check the class rule
    const css = Array.from(document.querySelectorAll('style'))
      .map(el => el.textContent)
      .join('');
    expect(screen.getByTestId('footer')).toBeTruthy();
    expect(css).toContain('env(safe-area-inset-bottom)');
  });

  it('passes a disabled Save button through', () => {
    render(
      <StickyFormFooter>
        <Button variant="primary" isDisabled>
          Save
        </Button>
      </StickyFormFooter>,
    );

    expect(
      (screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});

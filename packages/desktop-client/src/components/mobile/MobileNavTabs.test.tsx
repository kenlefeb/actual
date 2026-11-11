import { MemoryRouter } from 'react-router';

import { render, screen } from '@testing-library/react';

import { ScrollProvider } from '#hooks/useScrollListener';
import { TestProviders } from '#mocks';

import { MobileNavTabs } from './MobileNavTabs';

vi.mock('@actual-app/components/hooks/useResponsive', () => ({
  useResponsive: () => ({ isNarrowWidth: true }),
}));

// native-appearance: "iPhone uses a native tab bar" (sc-3514)
function renderTabs() {
  return render(
    <TestProviders>
      <MemoryRouter initialEntries={['/budget']}>
        <ScrollProvider scrollableRef={{ current: null }}>
          <MobileNavTabs />
        </ScrollProvider>
      </MemoryRouter>
    </TestProviders>,
  );
}

describe('MobileNavTabs', () => {
  afterEach(() => {
    delete (window as { webkit?: unknown }).webkit;
  });

  it('shows the web tab grid in a phone browser', () => {
    renderTabs();
    expect(screen.getByRole('navigation')).toBeInTheDocument();
  });

  it('renders nothing when the native tab bar is present', () => {
    (window as { webkit?: unknown }).webkit = {
      messageHandlers: { actualNativeChrome: { postMessage: vi.fn() } },
    };
    renderTabs();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });
});

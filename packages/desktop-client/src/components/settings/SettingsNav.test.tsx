import { MemoryRouter } from 'react-router';

import { render, screen } from '@testing-library/react';

import { useIsTestEnv } from '#hooks/useIsTestEnv';
import { useSyncServerStatus } from '#hooks/useSyncServerStatus';
import { createTestAppStore, TestProviders } from '#mocks';
import { mergeSyncedPrefs } from '#prefs/prefsSlice';

import { SettingsNav } from './SettingsNav';

vi.mock('#hooks/useSyncServerStatus', () => ({
  useSyncServerStatus: vi.fn(),
}));
vi.mock('#hooks/useIsTestEnv', () => ({
  useIsTestEnv: vi.fn(),
}));

const phone = vi.hoisted(() => ({
  isNarrowWidth: false,
  news: { isEnabled: true, unseenCount: 0 },
}));
vi.mock('@actual-app/components/hooks/useResponsive', () => ({
  useResponsive: () => ({
    isNarrowWidth: phone.isNarrowWidth,
    isWideWidth: !phone.isNarrowWidth,
  }),
}));
vi.mock('#hooks/useNewsFeed', () => ({
  useNewsFeed: () => phone.news,
}));

function renderNav(initialPath: string, sidebarMenuItems?: unknown[]) {
  const store = createTestAppStore();
  if (sidebarMenuItems) {
    store.dispatch(
      mergeSyncedPrefs({
        'sidebar-menu-items': JSON.stringify(sidebarMenuItems),
      }),
    );
  }

  return render(
    <TestProviders store={store}>
      <MemoryRouter initialEntries={[initialPath]}>
        <SettingsNav />
      </MemoryRouter>
    </TestProviders>,
  );
}

describe('SettingsNav', () => {
  beforeEach(() => {
    phone.isNarrowWidth = false;
    phone.news = { isEnabled: true, unseenCount: 0 };
    vi.mocked(useSyncServerStatus).mockReturnValue('online');
    vi.mocked(useIsTestEnv).mockReturnValue(false);
  });

  it('links every section under /settings', () => {
    renderNav('/settings');

    const hrefs = screen
      .getAllByRole('link')
      .map(link => link.getAttribute('href'));

    expect(hrefs).toEqual([
      '/settings/general',
      '/settings/payees',
      '/settings/tags',
      '/settings/rules',
      '/settings/bank-sync',
      '/settings/advanced',
      '/settings/experimental',
    ]);
  });

  it('leaves out pages that are shown in the sidebar', () => {
    renderNav('/settings', [
      { id: 'budget', hidden: false },
      { id: 'payees', hidden: false },
      { id: 'schedules', hidden: true },
    ]);

    const hrefs = screen
      .getAllByRole('link')
      .map(link => link.getAttribute('href'));

    expect(hrefs).toEqual([
      '/settings/general',
      '/settings/schedules',
      '/settings/tags',
      '/settings/rules',
      '/settings/bank-sync',
      '/settings/advanced',
      '/settings/experimental',
    ]);
  });

  it('hides bank sync without a server', () => {
    vi.mocked(useSyncServerStatus).mockReturnValue('no-server');

    renderNav('/settings');

    expect(
      screen.queryByRole('link', { name: 'Bank Sync' }),
    ).not.toBeInTheDocument();
  });

  it('marks the current section as active', () => {
    renderNav('/settings/rules');

    expect(screen.getByRole('link', { name: 'Rules' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('link', { name: 'General' })).not.toHaveAttribute(
      'aria-current',
    );
  });

  // native-appearance: "iPhone uses a native tab bar" (sc-3514). The iOS app
  // hides the web tab grid, which held Schedules.
  describe('Schedules row on a phone', () => {
    beforeEach(() => {
      phone.isNarrowWidth = true;
    });
    afterEach(() => {
      delete (window as { webkit?: unknown }).webkit;
    });

    it('shows in the iOS app and opens the schedules list', () => {
      (window as { webkit?: unknown }).webkit = {
        messageHandlers: { actualNativeChrome: { postMessage: vi.fn() } },
      };
      renderNav('/settings');

      expect(screen.getByRole('link', { name: 'Schedules' })).toHaveAttribute(
        'href',
        '/schedules',
      );
    });

    it('is not in a phone browser, which keeps the web tab grid', () => {
      renderNav('/settings');

      expect(screen.queryByRole('link', { name: 'Schedules' })).toBe(null);
    });
  });

  describe('Notifications row on a phone', () => {
    beforeEach(() => {
      phone.isNarrowWidth = true;
    });

    it('Open the notes after dismissing the message', () => {
      renderNav('/settings');

      const links = screen.getAllByRole('link');
      expect(links[0]).toHaveAttribute('href', '/settings/general');
      // Right after General, before the other rows
      expect(links[1]).toHaveAttribute('href', '/notifications');
      expect(links[1]).toHaveTextContent('Notifications');
      expect(links[1]).toHaveStyle({ minHeight: '40px' });
    });

    it('The unseen count', () => {
      phone.news = { isEnabled: true, unseenCount: 2 };
      renderNav('/settings');

      const link = screen.getByRole('link', {
        name: 'Notifications: 2 unread',
      });
      expect(link).toHaveTextContent('2');
    });

    it('caps the count at 9+', () => {
      phone.news = { isEnabled: true, unseenCount: 12 };
      renderNav('/settings');

      expect(
        screen.getByRole('link', { name: 'Notifications: 12 unread' }),
      ).toHaveTextContent('9+');
    });

    it('shows no count once the notes were seen', () => {
      renderNav('/settings');

      const link = screen.getByRole('link', { name: 'Notifications' });
      expect(link).not.toHaveTextContent(/\d/);
    });

    it('Off means no row', () => {
      phone.news = { isEnabled: false, unseenCount: 3 };
      renderNav('/settings');

      expect(screen.queryByRole('link', { name: /Notifications/ })).toBe(null);
    });
  });

  it('Desktop keeps the bell', () => {
    phone.news = { isEnabled: true, unseenCount: 2 };
    renderNav('/settings');

    expect(screen.queryByRole('link', { name: /Notifications/ })).toBe(null);
  });
});

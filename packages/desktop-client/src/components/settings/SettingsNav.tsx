import { useTranslation } from 'react-i18next';

import { useResponsive } from '@actual-app/components/hooks/useResponsive';
import {
  SvgCog,
  SvgNotificationsOutline,
  SvgPylon,
} from '@actual-app/components/icons/v1';
import { SvgSettingsSliderAlternate } from '@actual-app/components/icons/v2';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { spacing } from '@actual-app/components/tokens';
import { View } from '@actual-app/components/view';

import {
  getDefaultSidebarMenuItems,
  getSidebarMenuItemPath,
  isInMobileSettingsNav,
  isSettingsSection,
} from '#components/sidebar/sidebarMenu';
import { useSidebarMenuItemDetails } from '#components/sidebar/useSidebarMenuItemDetails';
import { useNewsFeed } from '#hooks/useNewsFeed';
import { useSidebarMenu } from '#hooks/useSidebarMenu';
import { hasNativeTabBar } from '#native/nativeChrome';

import { SettingsNavLink } from './SettingsNavLink';

// Same cap as the titlebar bell
const MAX_DISPLAYED_COUNT = 9;

export function SettingsNav() {
  const { t } = useTranslation();
  const { isNarrowWidth } = useResponsive();
  const { settingsItems, isItemAvailable } = useSidebarMenu();
  const itemDetails = useSidebarMenuItemDetails();
  const { isEnabled: isNewsEnabled, unseenCount } = useNewsFeed();
  const displayedCount =
    unseenCount > MAX_DISPLAYED_COUNT
      ? t('{{max}}+', { max: MAX_DISPLAYED_COUNT })
      : String(unseenCount);

  const menuItems = isNarrowWidth
    ? getDefaultSidebarMenuItems().filter(
        item =>
          isSettingsSection(item.id) &&
          isInMobileSettingsNav(item.id) &&
          isItemAvailable(item.id),
      )
    : settingsItems;

  return (
    <View
      role="navigation"
      aria-label={t('Settings')}
      style={
        isNarrowWidth
          ? {
              flexShrink: 0,
              backgroundColor: theme.settingsCardBackground,
              border: `1px solid ${theme.settingsCardBorder}`,
              borderRadius: 6,
            }
          : { width: 180, flexShrink: 0, gap: spacing.xxs }
      }
    >
      <SettingsNavLink
        title={t('General')}
        Icon={SvgCog}
        to="/settings/general"
      />
      {/* A phone has no titlebar bell. A fixed row, not a sidebar-menu item. */}
      {isNarrowWidth && isNewsEnabled && (
        <SettingsNavLink
          title={t('Notifications')}
          Icon={SvgNotificationsOutline}
          to="/notifications"
          aria-label={
            unseenCount > 0
              ? t('Notifications: {{count}} unread', { count: unseenCount })
              : undefined
          }
          badge={
            unseenCount > 0 && (
              <Text
                aria-hidden
                style={{
                  minWidth: 20,
                  height: 20,
                  lineHeight: '20px',
                  padding: '0 6px',
                  borderRadius: 10,
                  fontSize: 12,
                  fontWeight: 700,
                  textAlign: 'center',
                  fontVariantNumeric: 'tabular-nums',
                  backgroundColor: theme.pillBackgroundSelected,
                  color: theme.pillTextSelected,
                }}
              >
                {displayedCount}
              </Text>
            )
          }
        />
      )}
      {/* fork: sc-3514. The iOS app hides the web tab grid, which held Schedules */}
      {isNarrowWidth && hasNativeTabBar() && (
        <SettingsNavLink
          title={itemDetails.schedules.title}
          Icon={itemDetails.schedules.Icon}
          to="/schedules"
        />
      )}
      {menuItems.map(item => (
        <SettingsNavLink
          key={item.id}
          title={itemDetails[item.id].title}
          Icon={itemDetails[item.id].Icon}
          to={getSidebarMenuItemPath(item.id, false)}
        />
      ))}
      <SettingsNavLink
        title={t('Advanced')}
        Icon={SvgSettingsSliderAlternate}
        to="/settings/advanced"
      />
      <SettingsNavLink
        title={t('Experimental')}
        Icon={SvgPylon}
        to="/settings/experimental"
      />
    </View>
  );
}

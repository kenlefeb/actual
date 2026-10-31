import type { ReactNode } from 'react';

import { styles } from '@actual-app/components/styles';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';

type StickyFormFooterProps = {
  // Optional line above the buttons, such as a paycheck's net pay
  summary?: ReactNode;
  // Space between the summary and the buttons
  gap?: number;
  'data-testid'?: string;
  children: ReactNode;
};

// The footer for a phone form page: pass it to `Page`'s `footer` prop and put
// the full-width primary Save button inside. Size the buttons with
// `useTouchTargetStyle`.
export function StickyFormFooter({
  summary,
  gap = 10,
  'data-testid': testId,
  children,
}: StickyFormFooterProps) {
  return (
    <View
      data-testid={testId}
      style={{
        gap,
        paddingLeft: styles.mobileEditingPadding,
        paddingRight: styles.mobileEditingPadding,
        paddingTop: 10,
        paddingBottom: 'calc(10px + env(safe-area-inset-bottom))',
        backgroundColor: theme.tableHeaderBackground,
        borderTopWidth: 1,
        borderColor: theme.tableBorder,
      }}
    >
      {summary && <View style={styles.mediumText}>{summary}</View>}
      {children}
    </View>
  );
}

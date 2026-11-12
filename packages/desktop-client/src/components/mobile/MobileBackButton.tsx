import React from 'react';
import type { ComponentPropsWithoutRef } from 'react';
import { Trans } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { SvgCheveronLeft } from '@actual-app/components/icons/v1';
import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';

import { useGoBack } from '#hooks/useGoBack';

type MobileBackButtonProps = ComponentPropsWithoutRef<typeof Button> & {
  // A transaction page's account, where Back goes if it wasn't opened from a screen
  account?: string | null;
};

export function MobileBackButton({
  onPress,
  account,
  style,
  ...props
}: MobileBackButtonProps) {
  const { hidden, goBack } = useGoBack(account);
  if (hidden && !onPress) return null;
  return (
    <Button
      variant="bare"
      style={{
        // A 40px touch target, centred in the 50px header
        margin: '0 10px',
        minHeight: styles.mobileMinHeight,
        minWidth: styles.mobileMinHeight,
        ...style,
      }}
      onPress={onPress || goBack}
      {...props}
    >
      <SvgCheveronLeft
        style={{ width: 30, height: 30, margin: -10, marginLeft: -5 }}
      />
      <Text
        style={{
          ...styles.text,
          fontWeight: 500,
          marginLeft: 5,
          marginRight: 5,
        }}
      >
        <Trans>Back</Trans>
      </Text>
    </Button>
  );
}

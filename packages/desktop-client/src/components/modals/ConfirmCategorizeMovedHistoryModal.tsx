import React from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { useResponsive } from '@actual-app/components/hooks/useResponsive';
import { InitialFocus } from '@actual-app/components/initial-focus';
import { Paragraph } from '@actual-app/components/paragraph';
import { styles } from '@actual-app/components/styles';
import { View } from '@actual-app/components/view';

import { Modal, ModalCloseButton, ModalHeader } from '#components/common/Modal';
import type { Modal as ModalType } from '#modals/modalsSlice';

type ConfirmCategorizeMovedHistoryModalProps = Extract<
  ModalType,
  { name: 'confirm-categorize-moved-history' }
>['options'];

export function ConfirmCategorizeMovedHistoryModal({
  onConfirm,
}: ConfirmCategorizeMovedHistoryModalProps) {
  const { t } = useTranslation();
  const { isNarrowWidth } = useResponsive();
  const narrowButtonStyle = isNarrowWidth
    ? { height: styles.mobileMinHeight }
    : {};

  return (
    <Modal name="confirm-categorize-moved-history">
      {({ state }) => (
        <>
          <ModalHeader
            title={t('Categorize moved history?')}
            rightContent={<ModalCloseButton onPress={() => state.close()} />}
          />
          <View style={{ lineHeight: 1.5 }}>
            <Paragraph>
              <Trans>
                This is already in the account's starting balance. Categorizing
                it counts the money twice, and the starting balance stops
                reconciling.
              </Trans>
            </Paragraph>
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
              <InitialFocus>
                <Button
                  style={{ marginRight: 10, ...narrowButtonStyle }}
                  onPress={() => state.close()}
                >
                  <Trans>Cancel</Trans>
                </Button>
              </InitialFocus>
              <Button
                variant="primary"
                style={narrowButtonStyle}
                onPress={() => {
                  onConfirm();
                  state.close();
                }}
              >
                <Trans>Categorize anyway</Trans>
              </Button>
            </View>
          </View>
        </>
      )}
    </Modal>
  );
}

import { useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { useResponsive } from '@actual-app/components/hooks/useResponsive';
import { Input } from '@actual-app/components/input';
import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { spacing } from '@actual-app/components/tokens';
import { View } from '@actual-app/components/view';
import { send } from '@actual-app/core/platform/client/connection';
import type { MoveOnBudgetPreview } from '@actual-app/core/server/accounts/move-on-budget';
import * as monthUtils from '@actual-app/core/shared/months';
import type { AccountEntity } from '@actual-app/core/types/models';

import {
  Modal,
  ModalCloseButton,
  ModalHeader,
  ModalTitle,
} from '#components/common/Modal';
import { FinancialText } from '#components/FinancialText';
import { MobileSheet } from '#components/mobile/MobileSheet';
import { useAccount } from '#hooks/useAccount';
import { useCategoriesById } from '#hooks/useCategories';
import { useDateFormat } from '#hooks/useDateFormat';
import { useFormat } from '#hooks/useFormat';

// The warning lists this many transfers, then "and N more"
const LISTED_TRANSFERS = 20;

type MoveOnBudgetModalProps = {
  accountId: AccountEntity['id'];
};

export function MoveOnBudgetModal({ accountId }: MoveOnBudgetModalProps) {
  const { t } = useTranslation();
  const { isNarrowWidth } = useResponsive();
  const touchStyle = isNarrowWidth ? { minHeight: styles.mobileMinHeight } : {};
  const account = useAccount(accountId);
  const { data: categories } = useCategoriesById();
  const format = useFormat();
  const dateFormat = useDateFormat() || 'MM/dd/yyyy';

  const [startDate, setStartDate] = useState(() =>
    monthUtils.firstDayOfMonth(monthUtils.currentDay()),
  );
  const [preview, setPreview] = useState<MoveOnBudgetPreview | null>(null);
  const [isMoving, setIsMoving] = useState(false);
  const isDateValid = /^\d{4}-\d{2}-\d{2}$/.test(startDate);

  useEffect(() => {
    if (!isDateValid) {
      return;
    }
    let isCurrent = true;
    void send('account-move-on-budget-preview', {
      id: accountId,
      startDate,
    }).then(result => {
      if (isCurrent) {
        setPreview(result);
      }
    });
    return () => {
      isCurrent = false;
    };
  }, [accountId, startDate, isDateValid]);

  const date = (day: string) => monthUtils.format(day, dateFormat);
  const shownDate = isDateValid ? date(startDate) : startDate;
  const title = t('Move {{name}} on budget', { name: account?.name ?? '' });

  async function onMove(close: () => void) {
    setIsMoving(true);
    try {
      await send('account-move-on-budget', { id: accountId, startDate });
      close();
    } finally {
      setIsMoving(false);
    }
  }

  const renderBody = (close: () => void) => (
    <View style={{ gap: 12, width: '100%', maxWidth: 480 }}>
      <View style={{ gap: 5 }}>
        <label htmlFor="move-on-budget-start">
          <Trans>Budget it from</Trans>
        </label>
        <Input
          id="move-on-budget-start"
          type="date"
          value={startDate}
          onChangeValue={setStartDate}
          style={{ width: 170, ...touchStyle }}
        />
      </View>

      {preview && (
        <View style={{ gap: 8 }} aria-live="polite">
          <Text>
            {t('The budget gains a starting balance on {{date}}:', {
              date: shownDate,
            })}{' '}
            <FinancialText>
              {format(preview.startingBalance, 'financial')}
            </FinancialText>
          </Text>
          <Text>{t("The account balance doesn't change.")}</Text>
          <Text>
            {t('{{count}} transactions before {{date}} become uncategorized.', {
              count: preview.before,
              date: shownDate,
            })}
          </Text>
          <Text>
            {t('{{count}} categories will be cleared.', {
              count: preview.categoriesCleared,
            })}
          </Text>
          <Text>
            {t(
              '{{count}} transactions from {{date}} have no category, and {{kept}} keep their category.',
              {
                count: preview.fromUncategorized,
                kept: preview.categoriesKept,
                date: shownDate,
              },
            )}
          </Text>
          {preview.transfers.length > 0 && (
            <View style={{ gap: 4 }}>
              <Text>
                {t('{{count}} transfers:', {
                  count: preview.transfers.length,
                })}
              </Text>
              <ul
                aria-label={t('Transfers')}
                style={{ margin: 0, paddingLeft: 18 }}
              >
                {preview.transfers.slice(0, LISTED_TRANSFERS).map(transfer => (
                  <li key={transfer.id}>
                    {date(transfer.date)} · {transfer.otherAccountName ?? ''} ·{' '}
                    <FinancialText>
                      {format(transfer.amount, 'financial')}
                    </FinancialText>
                    {transfer.keptCategory &&
                      ` · ${t('keeps {{category}}', {
                        category:
                          categories?.list[transfer.keptCategory]?.name ?? '',
                      })}`}
                  </li>
                ))}
              </ul>
              {preview.transfers.length > LISTED_TRANSFERS && (
                <Text>
                  {t('and {{count}} more', {
                    count: preview.transfers.length - LISTED_TRANSFERS,
                  })}
                </Text>
              )}
              <Text style={{ color: theme.pageTextSubdued }}>
                <Trans>
                  A kept category is cleared if you edit that transfer later.
                </Trans>
              </Text>
            </View>
          )}
        </View>
      )}

      <View
        style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10 }}
      >
        <Button style={touchStyle} onPress={() => close()}>
          <Trans>Cancel</Trans>
        </Button>
        <Button
          variant="primary"
          style={touchStyle}
          isDisabled={!preview || !isDateValid || isMoving}
          onPress={() => void onMove(close)}
        >
          <Trans>Move on budget</Trans>
        </Button>
      </View>
    </View>
  );

  if (isNarrowWidth) {
    return (
      <MobileSheet name="account-move-on-budget" title={title}>
        {({ close }) => (
          <View style={{ padding: `0 ${spacing.lg}px ${spacing.lg}px` }}>
            {renderBody(close)}
          </View>
        )}
      </MobileSheet>
    );
  }

  return (
    <Modal name="account-move-on-budget">
      {({ state }) => (
        <>
          <ModalHeader
            title={<ModalTitle title={title} />}
            rightContent={<ModalCloseButton onPress={() => state.close()} />}
          />
          {renderBody(() => state.close())}
        </>
      )}
    </Modal>
  );
}

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
import type { TransObjectLiteral } from '@actual-app/core/types/util';

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
    <View style={{ gap: 12, width: '100%', maxWidth: 480, minHeight: 0 }}>
      {/* Scrolls on a phone, so the buttons stay in view below */}
      <View
        data-testid="move-on-budget-scroll"
        style={{
          gap: 12,
          minHeight: 0,
          ...(isNarrowWidth && { maxHeight: '55vh', overflowY: 'auto' }),
        }}
      >
        {/* Children keep their height, so the area scrolls instead of squashing them */}
        <View style={{ gap: 5, flexShrink: 0 }}>
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
          <View style={{ gap: 8, flexShrink: 0 }} aria-live="polite">
            <Text style={{ fontSize: 15 }}>
              {preview.startingBalance === 0 ? (
                <Trans>Your budget doesn't change.</Trans>
              ) : preview.startingBalance < 0 ? (
                <Trans>
                  Your budget is reduced by{' '}
                  <FinancialText style={{ fontWeight: 700 }}>
                    {
                      {
                        amount: format(
                          Math.abs(preview.startingBalance),
                          'financial',
                        ),
                      } as TransObjectLiteral
                    }
                  </FinancialText>{' '}
                  on {{ date: shownDate }}, in Starting Balances.
                </Trans>
              ) : (
                <Trans>
                  Your budget gains{' '}
                  <FinancialText style={{ fontWeight: 700 }}>
                    {
                      {
                        amount: format(preview.startingBalance, 'financial'),
                      } as TransObjectLiteral
                    }
                  </FinancialText>{' '}
                  on {{ date: shownDate }}, in Starting Balances.
                </Trans>
              )}
            </Text>

            {preview.before > 0 && (
              <Text>
                {t(
                  "{{count}} transactions before {{date}} are covered by the starting balance. They show as moved history and aren't counted as uncategorized.",
                  {
                    defaultValue_one:
                      "{{count}} transaction before {{date}} is covered by the starting balance. It shows as moved history and isn't counted as uncategorized.",
                    count: preview.before,
                    date: shownDate,
                  },
                )}
              </Text>
            )}
            {preview.fromUncategorized > 0 && (
              <Text>
                {t('{{count}} transactions from {{date}} need a category.', {
                  defaultValue_one:
                    '{{count}} transaction from {{date}} needs a category.',
                  count: preview.fromUncategorized,
                  date: shownDate,
                })}
              </Text>
            )}
            {preview.categoriesKept > 0 && (
              <Text>
                {t('{{count}} keep their category.', {
                  defaultValue_one: '{{count}} keeps its category.',
                  count: preview.categoriesKept,
                })}
              </Text>
            )}
            {preview.categoriesCleared > 0 && (
              <Text>
                {t('{{count}} categories will be cleared.', {
                  defaultValue_one: '{{count}} category will be cleared.',
                  count: preview.categoriesCleared,
                })}
              </Text>
            )}

            {preview.transfers.length > 0 && (
              <View style={{ gap: 4 }}>
                <Text>
                  {t('{{count}} transfers:', {
                    defaultValue_one: '{{count}} transfer:',
                    count: preview.transfers.length,
                  })}
                </Text>
                <ul
                  aria-label={t('Transfers')}
                  style={{ margin: 0, paddingLeft: 18 }}
                >
                  {preview.transfers
                    .slice(0, LISTED_TRANSFERS)
                    .map(transfer => (
                      <li key={transfer.id}>
                        {date(transfer.date)} ·{' '}
                        {transfer.otherAccountName ?? ''} ·{' '}
                        <FinancialText>
                          {format(transfer.amount, 'financial')}
                        </FinancialText>
                        {transfer.keptCategory &&
                          ` · ${t('keeps {{category}}', {
                            category:
                              categories?.list[transfer.keptCategory]?.name ??
                              '',
                          })}`}
                      </li>
                    ))}
                </ul>
                {preview.transfers.length > LISTED_TRANSFERS && (
                  <Text>
                    {t('and {{count}} more', {
                      defaultValue_one: 'and {{count}} more',
                      count: preview.transfers.length - LISTED_TRANSFERS,
                    })}
                  </Text>
                )}
                <Text style={{ color: theme.paycheckNoteText }}>
                  <Trans>
                    A kept category is cleared if you edit that transfer later.
                  </Trans>
                </Text>
              </View>
            )}

            <Text style={{ color: theme.paycheckNoteText }}>
              <Trans>
                The account balance and earlier months don't change.
              </Trans>
            </Text>
          </View>
        )}
      </View>

      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'flex-end',
          gap: 10,
          flexShrink: 0,
        }}
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

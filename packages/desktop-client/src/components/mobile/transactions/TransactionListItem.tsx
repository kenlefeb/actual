import React, { useLayoutEffect, useRef, useState } from 'react';
import type { SyntheticEvent,CSSProperties } from 'react';
import { mergeProps } from 'react-aria';
import type { ListBoxItemRenderProps } from 'react-aria-components';
import { useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { SvgSplit } from '@actual-app/components/icons/v0';
import { SvgAttachment } from '@actual-app/components/icons/v1';
import {
  SvgArrowsSynchronize,
  SvgCalendar3,
  SvgCheckCircle1,
  SvgLockClosed,
} from '@actual-app/components/icons/v2';
import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { TextOneLine } from '@actual-app/components/text-one-line';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import { isMovedHistory } from '@actual-app/core/shared/moved-history';
import { isRepeatingDate } from '@actual-app/core/shared/schedules';
import { isPreviewId } from '@actual-app/core/shared/transactions';
import { integerToCurrency } from '@actual-app/core/shared/util';
import type { IntegerAmount } from '@actual-app/core/shared/util';
import type {
  AccountEntity,
  TransactionEntity,
} from '@actual-app/core/types/models';
import {
  PressResponder,
  useLongPress,
  usePress,
} from '@react-aria/interactions';

import { makeAmountFullStyle } from '#components/budget/util';
import { TransferDirectionIcon } from '#components/common/TransferDirectionIcon';
import { useTransactionAttachments } from '#components/transactions/TransactionAttachments';
import { useAccount } from '#hooks/useAccount';
import { useCachedSchedules } from '#hooks/useCachedSchedules';
import { useCategories } from '#hooks/useCategories';
import { useDisplayPayee } from '#hooks/useDisplayPayee';
import { usePayee } from '#hooks/usePayee';
import { NotesTagFormatter } from '#notes/NotesTagFormatter';
import { useSelector } from '#redux';

import { lookupName, Status } from './TransactionEdit';

export const ROW_HEIGHT = 60;

// A press that starts on a tag or a link belongs to that control. If it
// reached the shared press state, a link that opens a new window would leave
// the press unfinished and swallow the next tap on the row.
function ignoreInteractiveTargets<T extends object>(props: T): T {
  return Object.fromEntries(
    Object.entries(props).map(([key, value]) =>
      typeof value === 'function'
        ? [
            key,
            (event: SyntheticEvent, ...rest: unknown[]) => {
              if (
                event.target instanceof Element &&
                event.target.closest('a, [data-note-interactive]')
              ) {
                return;
              }
              return (value as (...args: unknown[]) => unknown)(event, ...rest);
            },
          ]
        : [key, value],
    ),
  ) as T;
}

const getTextStyle = ({
  isPreview,
}: {
  isPreview: boolean;
}): CSSProperties => ({
  ...styles.text,
  fontSize: 14,
  ...(isPreview
    ? {
        fontStyle: 'italic',
        color: theme.pageTextLight,
      }
    : {}),
});

const getScheduleIconStyle = ({ isPreview }: { isPreview: boolean }) => ({
  width: 12,
  height: 12,
  marginRight: 5,
  color: isPreview ? theme.pageTextLight : theme.menuItemText,
});

type TransactionListItemProps = ListBoxItemRenderProps & {
  transaction?: TransactionEntity;
  showRunningBalance?: boolean;
  runningBalance?: IntegerAmount;
  isReconciling?: boolean;
  onPress: (transaction: TransactionEntity) => void;
  onLongPress: (transaction: TransactionEntity) => void;
  onToggleCleared?: (transaction: TransactionEntity) => void;
  onNotesTagClick?: (tag: string) => void;
};

export function TransactionListItem({
  showRunningBalance,
  runningBalance,
  isReconciling = false,
  onPress,
  onLongPress,
  onToggleCleared,
  onNotesTagClick,
  transaction,
  ...itemProps
}: TransactionListItemProps) {
  const { t } = useTranslation();
  const { data: { list: categories } = { list: [] } } = useCategories();

  const { data: payee } = usePayee(transaction?.payee);
  const displayPayee = useDisplayPayee({ transaction });

  const account = useAccount(transaction?.account || '');
  const transferAccount = useAccount(payee?.transfer_acct || '');
  const isPreview = isPreviewId(transaction?.id || '');
  const { schedules = [] } = useCachedSchedules();
  const attachments = useTransactionAttachments(transaction ?? { id: '' });

  const newTransactions = useSelector(
    state => state.transactions.newTransactions,
  );

  const { longPressProps } = useLongPress({
    accessibilityDescription: 'Long press to select multiple transactions',
    onLongPress: () => {
      if (isPreview) {
        return;
      }

      onLongPress(transaction!);
    },
  });

  const { pressProps } = usePress({
    onPress: () => {
      onPress(transaction!);
    },
  });

  // The notes line lives outside the row's button (a tag or link inside a
  // button is a nested interactive control). The button keeps an invisible
  // spacer of the same size, and the real line is laid over it.
  const rowRef = useRef<HTMLDivElement>(null);
  const spacerRef = useRef<HTMLDivElement>(null);
  const [notesBox, setNotesBox] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);

  useLayoutEffect(() => {
    const row = rowRef.current;
    const spacer = spacerRef.current;
    if (!row || !spacer) {
      setNotesBox(null);
      return;
    }
    const measure = () => {
      const rowRect = row.getBoundingClientRect();
      const spacerRect = spacer.getBoundingClientRect();
      const next = {
        top: spacerRect.top - rowRect.top - row.clientTop,
        left: spacerRect.left - rowRect.left - row.clientLeft,
        width: spacerRect.width,
      };
      setNotesBox(prev =>
        prev &&
        prev.top === next.top &&
        prev.left === next.left &&
        prev.width === next.width
          ? prev
          : next,
      );
    };
    measure();
    if (typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(measure);
    // The spacer's column changes size whenever the lines above it do.
    observer.observe(row);
    observer.observe(spacer);
    if (spacer.parentElement) {
      observer.observe(spacer.parentElement);
    }
    return () => observer.disconnect();
  }, [transaction, schedules]);

  if (!transaction) {
    return null;
  }

  const {
    id,
    amount,
    category: categoryId,
    cleared: isCleared,
    reconciled: isReconciled,
    is_parent: isParent,
    is_child: isChild,
    notes,
    forceUpcoming,
    schedule: scheduleId,
  } = transaction;

  const schedule = scheduleId
    ? schedules.find(s => s.id === scheduleId)
    : undefined;
  const displayedNotes = notes || (isPreview ? schedule?.name : undefined);

  const previewStatus = forceUpcoming ? 'upcoming' : categoryId;

  const isAdded = newTransactions.includes(id);
  const categoryName = lookupName(categories, categoryId);
  const specialCategory = account?.offbudget
    ? t('Off budget')
    : transferAccount && !transferAccount.offbudget
      ? t('Transfer')
      : isParent
        ? t('Split')
        : null;

  const prettyCategory = specialCategory || categoryName;
  const textStyle = getTextStyle({ isPreview });

  const notesStyle = {
    fontSize: 11,
    fontWeight: '400',
    color: theme.tableText,
    textAlign: 'left',
    opacity: 0.85,
  } satisfies CSSProperties;

  return (
    <View
      innerRef={rowRef}
      style={{
        flexDirection: 'row',
        alignItems: 'stretch',
        width: '100%',
        height: ROW_HEIGHT,
        overflow: 'hidden',
        ...(itemProps.isSelected
          ? {
              borderWidth: '0 0 0 4px',
              borderColor: theme.mobileTransactionSelected,
              borderStyle: 'solid',
            }
          : {
              borderWidth: '0 0 1px 0',
              borderColor: theme.tableBorder,
              borderStyle: 'solid',
            }),
        ...(isPreview
          ? {
              backgroundColor: theme.tableRowHeaderBackground,
            }
          : {
              backgroundColor: theme.tableBackground,
            }),
      }}
    >
      <PressResponder {...mergeProps(pressProps, longPressProps)}>
        <Button
          {...itemProps}
          style={{
            userSelect: 'none',
            height: '100%',
            flex: 1,
            borderRadius: 0,
            borderWidth: 0,
            ...(isReconciling && { paddingRight: 0 }),
            ...(isPreview
              ? {
                  backgroundColor: theme.tableRowHeaderBackground,
                }
              : {
                  backgroundColor: theme.tableBackground,
                }),
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              flex: 1,
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: isReconciling ? '0 0 0 4px' : '0 4px',
            }}
          >
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <PayeeIcons
                  transaction={transaction}
                  transferAccount={transferAccount}
                />
                <TextOneLine
                  style={{
                    ...textStyle,
                    fontWeight: isAdded ? '600' : '400',
                    ...(!displayPayee && !isPreview
                      ? {
                          color: theme.pageTextLight,
                          fontStyle: 'italic',
                        }
                      : {}),
                  }}
                >
                  {displayPayee || t('(No payee)')}
                </TextOneLine>
              </View>
              {isPreview ? (
                <Status status={previewStatus} isSplit={isParent || isChild} />
              ) : (
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    marginTop: 3,
                  }}
                >
                  {!isReconciling &&
                    (isReconciled ? (
                      <SvgLockClosed
                        style={{
                          width: 11,
                          height: 11,
                          color: theme.noticeTextLight,
                          marginRight: 5,
                        }}
                      />
                    ) : (
                      <SvgCheckCircle1
                        style={{
                          width: 11,
                          height: 11,
                          color: isCleared
                            ? theme.noticeTextLight
                            : theme.pageTextSubdued,
                          marginRight: 5,
                        }}
                      />
                    ))}
                  {(isParent || isChild) && (
                    <SvgSplit
                      style={{
                        width: 12,
                        height: 12,
                        marginRight: 5,
                      }}
                    />
                  )}
                  {attachments.length > 0 && (
                    <SvgAttachment
                      role="img"
                      aria-label={t('Has attached documents')}
                      style={{
                        width: 12,
                        height: 12,
                        marginRight: 5,
                        color: theme.pageTextSubdued,
                      }}
                    />
                  )}
                  <TextOneLine
                    style={{
                      fontSize: 11,
                      marginTop: 1,
                      fontWeight: '400',
                      color: prettyCategory
                        ? theme.tableText
                        : theme.menuItemTextSelected,
                      fontStyle:
                        specialCategory || !prettyCategory
                          ? 'italic'
                          : undefined,
                      textAlign: 'left',
                    }}
                  >
                    {prettyCategory ||
                      (isMovedHistory(transaction, account)
                        ? t('Moved history')
                        : t('Uncategorized'))}
                  </TextOneLine>
                </View>
              )}
              {displayedNotes && (
                <View
                  innerRef={spacerRef}
                  aria-hidden
                  style={{ ...notesStyle, marginTop: 4, visibility: 'hidden' }}
                >
                  &nbsp;
                </View>
              )}
            </View>
            <View style={{ justifyContent: 'center', alignItems: 'flex-end' }}>
              <Text
                style={{
                  ...styles.tnum,
                  ...makeAmountFullStyle(amount, {
                    positiveColor: theme.tableText,
                    negativeColor: theme.tableText,
                    zeroColor: theme.numberNeutral,
                  }),
                  ...textStyle,
                }}
              >
                {integerToCurrency(amount)}
              </Text>
              {showRunningBalance && runningBalance !== undefined && (
                <Text
                  style={{
                    fontSize: 11,
                    fontWeight: '400',
                    ...styles.tnum,
                    ...makeAmountFullStyle(runningBalance, {
                      positiveColor: theme.numberPositive,
                      negativeColor: theme.numberNegative,
                      zeroColor: theme.numberNeutral,
                    }),
                  }}
                >
                  {integerToCurrency(runningBalance)}
                </Text>
              )}
            </View>
          </View>
        </Button>
      </PressResponder>
      {displayedNotes && (
        <div
          {...ignoreInteractiveTargets(mergeProps(pressProps, longPressProps))}
          style={{
            position: 'absolute',
            top: notesBox?.top,
            left: notesBox?.left,
            width: notesBox?.width,
            visibility: notesBox ? 'visible' : 'hidden',
            userSelect: 'none',
          }}
        >
          <TextOneLine style={notesStyle}>
            <NotesTagFormatter
              notes={displayedNotes}
              onNotesTagClick={onNotesTagClick}
            />
          </TextOneLine>
        </div>
      )}
      {isReconciling &&
        !isPreview &&
        (isChild ? (
          <View
            style={{
              width: 32,
              flexShrink: 0,
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            <ClearedStatusIcon
              isReconciled={isReconciled}
              isCleared={isCleared}
            />
          </View>
        ) : (
          <Button
            variant="bare"
            aria-label={
              isReconciled
                ? t('Unlock reconciled transaction')
                : isCleared
                  ? t('Unclear transaction')
                  : t('Clear transaction')
            }
            style={{
              width: 32,
              height: '100%',
              flexShrink: 0,
              borderRadius: 0,
            }}
            onPress={() => onToggleCleared?.(transaction)}
          >
            <ClearedStatusIcon
              isReconciled={isReconciled}
              isCleared={isCleared}
            />
          </Button>
        ))}
    </View>
  );
}

type ClearedStatusIconProps = {
  isReconciled?: boolean;
  isCleared?: boolean;
};

function ClearedStatusIcon({
  isReconciled,
  isCleared,
}: ClearedStatusIconProps) {
  return isReconciled ? (
    <SvgLockClosed
      style={{
        width: 13,
        height: 13,
        color: theme.noticeTextLight,
      }}
    />
  ) : (
    <SvgCheckCircle1
      style={{
        width: 13,
        height: 13,
        color: isCleared ? theme.noticeTextLight : theme.pageTextSubdued,
      }}
    />
  );
}

type PayeeIconsProps = {
  transaction: TransactionEntity;
  transferAccount?: AccountEntity;
};

function PayeeIcons({ transaction, transferAccount }: PayeeIconsProps) {
  const { id, schedule: scheduleId } = transaction;
  const { isLoading: isSchedulesLoading, schedules = [] } =
    useCachedSchedules();
  const isPreview = isPreviewId(id);
  const schedule = schedules.find(s => s.id === scheduleId);
  const isScheduleRecurring = isRepeatingDate(schedule?._date);

  if (isSchedulesLoading) {
    return null;
  }

  return (
    <>
      {schedule &&
        (isScheduleRecurring ? (
          <SvgArrowsSynchronize style={getScheduleIconStyle({ isPreview })} />
        ) : (
          <SvgCalendar3 style={getScheduleIconStyle({ isPreview })} />
        ))}
      {transferAccount && (
        <TransferDirectionIcon
          isDeposit={transaction.amount > 0}
          style={{ width: 12, height: 12, marginRight: 5 }}
        />
      )}
    </>
  );
}

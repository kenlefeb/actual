import React, { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { SvgInformationOutline } from '@actual-app/components/icons/v1';
import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import { format as formatDate, parseISO } from 'date-fns';

import { useDateFormat } from '#hooks/useDateFormat';
import { useLocale } from '#hooks/useLocale';
import { useNavigate } from '#hooks/useNavigate';

import { providerName } from './statementBalance';
import type {
  BalanceSource,
  StatementBalancePrefill,
} from './statementBalance';

type ReconcileBalanceChoicesProps = {
  variant: 'desktop' | 'mobile';
  accountSyncSource: string | null | undefined;
  prefill: StatementBalancePrefill;
  /** The source whose amount the field was last set from. */
  applied: BalanceSource | null;
  /** The person changed the amount after it was set. */
  edited: boolean;
  isEmpty: boolean;
  onChoose: (source: BalanceSource) => void;
  onRestore: () => void;
  onNavigate?: () => void;
};

/** The always-visible source line, its explanation, and the other balances on offer (D4). */
export function ReconcileBalanceChoices({
  variant,
  accountSyncSource,
  prefill,
  applied,
  edited,
  isEmpty,
  onChoose,
  onRestore,
  onNavigate,
}: ReconcileBalanceChoicesProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const dateFormat = useDateFormat() || 'MM/dd/yyyy';
  const locale = useLocale();
  const isMobile = variant === 'mobile';
  // Desktop: hover or focus shows the note; phone: a tap shows it and a tap hides it
  const [isOpen, setIsOpen] = useState(false);

  const provider = providerName(accountSyncSource) ?? t('bank');
  const day = (asOf: string | null) =>
    asOf ? formatDate(parseISO(asOf), dateFormat, { locale }) : null;

  const isBank = applied?.source === 'bank-sync' && !edited;
  let line: string;
  if (edited) {
    line = t('Entered by you');
  } else if (applied?.source === 'cleared') {
    line = t('Your cleared balance, not an independent check');
  } else if (applied) {
    line = applied.as_of
      ? t('From {{provider}} balance, synced {{date}}', {
          provider,
          date: day(applied.as_of),
        })
      : t('From {{provider}} balance, date unknown', { provider });
  } else {
    line = t('No recent bank balance');
  }

  const buttonStyle = isMobile ? { height: styles.mobileMinHeight } : undefined;

  const note = isOpen && isBank && (
    <View
      role="note"
      style={{
        ...(!isMobile && {
          position: 'absolute',
          top: '100%',
          left: 0,
          zIndex: 1,
          width: 240,
          backgroundColor: theme.menuBackground,
          border: `1px solid ${theme.menuBorder}`,
          boxShadow: styles.shadow.boxShadow,
          padding: 8,
          borderRadius: 4,
        }),
        color: theme.pageTextLight,
        fontSize: 12,
      }}
    >
      <Text>
        {t('May include pending items. Compare with your statement.')}
      </Text>
      {!isMobile && (
        <Button
          variant="bare"
          style={{ alignSelf: 'flex-start', marginTop: 4 }}
          onPress={() => {
            onNavigate?.();
            void navigate('/bank-sync');
          }}
        >
          {t('Bank Sync Settings…')}
        </Button>
      )}
    </View>
  );

  return (
    <View
      style={{ gap: 6, marginBottom: 6 }}
      onMouseEnter={isMobile ? undefined : () => setIsOpen(true)}
      onMouseLeave={isMobile ? undefined : () => setIsOpen(false)}
      onFocus={isMobile ? undefined : () => setIsOpen(true)}
      onBlur={
        isMobile
          ? undefined
          : e => {
              if (!e.currentTarget.contains(e.relatedTarget)) setIsOpen(false);
            }
      }
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 4,
          justifyContent: isMobile ? 'center' : undefined,
          position: 'relative',
        }}
      >
        {isBank && (
          <Button
            variant="bare"
            aria-label={t('About this balance')}
            aria-expanded={isOpen}
            onPress={isMobile ? () => setIsOpen(open => !open) : undefined}
            style={
              isMobile
                ? { minWidth: 44, minHeight: 44, padding: 0 }
                : { padding: 2 }
            }
          >
            <SvgInformationOutline
              style={{ width: 12, height: 12, color: theme.pageTextLight }}
            />
          </Button>
        )}
        <Text style={{ color: theme.pageTextLight, fontSize: 12 }}>{line}</Text>
        {edited && prefill.prefill && (
          <Button
            variant="bare"
            style={{ fontSize: 12 }}
            onPress={onRestore}
            aria-label={t('Restore bank balance')}
          >
            <Trans>Restore bank balance</Trans>
          </Button>
        )}
        {!isMobile && note}
      </View>
      {isMobile && note}
      {isEmpty && !applied && !edited && (
        <Text style={{ color: theme.pageTextLight, fontSize: 12 }}>
          <Trans>Enter the closing balance from your statement.</Trans>
        </Text>
      )}
      {prefill.alternatives.map(alternative =>
        alternative.source === 'cleared' ? (
          <View key="cleared" style={{ gap: 2 }}>
            <Button style={buttonStyle} onPress={() => onChoose(alternative)}>
              <Trans>Use cleared balance</Trans>
            </Button>
            <Text
              style={{
                color: theme.pageTextLight,
                fontSize: 12,
                textAlign: 'center',
              }}
            >
              {t('Your own cleared total — not an independent check')}
            </Text>
          </View>
        ) : (
          <Button
            key="bank-sync"
            style={buttonStyle}
            onPress={() => onChoose(alternative)}
          >
            {alternative.as_of
              ? t('Use bank balance from {{date}}', {
                  date: day(alternative.as_of),
                })
              : t('Use bank balance (date unknown)')}
          </Button>
        ),
      )}
    </View>
  );
}

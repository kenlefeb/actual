import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Navigate, useParams } from 'react-router';

import { Button } from '@actual-app/components/button';
import { styles } from '@actual-app/components/styles';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import { format as monthUtilFormat } from '@actual-app/core/shared/months';
import type { PaycheckEntity } from '@actual-app/core/types/models';

import { MobileBackButton } from '#components/mobile/MobileBackButton';
import { StickyFormFooter } from '#components/mobile/StickyFormFooter';
import {
  PaycheckActions,
  PaycheckDeductionFields,
  PaycheckDepositFields,
  PaycheckFormErrors,
  PaycheckGrossFields,
  PaycheckNameFields,
  PaycheckNetPay,
  PaycheckScheduleFields,
} from '#components/modals/PaycheckEditModal/PaycheckFormFields';
import { PaycheckYearToDate } from '#components/modals/PaycheckEditModal/PaycheckYearToDate';
import { MobilePageHeader, Page } from '#components/Page';
import { useDateFormat } from '#hooks/useDateFormat';
import { useFormat } from '#hooks/useFormat';
import { useNavigate } from '#hooks/useNavigate';
import { usePaycheckForm } from '#hooks/usePaycheckForm';
import { usePaychecks } from '#hooks/usePaychecks';
import { useTouchTargetStyle } from '#hooks/useTouchTargetStyle';

export function MobilePaycheckPage() {
  const { id } = useParams<{ id?: string }>();
  const { data: paychecks = [], isPlaceholderData } = usePaychecks();
  const isNew = !id || id === 'new';
  const paycheck = isNew ? undefined : paychecks.find(p => p.id === id);

  // Wait for an existing paycheck before seeding the form with it
  if (!isNew && isPlaceholderData) {
    return null;
  }
  // Just deleted (the editor unmounts before its own close can run), deleted
  // elsewhere while open, or a stale link
  if (!isNew && !paycheck) {
    return <Navigate to="/schedules" replace />;
  }
  return <MobilePaycheckEditor paycheck={paycheck} />;
}

function MobilePaycheckEditor({ paycheck }: { paycheck?: PaycheckEntity }) {
  const { t } = useTranslation();
  const touchTarget = useTouchTargetStyle();
  const navigate = useNavigate();
  const format = useFormat();
  const dateFormat = useDateFormat() || 'MM/dd/yyyy';
  const form = usePaycheckForm(paycheck);
  const close = () => void navigate(-1);
  // A new paycheck starts open; an existing one starts as summaries
  const isOpenAtStart = !paycheck;
  const { definition, accountById } = form;

  const clearingSummary = form.isNewAccount
    ? form.clearingName
    : accountById.get(definition.clearingAccount)?.name;
  const deductionTotal = definition.deductions.reduce(
    (sum, d) => sum + d.amount,
    0,
  );

  return (
    <Page
      header={
        <MobilePageHeader
          title={paycheck ? t('Edit paycheck') : t('Add paycheck')}
          leftContent={<MobileBackButton onPress={close} />}
        />
      }
      footer={
        <StickyFormFooter summary={<PaycheckNetPay form={form} />}>
          <Button
            variant="primary"
            isDisabled={form.formErrors.length > 0}
            onPress={() => form.save(close)}
            style={touchTarget}
          >
            <Trans>Save</Trans>
          </Button>
        </StickyFormFooter>
      }
      padding={0}
    >
      <View style={{ padding: styles.mobileEditingPadding, gap: 10 }}>
        <CollapsibleSection
          title={t('Details')}
          summary={[form.name, form.employerName].filter(Boolean).join(' · ')}
          isOpenAtStart={isOpenAtStart}
        >
          <PaycheckNameFields form={form} />
        </CollapsibleSection>
        <CollapsibleSection
          title={t('Clearing account and pay dates')}
          summary={[
            clearingSummary,
            form.nextPayDate &&
              t('Next paycheck: {{date}}', {
                date: monthUtilFormat(form.nextPayDate, dateFormat),
              }),
          ]
            .filter(Boolean)
            .join(' · ')}
          isOpenAtStart={isOpenAtStart}
        >
          <PaycheckScheduleFields form={form} />
        </CollapsibleSection>
        <CollapsibleSection
          title={t('Gross pay')}
          summary={format(definition.grossAmount, 'financial')}
          isOpenAtStart={isOpenAtStart}
        >
          <PaycheckGrossFields form={form} />
        </CollapsibleSection>
        <CollapsibleSection
          title={t('Deductions')}
          summary={t('{{count}} deductions · {{total}}', {
            defaultValue_one: '{{count}} deduction · {{total}}',
            count: definition.deductions.length,
            total: format(deductionTotal, 'financial'),
          })}
          isOpenAtStart={isOpenAtStart}
        >
          <PaycheckDeductionFields form={form} />
        </CollapsibleSection>
        <CollapsibleSection
          title={t('Direct deposits')}
          summary={definition.deposits
            .map(
              d =>
                `${accountById.get(d.account)?.name ?? t('No account')} ${format(
                  form.depositAmounts.get(d.id) ?? 0,
                  'financial',
                )}`,
            )
            .join(', ')}
          isOpenAtStart={isOpenAtStart}
        >
          <PaycheckDepositFields form={form} />
        </CollapsibleSection>
        {paycheck && <PaycheckYearToDate paycheckId={paycheck.id} />}

        <PaycheckFormErrors form={form} />

        {paycheck && (
          <View style={{ gap: 10, alignItems: 'stretch', flexShrink: 0 }}>
            <PaycheckActions form={form} close={close} />
          </View>
        )}
      </View>
    </Page>
  );
}

function CollapsibleSection({
  title,
  summary,
  isOpenAtStart,
  children,
}: {
  title: string;
  summary: string;
  isOpenAtStart: boolean;
  children: ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(isOpenAtStart);
  const contentId = useId();
  return (
    <View
      style={{
        backgroundColor: theme.tableBackground,
        border: `1px solid ${theme.tableBorder}`,
        borderRadius: 6,
        // Keep its full height; the page scrolls instead of squeezing sections
        flexShrink: 0,
      }}
    >
      <Button
        variant="bare"
        aria-expanded={isOpen}
        aria-controls={contentId}
        onPress={() => setIsOpen(!isOpen)}
        style={{
          justifyContent: 'flex-start',
          textAlign: 'left',
          minHeight: styles.mobileMinHeight,
          padding: 10,
        }}
      >
        <View style={{ gap: 2, minWidth: 0, flex: 1 }}>
          <Text style={{ fontWeight: 600 }}>{title}</Text>
          {!isOpen && summary && (
            <Text
              style={{
                color: theme.pageTextSubdued,
                ...styles.tnum,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {summary}
            </Text>
          )}
        </View>
      </Button>
      {isOpen && (
        <View id={contentId} style={{ padding: 10, paddingTop: 0, gap: 8 }}>
          {children}
        </View>
      )}
    </View>
  );
}

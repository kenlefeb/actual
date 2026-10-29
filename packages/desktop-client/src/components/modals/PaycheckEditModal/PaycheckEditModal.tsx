import type { ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { Text } from '@actual-app/components/text';
import { View } from '@actual-app/components/view';
import type { PaycheckEntity } from '@actual-app/core/types/models';

import {
  Modal,
  ModalCloseButton,
  ModalHeader,
  ModalTitle,
} from '#components/common/Modal';
import { usePaycheckForm } from '#hooks/usePaycheckForm';
import { usePaychecks } from '#hooks/usePaychecks';

import {
  PaycheckActions,
  PaycheckDeductionFields,
  PaycheckDepositFields,
  PaycheckFormErrors,
  PaycheckGrossFields,
  PaycheckNameFields,
  PaycheckNetPay,
  PaycheckScheduleFields,
} from './PaycheckFormFields';
import { PaycheckYearToDate } from './PaycheckYearToDate';

type PaycheckEditModalProps = {
  paycheckId?: PaycheckEntity['id'];
};

export function PaycheckEditModal({ paycheckId }: PaycheckEditModalProps) {
  const { data: paychecks = [], isPlaceholderData } = usePaychecks();
  const paycheck = paychecks.find(p => p.id === paycheckId);

  // Wait for an existing paycheck before seeding the form with it
  if (paycheckId && (isPlaceholderData || !paycheck)) {
    return null;
  }
  return <PaycheckEditor paycheck={paycheck} />;
}

function PaycheckEditor({ paycheck }: { paycheck?: PaycheckEntity }) {
  const { t } = useTranslation();
  const form = usePaycheckForm(paycheck);

  return (
    <Modal
      name="paycheck-edit"
      containerProps={{ style: { width: '80vw', maxWidth: 900 } }}
    >
      {({ state }) => (
        <>
          <ModalHeader
            title={
              <ModalTitle
                title={paycheck ? t('Edit paycheck') : t('Add paycheck')}
              />
            }
            rightContent={<ModalCloseButton onPress={() => state.close()} />}
          />
          <View style={{ gap: 15 }}>
            <PaycheckNameFields form={form} />
            <PaycheckScheduleFields form={form} />
            <PaycheckGrossFields form={form} />

            <Section title={t('Deductions')}>
              <PaycheckDeductionFields form={form} />
            </Section>

            <PaycheckNetPay form={form} />

            <Section title={t('Direct deposits')}>
              <PaycheckDepositFields form={form} />
            </Section>

            {paycheck && <PaycheckYearToDate paycheckId={paycheck.id} />}

            <PaycheckFormErrors form={form} />

            <View
              style={{
                flexDirection: 'row',
                gap: 10,
                justifyContent: 'flex-end',
              }}
            >
              <PaycheckActions form={form} close={() => state.close()} />
              <View style={{ flex: 1 }} />
              <Button onPress={() => state.close()}>
                <Trans>Cancel</Trans>
              </Button>
              <Button
                variant="primary"
                isDisabled={form.formErrors.length > 0}
                onPress={() => form.save(() => state.close())}
              >
                <Trans>Save</Trans>
              </Button>
            </View>
          </View>
        </>
      )}
    </Modal>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ fontWeight: 600 }}>{title}</Text>
      {children}
    </View>
  );
}

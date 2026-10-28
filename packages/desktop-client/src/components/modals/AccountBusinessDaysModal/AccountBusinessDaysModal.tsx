import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { Input } from '@actual-app/components/input';
import { Select } from '@actual-app/components/select';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import { MAX_DEPOSIT_DAYS_EARLY } from '@actual-app/core/shared/paychecks';
import type { AccountEntity } from '@actual-app/core/types/models';

import {
  Modal,
  ModalCloseButton,
  ModalHeader,
  ModalTitle,
} from '#components/common/Modal';
import { useAccount } from '#hooks/useAccount';
import { useBusinessCalendars } from '#hooks/useBusinessCalendars';
import { useSetAccountBusinessDaysMutation } from '#paychecks';

type AccountBusinessDaysModalProps = {
  accountId: AccountEntity['id'];
};

export function AccountBusinessDaysModal({
  accountId,
}: AccountBusinessDaysModalProps) {
  const { t } = useTranslation();
  const account = useAccount(accountId);
  const { data: calendars = [] } = useBusinessCalendars();
  const setBusinessDays = useSetAccountBusinessDaysMutation();

  const [calendarId, setCalendarId] = useState(
    account?.business_calendar_id ?? '',
  );
  const [daysEarly, setDaysEarly] = useState(
    String(account?.deposit_days_early ?? 0),
  );

  const days = Number(daysEarly);
  const isDaysValid =
    daysEarly.trim() !== '' &&
    Number.isInteger(days) &&
    days >= 0 &&
    days <= MAX_DEPOSIT_DAYS_EARLY;
  const isCalendarMissing =
    calendarId !== '' && !calendars.some(c => c.id === calendarId);

  return (
    <Modal name="account-business-days">
      {({ state }) => (
        <>
          <ModalHeader
            title={
              <ModalTitle
                title={t('Business days: {{name}}', {
                  name: account?.name ?? '',
                })}
              />
            }
            rightContent={<ModalCloseButton onPress={() => state.close()} />}
          />
          <View style={{ gap: 12, width: 420 }}>
            <View style={{ gap: 5 }}>
              <label htmlFor="account-business-calendar">
                <Trans>Business calendar</Trans>
              </label>
              <Select
                id="account-business-calendar"
                options={[
                  ['', t('Weekends only')],
                  ...calendars.map(c => [c.id, c.name] as const),
                  ...(isCalendarMissing
                    ? [[calendarId, t('Missing calendar')] as const]
                    : []),
                ]}
                value={calendarId}
                onChange={setCalendarId}
              />
              {isCalendarMissing && (
                <Text role="note" style={{ color: theme.warningText }}>
                  <Trans>
                    This account's calendar was deleted. Weekends are used until
                    you choose another calendar.
                  </Trans>
                </Text>
              )}
            </View>

            <View style={{ gap: 5 }}>
              <label htmlFor="account-days-early">
                <Trans>
                  Direct deposits arrive this many business days early
                </Trans>
              </label>
              <Input
                id="account-days-early"
                type="number"
                min={0}
                max={MAX_DEPOSIT_DAYS_EARLY}
                step={1}
                value={daysEarly}
                onChangeValue={setDaysEarly}
                style={{ width: 80 }}
              />
              {!isDaysValid && (
                <Text role="alert" style={{ color: theme.errorText }}>
                  <Trans>The number must be a whole number from 0 to 10.</Trans>
                </Text>
              )}
            </View>

            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'flex-end',
                gap: 10,
              }}
            >
              <Button onPress={() => state.close()}>
                <Trans>Cancel</Trans>
              </Button>
              <Button
                variant="primary"
                isDisabled={!isDaysValid}
                onPress={() =>
                  setBusinessDays.mutate(
                    {
                      id: accountId,
                      businessCalendarId: calendarId || null,
                      depositDaysEarly: days,
                    },
                    { onSuccess: () => state.close() },
                  )
                }
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

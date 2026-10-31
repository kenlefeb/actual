import { useState } from 'react';
import type { ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { Button } from '@actual-app/components/button';
import { Input } from '@actual-app/components/input';
import { Select } from '@actual-app/components/select';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import { getHolidays } from '@actual-app/core/shared/business-calendars';
import type {
  BusinessCalendarEntity,
  BusinessCalendarException,
  HolidayObservance,
  HolidayRule,
  Weekday,
} from '@actual-app/core/types/models';
import * as d from 'date-fns';
import { v4 as uuidv4 } from 'uuid';

import { Checkbox } from '#components/forms';
import { useLocale } from '#hooks/useLocale';
import { useTouchTargetStyle } from '#hooks/useTouchTargetStyle';

type BusinessCalendarEditorProps = {
  calendar: BusinessCalendarEntity;
  onSave: (calendar: BusinessCalendarEntity) => void;
  onDelete: (id: BusinessCalendarEntity['id']) => void;
  // Full-page editors (phones) place Save themselves, in a sticky footer, and
  // show Delete in the body; the dialog keeps both in one row
  renderPage?: (body: ReactNode, saveButton: ReactNode) => ReactNode;
};

const WEEKDAYS: Weekday[] = [0, 1, 2, 3, 4, 5, 6];
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

export function BusinessCalendarEditor({
  calendar,
  onSave,
  onDelete,
  renderPage,
}: BusinessCalendarEditorProps) {
  const { t } = useTranslation();
  // Touch-sized on phones; the desktop dialog keeps its compact controls
  const touch = useTouchTargetStyle();
  const locale = useLocale();
  const [draft, setDraft] = useState(calendar);
  const [weekdayError, setWeekdayError] = useState<string | null>(null);
  const [year, setYear] = useState(() => new Date().getFullYear());
  // Ids of Easter rules whose offset field holds text that was not saved
  const [invalidOffsets, setInvalidOffsets] = useState<string[]>([]);

  const weekdayName = (weekday: Weekday) =>
    d.format(new Date(2024, 0, 7 + weekday), 'EEEE', { locale });
  const monthName = (month: number) =>
    d.format(new Date(2024, month - 1, 1), 'LLLL', { locale });

  const weekdayOptions = WEEKDAYS.map(w => [w, weekdayName(w)] as const);
  const monthOptions = MONTHS.map(m => [m, monthName(m)] as const);
  const kindOptions: Array<readonly [HolidayRule['kind'], string]> = [
    ['fixed', t('Fixed date')],
    ['nth-weekday', t('Nth weekday')],
    ['last-weekday', t('Last weekday')],
    ['easter', t('Days from Easter')],
  ];
  const nthOptions: Array<readonly [1 | 2 | 3 | 4, string]> = [
    [1, t('First')],
    [2, t('Second')],
    [3, t('Third')],
    [4, t('Fourth')],
  ];
  const observanceOptions: Array<readonly [HolidayObservance, string]> = [
    ['nearest-weekday', t('Saturday to Friday, Sunday to Monday')],
    ['sunday-to-monday', t('Sunday to Monday only')],
    ['none', t('Not moved')],
  ];

  function toggleWeekday(weekday: Weekday) {
    const isNonWorking = draft.nonWorkingDays.includes(weekday);
    const nonWorkingDays = isNonWorking
      ? draft.nonWorkingDays.filter(w => w !== weekday)
      : [...draft.nonWorkingDays, weekday].sort((a, b) => a - b);
    if (nonWorkingDays.length >= WEEKDAYS.length) {
      setWeekdayError(t('A calendar needs at least one working weekday.'));
      return;
    }
    setWeekdayError(null);
    setDraft({ ...draft, nonWorkingDays });
  }

  function updateHoliday(index: number, rule: HolidayRule) {
    setDraft({
      ...draft,
      holidays: draft.holidays.map((h, i) => (i === index ? rule : h)),
    });
  }

  function changeKind(index: number, kind: HolidayRule['kind']) {
    const rule = draft.holidays[index];
    const { id, name, observance } = rule;
    setInvalidOffsets(invalidOffsets.filter(i => i !== id));
    const base = {
      id,
      name,
      observance,
      month: rule.kind === 'easter' ? 1 : rule.month,
    };
    updateHoliday(
      index,
      kind === 'easter'
        ? { id, name, observance, kind, offset: 0 }
        : kind === 'fixed'
          ? { ...base, kind, day: 1 }
          : kind === 'nth-weekday'
            ? { ...base, kind, weekday: 1, nth: 1 }
            : { ...base, kind, weekday: 1 },
    );
  }

  function addHoliday() {
    setDraft({
      ...draft,
      holidays: [
        ...draft.holidays,
        {
          id: uuidv4(),
          name: t('New holiday'),
          kind: 'fixed',
          month: 1,
          day: 1,
          observance: 'nearest-weekday',
        },
      ],
    });
  }

  function updateException(
    index: number,
    exception: BusinessCalendarException,
  ) {
    setDraft({
      ...draft,
      exceptions: draft.exceptions.map((e, i) => (i === index ? exception : e)),
    });
  }

  function addException() {
    setDraft({
      ...draft,
      exceptions: [
        ...draft.exceptions,
        {
          date: `${year}-12-26`,
          isBusinessDay: false,
          name: t('Closed'),
        },
      ],
    });
  }

  const preview = getHolidays(draft, year);

  const deleteLabel = <Trans>Delete calendar</Trans>;
  const saveButton = (
    <Button
      variant="primary"
      isDisabled={draft.holidays.some(
        h => h.kind === 'easter' && invalidOffsets.includes(h.id),
      )}
      onPress={() => onSave(draft)}
      style={renderPage ? { ...touch, width: '100%' } : undefined}
    >
      <Trans>Save</Trans>
    </Button>
  );

  const body = (
    <View style={{ gap: 15 }}>
      <View style={{ gap: 5 }}>
        <Text style={{ fontWeight: 600 }}>
          <Trans>Name</Trans>
        </Text>
        <Input
          aria-label={t('Calendar name')}
          value={draft.name}
          onChangeValue={name => setDraft({ ...draft, name })}
          style={touch}
        />
      </View>

      <View style={{ gap: 5 }}>
        <Text style={{ fontWeight: 600 }}>
          <Trans>Non-working weekdays</Trans>
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {WEEKDAYS.map(weekday => (
            <label
              key={weekday}
              style={{ display: 'flex', alignItems: 'center', ...touch }}
            >
              <Checkbox
                checked={draft.nonWorkingDays.includes(weekday)}
                onChange={() => toggleWeekday(weekday)}
              />
              {weekdayName(weekday)}
            </label>
          ))}
        </View>
        {weekdayError && (
          <Text role="alert" style={{ color: theme.errorText }}>
            {weekdayError}
          </Text>
        )}
      </View>

      <View style={{ gap: 5 }}>
        <Text style={{ fontWeight: 600 }}>
          <Trans>Holidays</Trans>
        </Text>
        {draft.holidays.map((rule, index) => (
          <View
            key={rule.id}
            style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}
          >
            <Input
              aria-label={t('Holiday name')}
              value={rule.name}
              onChangeValue={name => updateHoliday(index, { ...rule, name })}
              style={{ width: 200, ...touch }}
            />
            <Select
              aria-label={t('Holiday rule type')}
              options={kindOptions}
              value={rule.kind}
              onChange={kind => changeKind(index, kind)}
              style={touch}
            />
            {rule.kind === 'nth-weekday' && (
              <Select
                options={nthOptions}
                value={rule.nth}
                onChange={nth => updateHoliday(index, { ...rule, nth })}
                style={touch}
              />
            )}
            {rule.kind === 'last-weekday' && (
              <Text style={{ alignSelf: 'center' }}>
                <Trans>Last</Trans>
              </Text>
            )}
            {(rule.kind === 'nth-weekday' || rule.kind === 'last-weekday') && (
              <Select
                options={weekdayOptions}
                value={rule.weekday}
                onChange={weekday => updateHoliday(index, { ...rule, weekday })}
                style={touch}
              />
            )}
            {rule.kind !== 'easter' && (
              <Select
                options={monthOptions}
                value={rule.month}
                onChange={month => updateHoliday(index, { ...rule, month })}
                style={touch}
              />
            )}
            {rule.kind === 'easter' && (
              <Input
                aria-label={t('Days from Easter Sunday')}
                type="number"
                min={-100}
                max={100}
                // Uncontrolled so a lone "-" can be typed before the digits
                defaultValue={String(rule.offset)}
                onChangeValue={offset => {
                  const others = invalidOffsets.filter(i => i !== rule.id);
                  if (
                    /^-?\d+$/.test(offset) &&
                    Math.abs(Number(offset)) <= 100
                  ) {
                    setInvalidOffsets(others);
                    updateHoliday(index, { ...rule, offset: Number(offset) });
                  } else {
                    setInvalidOffsets([...others, rule.id]);
                  }
                }}
                style={{ width: 70, ...touch }}
              />
            )}
            {rule.kind === 'easter' && invalidOffsets.includes(rule.id) && (
              <Text
                role="alert"
                style={{ color: theme.errorText, width: '100%' }}
              >
                <Trans>Enter a whole number of days from -100 to 100.</Trans>
              </Text>
            )}
            {rule.kind === 'fixed' && (
              <Input
                aria-label={t('Day of month')}
                type="number"
                min={1}
                max={31}
                value={String(rule.day)}
                onChangeValue={day =>
                  updateHoliday(index, { ...rule, day: Number(day) })
                }
                style={{ width: 60, ...touch }}
              />
            )}
            <Select
              options={observanceOptions}
              value={rule.observance}
              onChange={observance =>
                updateHoliday(index, { ...rule, observance })
              }
              style={touch}
            />
            <Button
              variant="bare"
              aria-label={t('Remove holiday')}
              style={touch}
              onPress={() =>
                setDraft({
                  ...draft,
                  holidays: draft.holidays.filter((_, i) => i !== index),
                })
              }
            >
              <Trans>Remove</Trans>
            </Button>
          </View>
        ))}
        <Button
          style={{ alignSelf: 'flex-start', ...touch }}
          onPress={addHoliday}
        >
          <Trans>Add holiday</Trans>
        </Button>
      </View>

      <View style={{ gap: 5 }}>
        <Text style={{ fontWeight: 600 }}>
          <Trans>Exceptions</Trans>
        </Text>
        {draft.exceptions.map((exception, index) => (
          <View
            key={index}
            style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}
          >
            <Input
              aria-label={t('Exception date')}
              type="date"
              value={exception.date}
              onChangeValue={date =>
                updateException(index, { ...exception, date })
              }
              style={touch}
            />
            <Select
              options={[
                [false, t('Not a business day')],
                [true, t('Business day')],
              ]}
              value={exception.isBusinessDay}
              onChange={isBusinessDay =>
                updateException(index, { ...exception, isBusinessDay })
              }
              style={touch}
            />
            <Input
              aria-label={t('Exception name')}
              value={exception.name}
              onChangeValue={name =>
                updateException(index, { ...exception, name })
              }
              style={{ width: 200, ...touch }}
            />
            <Button
              variant="bare"
              aria-label={t('Remove exception')}
              style={touch}
              onPress={() =>
                setDraft({
                  ...draft,
                  exceptions: draft.exceptions.filter((_, i) => i !== index),
                })
              }
            >
              <Trans>Remove</Trans>
            </Button>
          </View>
        ))}
        <Button
          style={{ alignSelf: 'flex-start', ...touch }}
          onPress={addException}
        >
          <Trans>Add exception</Trans>
        </Button>
      </View>

      <View style={{ gap: 5 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Text style={{ fontWeight: 600 }}>
            <Trans>Non-business days in {{ year }}</Trans>
          </Text>
          <Button
            variant="bare"
            aria-label={t('Previous year')}
            style={touch}
            onPress={() => setYear(year - 1)}
          >
            ‹
          </Button>
          <Button
            variant="bare"
            aria-label={t('Next year')}
            style={touch}
            onPress={() => setYear(year + 1)}
          >
            ›
          </Button>
        </View>
        {preview.length === 0 ? (
          <Text style={{ color: theme.pageTextSubdued }}>
            <Trans>No holidays or exceptions this year.</Trans>
          </Text>
        ) : (
          <ul
            aria-label={t('Year preview')}
            style={{ listStyle: 'none', margin: 0, padding: 0 }}
          >
            {preview.map(holiday => (
              <li key={`${holiday.date}-${holiday.name}`}>
                {d.format(d.parseISO(holiday.date), 'PPPP', { locale })}
                {' — '}
                {holiday.name}
              </li>
            ))}
          </ul>
        )}
      </View>

      {renderPage && (
        // Destructive and set apart from Save, as on the paycheck page
        <Button
          onPress={() => onDelete(calendar.id)}
          style={{
            ...touch,
            marginTop: 20,
            color: theme.errorText,
            borderColor: theme.errorText,
          }}
        >
          {deleteLabel}
        </Button>
      )}
    </View>
  );

  if (renderPage) {
    return renderPage(body, saveButton);
  }

  return (
    <View style={{ gap: 15 }}>
      {body}
      <View
        style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10 }}
      >
        <Button onPress={() => onDelete(calendar.id)}>{deleteLabel}</Button>
        {saveButton}
      </View>
    </View>
  );
}

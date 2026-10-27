import { Trans, useTranslation } from 'react-i18next';

import { Input } from '@actual-app/components/input';
import { Select } from '@actual-app/components/select';
import { Text } from '@actual-app/components/text';
import { theme } from '@actual-app/components/theme';
import { View } from '@actual-app/components/view';
import {
  isRelativeDate,
  MAX_RELATIVE_OFFSET,
} from '@actual-app/core/shared/relative-dates';
import type {
  RelativeDateConfig,
  ScheduleEntity,
} from '@actual-app/core/types/models';

import { Checkbox } from '#components/forms';
import { useBusinessCalendarLookup } from '#hooks/useBusinessCalendarLookup';
import { useScheduleDateLookup } from '#hooks/useScheduleDateLookup';

type RelativeDateEditorProps = {
  value: RelativeDateConfig;
  // The schedule being edited, which cannot be its own source
  scheduleId?: ScheduleEntity['id'];
  onChange: (value: RelativeDateConfig) => void;
};

export function RelativeDateEditor({
  value,
  scheduleId,
  onChange,
}: RelativeDateEditorProps) {
  const { t } = useTranslation();
  const { schedules, isLoading } = useScheduleDateLookup();
  const calendars = useBusinessCalendarLookup();
  const { relativeTo } = value;

  // Relative schedules cannot be sources, so chains never form
  const sources = schedules.filter(
    s => !s.tombstone && s.id !== scheduleId && !isRelativeDate(s._date),
  );
  const isSourceMissing =
    !isLoading &&
    relativeTo.scheduleId !== '' &&
    !schedules.some(s => s.id === relativeTo.scheduleId && !s.tombstone);
  const isCalendarMissing =
    value.businessCalendarId != null &&
    !calendars.some(c => c.id === value.businessCalendarId);

  const update = (fields: Partial<RelativeDateConfig>) =>
    onChange({ ...value, ...fields });
  const updateRelative = (fields: Partial<RelativeDateConfig['relativeTo']>) =>
    update({ relativeTo: { ...relativeTo, ...fields } });

  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}>
        <Input
          aria-label={t('Offset')}
          type="number"
          min={0}
          max={MAX_RELATIVE_OFFSET}
          step={1}
          value={String(relativeTo.offset)}
          onChangeValue={offset =>
            updateRelative({
              offset: Math.min(
                MAX_RELATIVE_OFFSET,
                Math.max(0, Math.floor(Number(offset)) || 0),
              ),
            })
          }
          style={{ width: 55 }}
        />
        <Select
          aria-label={t('Unit')}
          options={[
            ['business-days', t('business days')],
            ['days', t('days')],
          ]}
          value={relativeTo.unit}
          onChange={unit => updateRelative({ unit })}
        />
        <Select
          aria-label={t('Direction')}
          options={[
            ['before', t('before')],
            ['after', t('after')],
          ]}
          value={relativeTo.direction}
          onChange={direction => updateRelative({ direction })}
        />
        <Select
          aria-label={t('Source schedule')}
          options={[
            ...(isSourceMissing
              ? [[relativeTo.scheduleId, t('Deleted schedule')] as const]
              : []),
            ...sources.map(
              s => [s.id, s.name || t('Unnamed schedule')] as const,
            ),
          ]}
          value={relativeTo.scheduleId}
          defaultLabel={t('Choose a schedule')}
          onChange={scheduleId => updateRelative({ scheduleId })}
        />
      </View>

      {/* Counts business days and decides the move below */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
        <Trans>
          <label htmlFor="relative_calendar" style={{ userSelect: 'none' }}>
            Business days in
          </label>{' '}
          <Select
            id="relative_calendar"
            options={[
              ['', t('weekends only')],
              ...calendars.map(c => [c.id, c.name] as const),
              ...(isCalendarMissing && value.businessCalendarId
                ? [[value.businessCalendarId, t('missing calendar')] as const]
                : []),
            ]}
            value={value.businessCalendarId ?? ''}
            onChange={id => update({ businessCalendarId: id || undefined })}
          />
        </Trans>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
        <Checkbox
          id="relative_skipwe"
          checked={!!value.skipWeekend}
          onChange={e => update({ skipWeekend: e.target.checked })}
        />
        <Trans>
          <label htmlFor="relative_skipwe" style={{ userSelect: 'none' }}>
            Then move
          </label>{' '}
          <Select
            id="relative_solve"
            options={[
              ['before', t('before')],
              ['after', t('after')],
            ]}
            value={value.weekendSolveMode ?? 'after'}
            onChange={weekendSolveMode => update({ weekendSolveMode })}
            disabled={!value.skipWeekend}
          />{' '}
          <label htmlFor="relative_solve" style={{ userSelect: 'none' }}>
            non-business days
          </label>
        </Trans>
      </View>

      {!isLoading && sources.length === 0 && !isSourceMissing && (
        <Text role="note" style={{ color: theme.warningText }}>
          <Trans>
            No schedule can be a source yet. Create a schedule with its own date
            first.
          </Trans>
        </Text>
      )}

      {isCalendarMissing && (
        <Text role="note" style={{ color: theme.warningText }}>
          <Trans>
            The business calendar was deleted. Weekends are used until you
            choose another calendar.
          </Trans>
        </Text>
      )}

      {isSourceMissing && (
        <Text role="note" style={{ color: theme.warningText }}>
          <Trans>
            Source schedule was deleted. Choose another schedule or delete this
            one.
          </Trans>
        </Text>
      )}
    </View>
  );
}
